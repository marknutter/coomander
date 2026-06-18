/**
 * SSE endpoint for real-time event streaming.
 *
 * Channels are auth-gated: users can only subscribe to their own channels.
 * Supported channel format: `notifications:{userId}`
 *
 * Sends a heartbeat comment every 30s to keep the connection alive.
 */

import { auth } from "@/lib/auth";
import { subscribe, unsubscribe } from "@/lib/realtime";
import { UnauthorizedError, ForbiddenError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_INTERVAL = 30000; // 30 seconds

export async function GET(
  request: Request,
  { params }: { params: Promise<{ channel: string }> },
) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { channel } = await params;

    // Authorize: users can only subscribe to their own channels
    if (channel.startsWith("notifications:")) {
      const channelUserId = channel.slice("notifications:".length);
      if (channelUserId !== session.user.id) {
        throw new ForbiddenError("Cannot subscribe to another user's channel");
      }
    } else {
      throw new ForbiddenError("Unknown channel type");
    }

    log.info("SSE connection opened", { channel, userId: session.user.id });

    let streamController: ReadableStreamDefaultController | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
        subscribe(channel, controller);

        // Send a heartbeat comment every 30s to keep the connection alive.
        // SSE comments (lines starting with `:`) are ignored by EventSource.
        const encoder = new TextEncoder();
        heartbeatTimer = setInterval(() => {
          try {
            controller.enqueue(encoder.encode(": heartbeat\n\n"));
          } catch {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
          }
        }, HEARTBEAT_INTERVAL);
      },
      cancel() {
        if (streamController) {
          unsubscribe(channel, streamController);
        }
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        log.info("SSE connection closed", { channel });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
