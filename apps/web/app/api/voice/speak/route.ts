export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * POST /api/voice/speak
 * Accepts text and returns audio via ElevenLabs TTS.
 * API key stays server-side — never exposed to client.
 */
export async function POST(req: NextRequest) {
  const session = await auth.api.getSession({ headers: req.headers });
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID || "cgSgspJ2msm6clMCkdW9";

  if (!elevenLabsApiKey) {
    return NextResponse.json({ error: "Voice services not configured" }, { status: 503 });
  }

  try {
    const { text } = await req.json();
    if (!text) {
      return NextResponse.json({ error: "No text provided" }, { status: 400 });
    }

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenLabsApiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`ElevenLabs error: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("audio")) {
      return NextResponse.json({ error: "TTS returned invalid audio" }, { status: 502 });
    }

    const audioBuffer = await response.arrayBuffer();
    if (audioBuffer.byteLength < 100) {
      return NextResponse.json({ error: "TTS returned empty audio" }, { status: 502 });
    }

    return new NextResponse(audioBuffer, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Content-Length": audioBuffer.byteLength.toString(),
      },
    });
  } catch (error) {
    console.error("[Voice] TTS error:", error);
    return NextResponse.json({ error: "TTS failed" }, { status: 500 });
  }
}
