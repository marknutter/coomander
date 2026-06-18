// Per-user video analysis: orchestrates the Cloudflare-Container-backed
// video processor (see node/workers/video-processor) for each of the
// session user's video posts that don't yet have a transcript.

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { postAnalysis, posts } from "@/lib/schema";

export interface VideoAnalysisResult {
  transcribed: number;
  framesAnalyzed: number;
  skipped: number;
  errors: number;
}

export type ProgressCallback = (event: {
  phase: string;
  step: string;
  current: number;
  total: number;
}) => void;

interface VideoProcessorResponse {
  transcript: string;
  spoken_hook: string;
  key_frame_analysis_json: string;
}

interface VideoProcessorBinding {
  fetch: (request: Request) => Promise<Response>;
}

function getVideoProcessor(): VideoProcessorBinding | null {
  try {
    // Dynamic require so non-Workers builds (vitest, Vercel target) don't
    // try to resolve @opennextjs/cloudflare at module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    return (ctx?.env?.VIDEO_PROCESSOR as VideoProcessorBinding | undefined) ?? null;
  } catch {
    return null;
  }
}

interface VideoProcessorConfig {
  secret: string;
  openaiKey: string;
  anthropicKey: string;
}

function readConfig(): VideoProcessorConfig {
  const secret = process.env.VIDEO_PROCESSOR_SECRET;
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!secret) throw new Error("VIDEO_PROCESSOR_SECRET not configured");
  if (!openaiKey) throw new Error("OPENAI_API_KEY not configured");
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");
  return { secret, openaiKey, anthropicKey };
}

async function callVideoProcessor(
  binding: VideoProcessorBinding,
  config: VideoProcessorConfig,
  videoUrl: string,
): Promise<VideoProcessorResponse> {
  const response = await binding.fetch(
    new Request("https://video-processor/process-video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": config.secret,
      },
      body: JSON.stringify({
        video_url: videoUrl,
        openai_api_key: config.openaiKey,
        anthropic_api_key: config.anthropicKey,
      }),
    }),
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Video processor returned ${response.status}: ${text}`);
  }

  return (await response.json()) as VideoProcessorResponse;
}

export async function processVideoPosts(
  userId: string,
  limit = 50,
  onProgress?: ProgressCallback,
): Promise<VideoAnalysisResult> {
  const binding = getVideoProcessor();
  if (!binding) {
    throw new Error(
      "VIDEO_PROCESSOR binding is not available. Deploy the video-processor Worker and add the service binding (see node/workers/video-processor/README.md).",
    );
  }
  const config = readConfig();

  const db = getDb();

  const videoPosts = await db
    .select({
      id: posts.id,
      platformPostId: posts.platform_post_id,
      mediaUrl: posts.media_url,
      analysisId: postAnalysis.id,
    })
    .from(posts)
    .innerJoin(postAnalysis, eq(postAnalysis.post_id, posts.id))
    .where(
      and(
        eq(posts.user_id, userId),
        eq(posts.media_type, "VIDEO"),
        isNotNull(posts.media_url),
        isNull(postAnalysis.transcript),
      ),
    )
    .limit(limit);

  let transcribed = 0;
  let framesAnalyzed = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < videoPosts.length; i++) {
    const post = videoPosts[i];
    onProgress?.({
      phase: "video",
      step: `Processing video ${i + 1} of ${videoPosts.length}`,
      current: i + 1,
      total: videoPosts.length,
    });

    if (!post.mediaUrl) {
      skipped++;
      continue;
    }

    try {
      const result = await callVideoProcessor(binding, config, post.mediaUrl);
      if (result.transcript && result.transcript !== "(no audio detected)") transcribed++;
      if (result.key_frame_analysis_json && result.key_frame_analysis_json !== "{}") framesAnalyzed++;

      await db
        .update(postAnalysis)
        .set({
          transcript: result.transcript,
          spoken_hook: result.spoken_hook,
          key_frame_analysis: result.key_frame_analysis_json,
        })
        .where(eq(postAnalysis.id, post.analysisId));
    } catch (err) {
      console.warn("[video-analysis] post failed", {
        userId,
        postId: post.id,
        err: err instanceof Error ? err.message : err,
      });
      errors++;
    }
  }

  return { transcribed, framesAnalyzed, skipped, errors };
}
