import { DurableObject } from "cloudflare:workers";
import {
  SessionCheckUnavailableError,
  validateSessionCookie,
} from "../auth";
import type { Env } from "../index";

/**
 * Per-connection metadata, persisted in the WebSocket's HIBERNATION attachment
 * via `ws.serializeAttachment()`. This is the hibernation-safe analog of
 * AppAgent's `connection.setState()`: when a hibernated DO wakes on an incoming
 * frame, `webSocketMessage` fires but `fetch`/the upgrade handler does NOT
 * re-run, so anything kept in an in-memory field is gone. Read it back with
 * `ws.deserializeAttachment()`. Keep it tiny — the attachment has a small byte
 * budget.
 *
 * `cookie` is stored so the DO can re-validate the session on later frames;
 * `userId` is the gate-validated identity (never client-supplied); `channel` is
 * the `<type>:<id>` address this socket subscribed to; `validatedAt` drives the
 * rate-limited revalidation window.
 */
type ConnAttachment = {
  channel: string;
  userId: string;
  cookie: string;
  validatedAt: number;
};

/** Re-validate an open WebSocket's session at most this often (mirrors AppAgent). */
const WS_REVALIDATE_MS = 60_000;

/**
 * RealtimeChannel — a generic, per-entity realtime fan-out channel. One DO
 * instance per channel address (`idFromName("<type>:<id>")`); every WebSocket
 * connected to that instance receives every `broadcast()`. Any feature can
 * publish to a channel without owning DO code.
 *
 * Auth is enforced at the WORKER GATE (src/index.ts), which validates the
 * Better Auth session and authorizes the channel BEFORE forwarding here — so
 * reaching this class means the request was authenticated and the user is
 * allowed on this channel. We trust only the identity the gate passed via
 * internal headers, never anything the client supplied.
 *
 * Uses the WebSocket Hibernation API (`ctx.acceptWebSocket`,
 * `webSocketMessage`, `webSocketClose`, `webSocketError`) so idle channels cost
 * nothing — the DO evicts and wakes on the next frame or broadcast.
 */
export class RealtimeChannel extends DurableObject<Env> {
  /** Internal path the worker gate POSTs to (server-to-server) to fan out. */
  private static readonly PUBLISH_PATH = "/__channel/publish";

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // ── Internal publish RPC (server-to-server, from the worker gate) ─────
    // The gate has already checked the shared secret; this path is only
    // reachable via the DO stub, never from the public edge.
    if (request.method === "POST" && url.pathname === RealtimeChannel.PUBLISH_PATH) {
      const body = (await request.json().catch(() => null)) as
        | { event?: unknown }
        | null;
      const delivered = this.broadcast(body?.event);
      return Response.json({ delivered });
    }

    // ── WebSocket upgrade ─────────────────────────────────────────────────
    if (request.headers.get("upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    // Identity comes ONLY from the gate-set internal headers — never trust
    // client-supplied identity. The gate guarantees these are present.
    const userId = request.headers.get("x-realtime-user");
    const channel = request.headers.get("x-realtime-channel");
    const cookie = request.headers.get("cookie") ?? "";
    if (!userId || !channel) {
      // Defense in depth: the gate always sets these. If absent, refuse.
      return new Response("unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Accept with the Hibernation API so the DO can evict while idle.
    this.ctx.acceptWebSocket(server);

    // Persist auth in the hibernation-safe attachment (survives eviction) so
    // webSocketMessage can re-read it after the DO wakes — the upgrade handler
    // does not re-run on hibernation wake.
    server.serializeAttachment({
      channel,
      userId,
      cookie,
      validatedAt: Date.now(),
    } satisfies ConnAttachment);

    return new Response(null, { status: 101, webSocket: client });
  }

  /**
   * Fan a JSON event out to every connected socket. Returns the number of
   * sockets the event was delivered to. Sockets that throw on send (already
   * closing) are skipped and closed — the hibernation API owns the socket set,
   * so we just stop tracking the dead one by closing it.
   */
  broadcast(event: unknown): number {
    const payload = JSON.stringify(event);
    let delivered = 0;
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(payload);
        delivered++;
      } catch {
        // Dead/closing socket — drop it. The set is managed by the runtime.
        try {
          ws.close(1011, "send failed");
        } catch {
          /* already closed */
        }
      }
    }
    return delivered;
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    const att = ws.deserializeAttachment() as ConnAttachment | null;
    if (!att) {
      // No attachment means we can't authenticate this socket — close it.
      ws.close(1008, "unauthorized");
      return;
    }

    // Rate-limited session revalidation: sockets outlive sessions, so re-check
    // (at most every WS_REVALIDATE_MS) that the user is still valid and still
    // owns this socket. Failures close the socket cleanly — never throw out of
    // the handler (an uncaught throw here would tear the DO down).
    if (Date.now() - att.validatedAt >= WS_REVALIDATE_MS) {
      try {
        const user = await validateSessionCookie(att.cookie, this.env);
        if (!user || user.id !== att.userId) {
          ws.close(1008, "session expired");
          return;
        }
        // Refresh the window in the durable attachment so the next hibernation
        // wake also starts inside the revalidation window.
        ws.serializeAttachment({
          ...att,
          validatedAt: Date.now(),
        } satisfies ConnAttachment);
      } catch (err) {
        if (err instanceof SessionCheckUnavailableError) {
          // Web app unreachable (e.g. mid-restart): close cleanly, no crash.
          ws.close(1011, "session validation unavailable");
          return;
        }
        // Unexpected error — still close cleanly rather than throwing.
        ws.close(1011, "session validation error");
        return;
      }
    }

    // Heartbeat: a client ping keeps the socket warm and lets the client detect
    // a half-open connection. Everything else is ignored (forward-compat:
    // future frame types can be added without breaking existing clients).
    if (typeof message === "string") {
      let frame: unknown;
      try {
        frame = JSON.parse(message);
      } catch {
        return; // non-JSON frame — ignore
      }
      if (
        frame &&
        typeof frame === "object" &&
        (frame as { type?: unknown }).type === "ping"
      ) {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    }
    // Non-ping / binary frames are intentionally ignored.
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    // The hibernation runtime manages the socket set; just close our side
    // cleanly. Wrapped because the socket may already be closing.
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    try {
      ws.close(1011, "socket error");
    } catch {
      /* already closed */
    }
  }
}

/**
 * Build the internal request the worker gate sends to a channel DO stub to fan
 * an event out. Kept here so the publish path/shape lives next to the handler
 * that serves it.
 */
export function buildChannelPublishRequest(event: unknown): Request {
  // The DO ignores the origin/host of internal stub requests; the path is what
  // routes to the publish handler in `fetch` above.
  return new Request("https://channel.internal/__channel/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
  });
}
