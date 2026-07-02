import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { publish } from "@/lib/realtime";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/realtime-demo/ping (any authenticated user).
 *
 * The write half of the realtime "ping" demo (see the RealtimeDemoCard on
 * `/app` and content/docs/dev/realtime.mdx). It publishes a single event to the
 * CALLER'S OWN user channel and returns:
 *
 *   button → POST here → publish("user:<id>", …) → agents Worker
 *     → RealtimeChannel DO broadcast → every socket on `user:<id>`
 *     → the card's useRealtime("user:<id>") fires → counter ticks
 *
 * It's a worked example, not an admin tool: it exercises the publish → DO → WS
 * → hook path end-to-end with no database row in the middle. It only ever pings
 * the caller's OWN channel (which `authorizeChannel` already scopes), so it
 * needs no permission beyond a valid session.
 *
 * Event type is `demo-ping` — deliberately NOT `ping`/`pong`, which are the
 * heartbeat frames the client hook handles specially (and would swallow).
 *
 * `publish()` is best-effort and non-throwing; we still `await` it so the
 * Workers runtime doesn't cancel the in-flight POST after the response returns
 * (see lib/realtime.ts — the unawaited-promise caveat).
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    // Publish to the caller's OWN user channel — `authorizeChannel` only lets a
    // user subscribe to `user:<their own id>`, so the demo never needs a bespoke
    // authorizer.
    await publish(`user:${session.user.id}`, {
      type: "demo-ping",
      ts: Date.now(),
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("POST /api/realtime-demo/ping failed", { error });
    return errorResponse(error);
  }
}
