// Video-processing container: downloads a video, transcribes audio,
// extracts 5 key frames, and runs Claude vision over the frame sequence.
//
// Mirrors the legacy node/lib/ai/video-analysis.ts pipeline 1:1 so
// downstream report shape is unchanged.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

const runFile = promisify(execFile);

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/process-video", async (req, res) => {
  const { video_url, openai_api_key, anthropic_api_key } = req.body ?? {};

  if (!video_url || typeof video_url !== "string") {
    return res.status(400).json({ error: "Missing video_url" });
  }
  if (!openai_api_key || !anthropic_api_key) {
    return res.status(400).json({ error: "Missing API keys" });
  }

  const workDir = join(tmpdir(), `vp-${randomUUID()}`);
  const videoPath = join(workDir, "video.mp4");
  const audioPath = join(workDir, "audio.mp3");
  const framesDir = join(workDir, "frames");

  try {
    await mkdir(workDir, { recursive: true });
    await downloadVideo(video_url, videoPath);

    let transcript = "";
    let spokenHook = "";
    try {
      await extractAudio(videoPath, audioPath);
      transcript = await transcribeAudio(audioPath, openai_api_key);
      spokenHook = extractSpokenHook(transcript);
    } catch (err) {
      console.warn("[video-processor] audio pipeline failed:", err?.message ?? err);
      transcript = "(no audio detected)";
    }

    let keyFrameAnalysis = "{}";
    try {
      const framePaths = await extractKeyFrames(videoPath, framesDir, 5);
      if (framePaths.length > 0) {
        keyFrameAnalysis = await analyzeKeyFrames(framePaths, anthropic_api_key);
      }
    } catch (err) {
      console.warn("[video-processor] frame pipeline failed:", err?.message ?? err);
    }

    res.json({
      transcript,
      spoken_hook: spokenHook,
      key_frame_analysis_json: keyFrameAnalysis,
    });
  } catch (err) {
    console.error("[video-processor] fatal:", err?.message ?? err);
    res.status(500).json({ error: err?.message ?? "Video processing failed" });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
});

async function downloadVideo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download video: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(outputPath, buffer);
}

async function extractAudio(videoPath, audioPath) {
  await runFile(
    "ffmpeg",
    ["-i", videoPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", "-y", audioPath],
    { timeout: 30_000 },
  );
}

async function transcribeAudio(audioPath, openaiKey) {
  const client = new OpenAI({ apiKey: openaiKey });
  const file = await readFile(audioPath);
  const audioFile = new File([file], "audio.mp3", { type: "audio/mpeg" });
  const response = await client.audio.transcriptions.create({
    model: "whisper-1",
    file: audioFile,
    response_format: "text",
  });
  return String(response).trim();
}

function extractSpokenHook(transcript) {
  const words = transcript.split(/\s+/);
  const head = words.slice(0, 15).join(" ");
  return words.length > 15 ? `${head}...` : head;
}

async function getVideoDuration(videoPath) {
  const { stdout } = await runFile(
    "ffprobe",
    ["-v", "quiet", "-show_entries", "format=duration", "-of", "csv=p=0", videoPath],
    { timeout: 10_000 },
  );
  return parseFloat(stdout.toString().trim()) || 0;
}

async function extractKeyFrames(videoPath, outputDir, count) {
  await mkdir(outputDir, { recursive: true });
  const duration = await getVideoDuration(videoPath);
  if (duration <= 0) return [];

  const timestamps = Array.from({ length: count }, (_, i) => {
    if (i === 0) return 0.5;
    if (i === count - 1) return Math.max(0.5, duration - 0.5);
    return (duration * i) / (count - 1);
  });

  const framePaths = [];
  for (let i = 0; i < timestamps.length; i++) {
    const framePath = join(outputDir, `frame_${i}.jpg`);
    try {
      await runFile(
        "ffmpeg",
        ["-ss", String(timestamps[i]), "-i", videoPath, "-frames:v", "1", "-q:v", "2", "-y", framePath],
        { timeout: 10_000 },
      );
      if (existsSync(framePath)) framePaths.push(framePath);
    } catch {
      // Skip frame if extraction fails
    }
  }
  return framePaths;
}

async function analyzeKeyFrames(framePaths, anthropicKey) {
  const client = new Anthropic({ apiKey: anthropicKey });
  const content = [];

  for (let i = 0; i < framePaths.length; i++) {
    const data = (await readFile(framePaths[i])).toString("base64");
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data },
    });
    content.push({
      type: "text",
      text: `Frame ${i + 1} of ${framePaths.length}${
        i === 0 ? " (opening)" : i === framePaths.length - 1 ? " (ending)" : ""
      }`,
    });
  }

  content.push({
    type: "text",
    text: `These are ${framePaths.length} key frames from an Instagram reel. Analyze them as a sequence and return ONLY a JSON object:
{
  "appearance": "what the creator is wearing, hair, makeup — be specific",
  "location": "where they are — be specific about the setting",
  "poses": "how they're positioned/moving across the frames",
  "scene_changes": "do the scenes change? describe transitions",
  "energy": "low/medium/high — overall vibe of the visual content",
  "props_or_objects": "anything notable in the frame besides the creator",
  "visual_narrative": "1-2 sentences describing the visual story arc from first to last frame"
}

Return only the JSON, no other text.`,
  });

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 600,
    messages: [{ role: "user", content }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : "{}";
}

const PORT = Number(process.env.PORT ?? 8080);
app.listen(PORT, () => {
  console.log(`[video-processor] listening on :${PORT}`);
});
