export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import {
  analyzeUnanalyzedPosts,
  generateContentReport,
} from "@/lib/ai/analyze-content";
import { processVideoPosts } from "@/lib/ai/video-analysis";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function send(data: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        send({ phase: "analyze", step: "Starting post analysis...", current: 0, total: 0 });

        const analyzeResult = await analyzeUnanalyzedPosts(userId, 500, (event) => {
          send(event);
        });

        send({
          phase: "analyze",
          step: `Post analysis complete: ${analyzeResult.analyzed} analyzed`,
          current: analyzeResult.analyzed,
          total: analyzeResult.analyzed,
          done: true,
        });

        send({ phase: "video", step: "Starting video processing...", current: 0, total: 0 });

        let videoResult = { transcribed: 0, framesAnalyzed: 0, skipped: 0, errors: 0 };
        try {
          videoResult = await processVideoPosts(userId, 50, (event) => {
            send(event);
          });
        } catch (err) {
          // Video processing requires the deployed Container — surface the
          // failure but keep going so the user still gets an image-only report.
          send({
            phase: "video",
            step: `Video processing skipped: ${err instanceof Error ? err.message : "unknown error"}`,
            current: 0,
            total: 0,
            done: true,
          });
        }

        const videoStep =
          "Video processing complete: " +
          videoResult.transcribed +
          " transcribed, " +
          videoResult.framesAnalyzed +
          " frames analyzed";
        send({
          phase: "video",
          step: videoStep,
          current: videoResult.transcribed,
          total: videoResult.transcribed,
          done: true,
        });

        send({ phase: "report", step: "Generating AI insights report...", current: 0, total: 1 });

        const report = await generateContentReport(userId, (event) => {
          send(event);
        });

        send({
          phase: "report",
          step: "Report complete",
          current: 1,
          total: 1,
          done: true,
        });

        send({ phase: "complete", report });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        send({ phase: "error", error: message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
