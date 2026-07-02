/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect, vi, afterEach } from "vitest";
import { env, runInDurableObject } from "cloudflare:test";
import type { Env } from "../src/index";

// ─────────────────────────────────────────────────────────────────────────────
// Real-DO WebSocket lifecycle tests for RealtimeChannel
// (apps/agents/src/channel/realtime-channel.ts), ported from the AppSeed
// realtime epic (template #556) into Coomander's apps/agents worker (#222).
//
// These run inside workerd via @cloudflare/vitest-pool-workers, so the REAL
// RealtimeChannel Durable Object — its WebSocketPair upgrade, the Hibernation
// API (`ctx.acceptWebSocket`, `webSocketMessage`, `serializeAttachment`/
// `deserializeAttachment`), the `broadcast()` fan-out, and the rate-limited
// session revalidation — all execute exactly as in production. No fakes are
// substituted for the DO itself.
//
// HOW WE OPEN A REAL SOCKET (no gate, no session mock needed for the happy
// path): we fetch the DO stub directly with an `Upgrade: websocket` request and
// the gate-set internal headers the DO trusts (`x-realtime-user`,
// `x-realtime-channel`, `cookie`). The DO's `fetch` runs the real WebSocketPair
// upgrade and returns 101 with `response.webSocket` — the CLIENT end. We
// `.accept()` it and listen for `message`/`close` events, exactly as a browser
// client would. Publishing goes through the DO's real internal RPC path
// (`POST /__channel/publish`), which calls the real `broadcast()` and returns
// `{ delivered: N }`.
//
// `validatedAt` is stamped to `Date.now()` at upgrade, so a fresh socket never
// hits the 60s revalidation window inside a test. For the two cases that
// require crossing it (1008 close on an invalidated session; the explicit
// skip-and-close branch in broadcast), we use `runInDurableObject` to reach the
// live server-side socket(s) and either rewrite the attachment's `validatedAt`
// to be stale (forcing the revalidation path) or drive `broadcast` against an
// injected throwing socket (forcing the catch branch). Both still exercise the
// REAL DO methods (`webSocketMessage` / `broadcast`) — nothing is stubbed
// except the outbound session-validation fetch (the same global-fetch stub the
// sibling gate test uses).
// ─────────────────────────────────────────────────────────────────────────────

const appEnv = env as unknown as Env;

// The DO validates sessions by fetching {WEB_ORIGIN}/api/auth/get-session
// (WEB_ORIGIN = http://127.0.0.1:3000 per wrangler.toml). We intercept that one
// outbound call by stubbing global fetch and fall through to the real fetch for
// everything else — same pattern as realtime-gate.test.ts.
const realFetch = globalThis.fetch;
const SESSION_URL = "http://127.0.0.1:3000/api/auth/get-session";

function isSessionRequest(input: RequestInfo | URL): boolean {
  let url: string;
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.toString();
  else url = input.url;
  return url === SESSION_URL || url.startsWith(SESSION_URL);
}

// 1008 = the policy-violation close code RealtimeChannel uses for
// "unauthorized" / "session expired" — i.e. the socket was dropped for auth.
const CLOSE_UNAUTHORIZED = 1008;

let nameCounter = 0;
function uniqueChannel(prefix = "user"): { channel: string; userId: string } {
  nameCounter += 1;
  const userId = `${prefix}-${nameCounter}-${Math.random().toString(36).slice(2)}`;
  return { channel: `user:${userId}`, userId };
}

type OpenSocket = {
  /** The DO stub for this channel (publish + runInDurableObject target). */
  stub: DurableObjectStub<import("../src/channel").RealtimeChannel>;
  /** The CLIENT end of the WebSocket (browser-side analog). */
  ws: WebSocket;
  /** Every text frame the client received, in order. */
  received: string[];
  /** Every close event observed on the client, in order. */
  closes: Array<{ code: number; reason: string }>;
};

/**
 * Open a REAL WebSocket against the RealtimeChannel DO by driving the upgrade
 * directly on the DO stub (bypassing only the worker gate, whose auth/authorize
 * behavior is covered by realtime-gate.test.ts). The DO runs the real
 * WebSocketPair upgrade; we accept the returned client end and record frames.
 */
async function openSocket(
  channel: string,
  userId: string,
  cookie = "session=test-cookie",
): Promise<OpenSocket> {
  const id = appEnv.REALTIME_CHANNEL.idFromName(channel);
  const stub = appEnv.REALTIME_CHANNEL.get(id);
  const res = await stub.fetch(`https://channel.internal/realtime/${channel}`, {
    headers: {
      upgrade: "websocket",
      // Gate-set internal identity the DO trusts (never client-supplied).
      "x-realtime-user": userId,
      "x-realtime-channel": channel,
      cookie,
    },
  });
  if (res.status !== 101 || !res.webSocket) {
    throw new Error(`expected 101 + webSocket, got ${res.status}`);
  }
  const ws = res.webSocket;
  const received: string[] = [];
  const closes: Array<{ code: number; reason: string }> = [];
  ws.accept();
  ws.addEventListener("message", (e) => {
    received.push(typeof e.data === "string" ? e.data : "<binary>");
  });
  ws.addEventListener("close", (e) => {
    closes.push({ code: e.code, reason: e.reason });
  });
  return { stub, ws, received, closes };
}

/** Publish an event to a channel via the DO's real internal RPC path. */
async function publish(
  stub: OpenSocket["stub"],
  event: unknown,
): Promise<{ delivered: number }> {
  const res = await stub.fetch("https://channel.internal/__channel/publish", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
  });
  return (await res.json()) as { delivered: number };
}

/** Let the runtime flush queued WS frames/close events to the client end. */
function tick(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── 1. Upgrade → publish → client receives ───────────────────────────────────
describe("1. Upgrade → publish → client receives the published event", () => {
  it("a socket on its channel receives exactly the published frame", async () => {
    const { channel, userId } = uniqueChannel();
    const { stub, received } = await openSocket(channel, userId);

    const event = { type: "agent-message", message: "hello world", conversationId: "c1" };
    const { delivered } = await publish(stub, event);

    expect(delivered).toBe(1);
    await tick();

    expect(received).toHaveLength(1);
    // The frame the client got is byte-for-byte the published event.
    expect(JSON.parse(received[0])).toEqual(event);
  });
});

// ── 2. Two sockets → delivered: 2, both receive ──────────────────────────────
describe("2. Two sockets on the same channel → delivered: 2, both receive", () => {
  it("a single publish fans out to both connected sockets", async () => {
    const { channel, userId } = uniqueChannel();
    const a = await openSocket(channel, userId);
    const b = await openSocket(channel, userId);

    const event = { type: "agent-message", message: "broadcast to both" };
    const { delivered } = await publish(a.stub, event);

    // The real broadcast() reports both live sockets.
    expect(delivered).toBe(2);
    await tick();

    expect(a.received).toHaveLength(1);
    expect(b.received).toHaveLength(1);
    expect(JSON.parse(a.received[0])).toEqual(event);
    expect(JSON.parse(b.received[0])).toEqual(event);
  });
});

// ── 3. ping → pong, not broadcast to others ──────────────────────────────────
describe("3. ping → pong reply; the heartbeat is NOT broadcast to others", () => {
  it("the pinging socket gets a pong; a second socket on the channel sees nothing", async () => {
    const { channel, userId } = uniqueChannel();
    const pinger = await openSocket(channel, userId);
    const other = await openSocket(channel, userId);

    // Client sends a heartbeat over the real socket.
    pinger.ws.send(JSON.stringify({ type: "ping" }));
    await tick();

    // The pinger receives exactly one pong...
    expect(pinger.received).toHaveLength(1);
    expect(JSON.parse(pinger.received[0])).toEqual({ type: "pong" });
    // ...and the heartbeat is a direct reply, never fanned out to the channel.
    expect(other.received).toHaveLength(0);
  });
});

// ── 4. Non-JSON / garbage frame is ignored, not broadcast, no crash ──────────
describe("4. Non-JSON frame is ignored (no crash, no broadcast, no reply)", () => {
  it("a garbage text frame produces no reply to sender and nothing to others", async () => {
    const { channel, userId } = uniqueChannel();
    const sender = await openSocket(channel, userId);
    const other = await openSocket(channel, userId);

    // Not JSON — webSocketMessage's JSON.parse throws and is swallowed.
    sender.ws.send("this is not json {{{");
    await tick();

    // No pong, no echo, no fan-out, and the socket stays open (DO didn't crash).
    expect(sender.received).toHaveLength(0);
    expect(other.received).toHaveLength(0);
    expect(sender.closes).toHaveLength(0);
    expect(other.closes).toHaveLength(0);

    // Proof the DO is still alive and healthy after the garbage frame: a normal
    // ping on the same socket still works end-to-end.
    sender.ws.send(JSON.stringify({ type: "ping" }));
    await tick();
    expect(sender.received).toHaveLength(1);
    expect(JSON.parse(sender.received[0])).toEqual({ type: "pong" });
  });
});

// ── 5. Post-revalidation 1008 close on an invalidated session ────────────────
describe("5. Stale window + invalid session → DO closes the socket with 1008", () => {
  it("when revalidation finds no valid session, webSocketMessage closes 1008 (observed on the client)", async () => {
    const { channel, userId } = uniqueChannel();
    const sock = await openSocket(channel, userId);

    // Force the revalidation outbound call to report "no session" (Better Auth
    // returns 200 + literal JSON null for an invalid/expired session). This is
    // the ONLY thing stubbed — the DO method itself runs for real.
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isSessionRequest(input)) {
        return new Response("null", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return realFetch(input as RequestInfo, init);
    });

    // Reach the live server-side socket and make its attachment stale so the
    // next message crosses the WS_REVALIDATE_MS (60s) window. Then drive a real
    // message through the real webSocketMessage handler.
    await runInDurableObject(sock.stub, async (inst) => {
      const instAny = inst as unknown as {
        ctx: { getWebSockets(): WebSocket[] };
        webSocketMessage(ws: WebSocket, msg: string): Promise<void>;
      };
      const sockets = instAny.ctx.getWebSockets();
      expect(sockets).toHaveLength(1);
      const server = sockets[0] as WebSocket & {
        deserializeAttachment(): unknown;
        serializeAttachment(v: unknown): void;
      };
      const att = server.deserializeAttachment() as { validatedAt: number };
      // Backdate validatedAt 2 minutes → revalidation runs on the next frame.
      server.serializeAttachment({ ...att, validatedAt: Date.now() - 120_000 });

      // Real handler: revalidation fetch → null user → close(1008, "session expired").
      await instAny.webSocketMessage(server, JSON.stringify({ type: "ping" }));
    });

    await tick();

    // The client end observed the policy-violation close.
    expect(sock.closes.some((c) => c.code === CLOSE_UNAUTHORIZED)).toBe(true);
    // And no pong was sent — the turn was dropped before the heartbeat reply.
    expect(sock.received).toHaveLength(0);
  });

  it("a still-valid session at the stale boundary does NOT close, and re-stamps validatedAt", async () => {
    // Non-vacuity for case 5: same stale-window setup, but the session is still
    // valid (user.id === the gate-set userId), so the DO must NOT close — it
    // refreshes the attachment window and proceeds (the ping yields a pong).
    const { channel, userId } = uniqueChannel();
    const sock = await openSocket(channel, userId);

    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isSessionRequest(input)) {
        return new Response(
          JSON.stringify({ user: { id: userId } }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return realFetch(input as RequestInfo, init);
    });

    const staleAt = Date.now() - 120_000;
    await runInDurableObject(sock.stub, async (inst) => {
      const instAny = inst as unknown as {
        ctx: { getWebSockets(): WebSocket[] };
        webSocketMessage(ws: WebSocket, msg: string): Promise<void>;
      };
      const server = instAny.ctx.getWebSockets()[0] as WebSocket & {
        deserializeAttachment(): { validatedAt: number };
        serializeAttachment(v: unknown): void;
      };
      server.serializeAttachment({ ...server.deserializeAttachment(), validatedAt: staleAt });
      await instAny.webSocketMessage(server, JSON.stringify({ type: "ping" }));

      // validatedAt was refreshed past the stale value (next wake stays in-window).
      const after = (server.deserializeAttachment() as { validatedAt: number }).validatedAt;
      expect(after).toBeGreaterThan(staleAt);
    });

    await tick();
    // Not closed for an auth reason; the ping went through → pong delivered.
    expect(sock.closes.some((c) => c.code === CLOSE_UNAUTHORIZED)).toBe(false);
    expect(sock.received).toHaveLength(1);
    expect(JSON.parse(sock.received[0])).toEqual({ type: "pong" });
  });
});

// ── 6. Dead-socket skip-and-close ────────────────────────────────────────────
describe("6. Dead-socket is skipped on broadcast; live socket still delivered", () => {
  it("auto-eviction path: a client that closed is no longer delivered to (delivered counts only the live socket)", async () => {
    // Real path: one live + one client-closed socket. When the client end
    // closes, the runtime removes that socket from the hibernation set, so a
    // subsequent publish delivers only to the live socket — without throwing.
    const { channel, userId } = uniqueChannel();
    const live = await openSocket(channel, userId);
    const dead = await openSocket(channel, userId);

    // Close the second socket's client end → its server side becomes dead.
    dead.ws.close();
    await tick();

    const { delivered } = await publish(live.stub, { type: "after-death" });
    await tick();

    // The dead socket was skipped; the live one still got the frame.
    expect(delivered).toBe(1);
    expect(live.received).toHaveLength(1);
    expect(JSON.parse(live.received[0])).toEqual({ type: "after-death" });
    // The dead socket received nothing past its close.
    expect(dead.received).toHaveLength(0);
  });

  it("explicit catch branch: a socket whose send() throws is skipped AND closed, the live one still delivered", async () => {
    // Drives the literal `try { ws.send } catch { ws.close(1011) }` branch in
    // broadcast() deterministically: we inject a throwing socket alongside the
    // real live one and call the real broadcast(). The throwing socket must be
    // skipped (not counted), then closed; the live socket is delivered to.
    const { channel, userId } = uniqueChannel();
    const live = await openSocket(channel, userId);

    const result = await runInDurableObject(live.stub, async (inst) => {
      const instAny = inst as unknown as {
        ctx: { getWebSockets(): WebSocket[] };
        broadcast(event: unknown): number;
      };

      let closedWithCode: number | undefined;
      const throwingSocket = {
        send() {
          throw new Error("boom: send on a dead/closing socket");
        },
        close(code?: number) {
          closedWithCode = code;
        },
      } as unknown as WebSocket;

      // Splice the throwing socket into the set the real broadcast() iterates.
      const origGet = instAny.ctx.getWebSockets.bind(instAny.ctx);
      instAny.ctx.getWebSockets = () => [...origGet(), throwingSocket];
      let threw = false;
      let delivered = -1;
      try {
        delivered = instAny.broadcast({ type: "fanout-with-dead" });
      } catch {
        threw = true;
      } finally {
        instAny.ctx.getWebSockets = origGet;
      }
      return { delivered, threw, closedWithCode };
    });

    await tick();

    // broadcast() did not throw despite the dead socket...
    expect(result.threw).toBe(false);
    // ...counted only the live socket...
    expect(result.delivered).toBe(1);
    // ...and explicitly closed the dead one (1011 "send failed").
    expect(result.closedWithCode).toBe(1011);
    // The live socket actually received the frame.
    expect(live.received).toHaveLength(1);
    expect(JSON.parse(live.received[0])).toEqual({ type: "fanout-with-dead" });
  });
});
