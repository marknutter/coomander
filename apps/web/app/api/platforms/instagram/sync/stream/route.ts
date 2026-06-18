export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { auth } from "@/lib/auth";
import { syncAllInstagram } from "@/lib/sync/instagram";

// Streaming variant of POST /api/platforms/instagram/sync. The full sync
// can take 60-120s on accounts with many posts, which exceeds Safari's
// fetch timeout. Wrapping it in an SSE stream with a periodic heartbeat
// keeps the browser connection alive until the work is done.

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const userId = session.user.id;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      function send(data: Record<string, unknown>) {
        if (closed) return;
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      send({ phase: "sync", step: "Starting Instagram sync...", current: 0, total: 3 });

      // Heartbeat every 5s so Safari doesn't time out the fetch.
      const heartbeat = setInterval(() => {
        send({ phase: "sync", step: "Working...", heartbeat: true });
      }, 5_000);

      try {
        const result = await syncAllInstagram(userId);
        const completeStep =
          "Sync complete: " +
          result.posts.postsUpserted + " posts, " +
          result.posts.insightsUpserted + " insights, " +
          result.account.snapshotsUpserted + " account snapshots, " +
          result.demographics.entriesUpserted + " demographic entries";
        send({
          phase: "sync",
          step: completeStep,
          current: 3,
          total: 3,
          done: true,
        });
        send({ phase: "complete", result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        send({ phase: "error", error: message });
      } finally {
        clearInterval(heartbeat);
        closed = true;
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
