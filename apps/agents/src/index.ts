import { Agent, routeAgentRequest, type Connection, type ConnectionContext } from "agents";
import {
  SessionCheckUnavailableError,
  validateSessionCookie,
  type SessionUser,
} from "./auth";
import {
  handleChatTurn,
  parseClientFrame,
  type BufferTurn,
  type ChatDeps,
} from "./chat";
import { getChatConfig } from "./chat-config";
import { appendMessageInternal, hydrateMessages } from "./persistence";
import type { AgentTool, ToolContext } from "./types";
import { makeScheduleFollowupTool } from "./tools";
import { deliverTelegramFallback } from "./web-api";
import {
  RealtimeChannel,
  buildChannelPublishRequest,
  parseChannel,
  authorizeChannel,
} from "./channel";

// Register the generic per-entity realtime channel DO on the deployed script
// (alongside AppAgent). The class lives in ./channel; re-exporting it here is
// what makes the `RealtimeChannel` binding in wrangler.toml resolvable.
export { RealtimeChannel } from "./channel";

export type Env = {
  AppAgent: DurableObjectNamespace;
  /**
   * Generic realtime channel DO namespace. One instance per channel address
   * (`idFromName("<type>:<id>")`); every socket on it receives every broadcast.
   * Auth + channel authorization happen at the worker gate before forwarding.
   */
  REALTIME_CHANNEL: DurableObjectNamespace<RealtimeChannel>;
  /** Service binding to the web app Worker (prod only). */
  WEB?: Fetcher;
  /** Web app origin for session validation in dev (next dev on the shared netns). */
  WEB_ORIGIN?: string;
  /** Anthropic API key — a worker secret (.dev.vars in dev). */
  ANTHROPIC_API_KEY?: string;
  /**
   * Workers AI binding (wrangler `[ai] binding = "AI"`). Lets the agent run open
   * (Workers AI) models via `createWorkersAI({ binding: env.AI })`, mirroring the
   * app worker (#203). Optional: when unset (e.g. a Workers AI model selected but
   * no binding configured), the chat engine falls back to the default Claude.
   */
  AI?: Ai;
  /** Fallback Anthropic model id; the live value comes from agent-context. */
  CHAT_MODEL?: string;
  /** Fallback max tokens per response; the live value comes from agent-context. */
  CHAT_MAX_TOKENS?: string;
  /**
   * Cloudflare AI Gateway routing (optional; mirrors apps/web). When
   * CLOUDFLARE_ACCOUNT_ID + AI_GATEWAY_ID are set, Anthropic calls route through
   * the gateway for usage/cost analytics; unset → direct Anthropic.
   */
  CLOUDFLARE_ACCOUNT_ID?: string;
  AI_GATEWAY_ID?: string;
  /** Gateway auth token (`cf-aig-authorization`) for an authenticated gateway. */
  AI_GATEWAY_TOKEN?: string;
  /**
   * Shared secret for server-to-server agent → web calls that happen without a
   * user cookie (scheduled wakes). Sent as `x-agents-internal-secret` to
   * `/api/internal/*`; the web app asserts the userId on the agent's behalf.
   */
  AGENTS_INTERNAL_SECRET?: string;
};

type AppAgentState = {
  counter: number;
};

/**
 * Per-connection auth, persisted in the WebSocket's HIBERNATION attachment via
 * `connection.setState()`. This MUST survive DO hibernation: when a hibernated
 * DO wakes on an incoming message, `webSocketMessage` → `onMessage` fires but
 * `onConnect` is NOT re-run, so anything kept in an in-memory field is gone.
 * Keep this object tiny — the attachment has a small byte budget shared with
 * SDK internals.
 */
type ConnAuth = { cookie: string; validatedAt: number };

function readConnAuth(connection: Connection): ConnAuth | null {
  const s = connection.state as ConnAuth | null;
  return s && typeof s.cookie === "string" ? s : null;
}

/** Re-validate an open WebSocket's session at most this often. */
const WS_REVALIDATE_MS = 60_000;

/**
 * AppAgent — Coomander as a per-user Durable Object; exactly one instance per
 * user, and the instance name IS the validated Better Auth user id. The
 * worker-level fetch handler below derives the name from the session and never
 * trusts client-supplied names, so reaching this code means the request was
 * authenticated.
 *
 * Instance URLs (rewritten by the worker): /agents/app-agent/<userId>/...
 */
export class AppAgent extends Agent<Env, AppAgentState> {
  initialState: AppAgentState = { counter: 0 };

  // Working buffer of recent thread turns, hydrated lazily from the web API on
  // cold start (DO eviction loses it; the web DB is the source of truth).
  // In-memory: rebuilt on demand, capped to the chat context window. Keyed by
  // conversationId — always the "coomander" sentinel for Coomander's single
  // unified thread; the Map shape is kept for template parity.
  private buffers = new Map<string, BufferTurn[]>();

  async onConnect(connection: Connection, ctx: ConnectionContext) {
    const cookie = ctx.request.headers.get("cookie");
    if (!cookie) {
      // The worker gate should make this unreachable; defense in depth.
      console.warn(`[AppAgent ${this.name}] connection without cookie — closing`);
      connection.close(1008, "unauthorized");
      return;
    }
    // Persist auth in the hibernation-safe connection attachment (NOT an
    // in-memory field) — onConnect does not re-run on hibernation wake, so the
    // message handler must be able to read this after eviction. See ConnAuth.
    connection.setState({ cookie, validatedAt: Date.now() } satisfies ConnAuth);
    console.log(`[AppAgent ${this.name}] connection ${connection.id} opened`);
  }

  async onRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname.endsWith("/health")) {
      return Response.json({ ok: true, agent: this.name });
    }

    // setState persists to the DO's embedded SQLite — state survives across
    // requests and container restarts.
    if (request.method === "POST" && url.pathname.endsWith("/counter")) {
      const counter = this.state.counter + 1;
      this.setState({ counter });
      return Response.json({ counter });
    }

    if (request.method === "GET" && url.pathname.endsWith("/counter")) {
      return Response.json({ counter: this.state.counter });
    }

    // ── Control surface ──────────────────────────────────────────────────
    // The worker gate guarantees this instance belongs to the calling user,
    // so these let the user drive their own agent's outbound + schedules
    // (also the dev/test entry points for the scheduling + delivery paths).

    if (request.method === "POST" && url.pathname.endsWith("/proactive")) {
      const { message } = (await request.json().catch(() => ({}))) as {
        message?: string;
      };
      if (!message) return new Response("message required", { status: 400 });
      return Response.json(await this.deliverProactive(message));
    }

    if (request.method === "POST" && url.pathname.endsWith("/schedule")) {
      const { delaySeconds, message } = (await request
        .json()
        .catch(() => ({}))) as { delaySeconds?: number; message?: string };
      if (!delaySeconds || !message) {
        return new Response("delaySeconds and message required", { status: 400 });
      }
      const scheduleId = await this.scheduleProactive(delaySeconds, message);
      return Response.json({ scheduleId });
    }

    if (request.method === "GET" && url.pathname.endsWith("/schedules")) {
      return Response.json({ schedules: this.listScheduledWakes() });
    }

    if (request.method === "POST" && url.pathname.endsWith("/cancel")) {
      const { id } = (await request.json().catch(() => ({}))) as { id?: string };
      if (!id) return new Response("id required", { status: 400 });
      return Response.json({ cancelled: await this.cancelScheduledWake(id) });
    }

    return new Response("Not found", { status: 404 });
  }

  async onMessage(connection: Connection, message: string | ArrayBuffer) {
    // 1. Re-validate the session (rate-limited) before doing any work.
    const ok = await this.revalidateConnection(connection);
    if (!ok) return;

    // 2. Parse the frame. Anything that isn't a chat turn is ignored (kept for
    //    forward-compat: other frame types can be added without breaking this).
    const frame = parseClientFrame(message);
    if (!frame) return;

    // Auth is persisted in the connection attachment (survives hibernation);
    // revalidateConnection above already confirmed it, so this is just the read.
    const auth = readConnAuth(connection);
    if (!auth) {
      connection.close(1008, "unauthorized");
      return;
    }

    // 3. Delegate to the chat module. onMessage stays thin — chat.ts owns the
    //    per-turn Coomander context fetch, the Anthropic call, the tool-use
    //    loop, persistence, and tag stripping.
    const deps: ChatDeps = {
      env: this.env,
      userId: this.name,
      cookie: auth.cookie,
      tools: this.getTools(),
      send: (serverFrame) => connection.send(JSON.stringify(serverFrame)),
      getBuffer: (conversationId) => this.getBuffer(auth.cookie, conversationId),
    };

    await handleChatTurn(deps, frame);
  }

  /**
   * Return the working buffer for the Coomander thread, hydrating recent turns
   * from the web API on first access (cold start). The buffer is mutated in
   * place by the chat loop as new turns are appended, so subsequent turns on the
   * same live DO reuse it without re-fetching.
   */
  private async getBuffer(cookie: string, conversationId: string): Promise<BufferTurn[]> {
    const existing = this.buffers.get(conversationId);
    if (existing) return existing;

    const limit = getChatConfig(this.env).contextWindowSize;
    const hydrated = await hydrateMessages(this.env, cookie, limit);
    const buffer: BufferTurn[] = hydrated.map((m) => ({ role: m.role, content: m.content }));
    this.buffers.set(conversationId, buffer);
    return buffer;
  }

  /**
   * Sessions are validated at upgrade time, but sockets outlive sessions —
   * re-check (rate-limited) so a signed-out/expired session loses its socket
   * on the next message instead of living forever. Failures close the
   * connection cleanly; they never throw out of onMessage.
   */
  private async revalidateConnection(connection: Connection): Promise<boolean> {
    const auth = readConnAuth(connection);
    if (!auth) {
      connection.close(1008, "unauthorized");
      return false;
    }
    if (Date.now() - auth.validatedAt < WS_REVALIDATE_MS) return true;

    try {
      const user = await validateSessionCookie(auth.cookie, this.env);
      if (!user || user.id !== this.name) {
        console.warn(`[AppAgent ${this.name}] session no longer valid — closing ${connection.id}`);
        connection.close(1008, "session expired");
        return false;
      }
      // Refresh the rate-limit window in the durable attachment so the next
      // hibernation wake also starts inside the 60s window.
      connection.setState({ cookie: auth.cookie, validatedAt: Date.now() } satisfies ConnAuth);
      return true;
    } catch (err) {
      // Web app unreachable (e.g. mid-restart): close cleanly, no crash loop.
      console.error(`[AppAgent ${this.name}] re-validation unavailable — closing ${connection.id}`, err);
      connection.close(1011, "session validation unavailable");
      return false;
    }
  }

  // ────────────────────────────────────────────────────────────────────────
  // Extension surface (tools / scheduling / outbound channel)
  //
  // Subclasses extend the agent WITHOUT editing this core file:
  //   • registerTool(tool)        — add an LLM-callable tool
  //   • override onScheduledWakeHook — change what a scheduled wake does
  //   • override onUndeliverable   — change the proactive-delivery fallback
  // ────────────────────────────────────────────────────────────────────────

  /** Extra tools registered by subclasses (beyond the built-ins). */
  private extraTools: AgentTool[] = [];

  /**
   * Register a tool the model can call. Call from a subclass (e.g. its
   * constructor). Re-registering a name replaces the prior definition.
   */
  registerTool(tool: AgentTool): void {
    this.extraTools = this.extraTools.filter((t) => t.name !== tool.name);
    this.extraTools.push(tool);
  }

  /**
   * Worker-side tools exposed to the model on every chat turn:
   * `schedule_followup` + anything registered via registerTool(). Coomander's
   * domain tools (log_drop, advance_content_state) are NOT listed here — their
   * definitions come from /api/coomander/agent-context each turn and the chat
   * loop adds them itself (see chat.ts).
   */
  protected getTools(): AgentTool[] {
    return [makeScheduleFollowupTool(this), ...this.extraTools];
  }

  /** Build the ToolContext handed to tool handlers for a given turn. */
  protected toolContext(cookie?: string): ToolContext {
    return { userId: this.name, cookie, env: this.env };
  }

  /**
   * Schedule a proactive message to the user. `when` is delay-seconds, a Date,
   * or a cron string (per the Agents SDK). Returns the schedule id. The SDK
   * invokes `onScheduledWake` when it fires (miniflare alarms in dev).
   */
  async scheduleProactive(
    when: number | Date | string,
    message: string,
    conversationId?: string,
  ): Promise<string> {
    const schedule = await this.schedule(when, "onScheduledWake", { message, conversationId });
    return schedule.id;
  }

  /** List pending schedules (proxy to the SDK). */
  listScheduledWakes() {
    return this.getSchedules();
  }

  /** Cancel a pending schedule by id. */
  async cancelScheduledWake(id: string): Promise<boolean> {
    return this.cancelSchedule(id);
  }

  /**
   * SDK-invoked callback for scheduled wakes (one-time schedules auto-delete
   * after firing). Subclasses override `onScheduledWakeHook` to change wake
   * behavior rather than touching this dispatch method.
   */
  async onScheduledWake(payload: { message: string; conversationId?: string }): Promise<void> {
    await this.onScheduledWakeHook(payload.message, payload.conversationId);
  }

  protected async onScheduledWakeHook(message: string, conversationId?: string): Promise<void> {
    // Persist the reminder into the user's Coomander thread first (so it
    // survives reload and shows when the user reopens the chat), THEN deliver
    // the live nudge. A persistence failure must not block delivery, so it's
    // caught and logged.
    if (conversationId) {
      try {
        await appendMessageInternal(this.env, this.name, conversationId, "assistant", message);
      } catch (err) {
        console.error(`[AppAgent ${this.name}] failed to persist proactive message`, err);
      }
    }
    await this.deliverProactive(message, conversationId);
  }

  /**
   * Deliver a proactive message: push to any live WebSocket first; if none are
   * connected, fall back to `onUndeliverable`. `conversationId` (when present)
   * tells the client which thread the message was persisted into so it can
   * render it in place. Returns how it was delivered.
   */
  async deliverProactive(
    message: string,
    conversationId?: string,
  ): Promise<{ delivered: boolean; via: "ws" | "fallback" }> {
    const hasConnection = [...this.getConnections()].length > 0;
    if (hasConnection) {
      this.broadcast(JSON.stringify({ type: "proactive", message, conversationId }));
      return { delivered: true, via: "ws" };
    }
    await this.onUndeliverable(message);
    return { delivered: false, via: "fallback" };
  }

  /**
   * Fallback when no socket is connected.
   *
   * ⚠️ COOMANDER DIVERGENCE from the AppSeed template (#192): the template
   * persists an in-app notification (NotificationBell). Coomander's users live
   * on Telegram — its cron pings and inbound classification already run over
   * that channel — so an undeliverable proactive nudge is sent to Telegram via
   * the internal `/api/internal/telegram-deliver` route (which uses the
   * existing apps/web sendTelegram path). A user with no linked Telegram chat
   * is a no-op on the web side; the reminder is still persisted to the thread.
   */
  protected async onUndeliverable(message: string): Promise<void> {
    await deliverTelegramFallback(this.env, this.name, message);
  }
}

/**
 * Constant-time string comparison for shared secrets, using only Web-standard
 * APIs so it's safe regardless of the Worker's compat flags (no `node:crypto`
 * dependency). A plain `a === b` short-circuits on the first differing byte,
 * leaking how much of a guessed secret was correct via timing. We compare the
 * UTF-8 bytes and XOR-accumulate over the full length so the work is constant
 * for equal-length inputs; the length check fast-fails (length isn't secret).
 */
function timingSafeEqualStr(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const enc = new TextEncoder();
  const aBytes = enc.encode(a);
  const bBytes = enc.encode(b);
  if (aBytes.length !== bBytes.length) return false;
  let diff = 0;
  for (let i = 0; i < aBytes.length; i++) {
    diff |= aBytes[i] ^ bBytes[i];
  }
  return diff === 0;
}

/** Binding name kebab-cased, per the Agents SDK routing convention. */
const AGENT_PATH_PREFIX = "/agents/app-agent/";

/**
 * The client never chooses the instance: whatever name it supplies is
 * replaced with the validated session's user id. Returns null for paths that
 * aren't the AppAgent namespace.
 */
export function rewriteAgentPath(url: URL, userId: string): URL | null {
  if (!url.pathname.startsWith(AGENT_PATH_PREFIX)) return null;
  const rest = url.pathname.slice(AGENT_PATH_PREFIX.length); // "<name>/..." or "<name>" or ""
  const slash = rest.indexOf("/");
  const tail = slash === -1 ? "" : rest.slice(slash);
  const rewritten = new URL(url.toString());
  rewritten.pathname = `${AGENT_PATH_PREFIX}${encodeURIComponent(userId)}${tail}`;
  return rewritten;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Worker-level liveness check — the only unauthenticated route.
    if (url.pathname === "/agents/health" || url.pathname === "/health") {
      return Response.json({ ok: true });
    }

    // ── Internal publish trigger (server-to-server, NO user session) ───────
    // Handled BEFORE the session gate — like /health — because this is a
    // server-to-server seam (apps/web's publish() re-backing onto a realtime
    // channel via the REALTIME service binding, #222), authenticated by the
    // shared internal secret, not a user cookie. Body: { channel, event }.
    // Returns { delivered: <count> }.
    if (request.method === "POST" && url.pathname === "/realtime/internal/publish") {
      const expected = env.AGENTS_INTERNAL_SECRET;
      const provided = request.headers.get("x-agents-internal-secret");
      if (!expected || !timingSafeEqualStr(provided, expected)) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      const body = (await request.json().catch(() => null)) as
        | { channel?: unknown; event?: unknown }
        | null;
      const channel = typeof body?.channel === "string" ? body.channel : null;
      if (!channel) {
        return Response.json({ error: "channel required" }, { status: 400 });
      }
      const parsed = parseChannel(channel);
      if (!parsed) {
        return Response.json({ error: "invalid channel" }, { status: 400 });
      }
      const stub = env.REALTIME_CHANNEL.get(
        env.REALTIME_CHANNEL.idFromName(parsed.raw),
      );
      const res = await stub.fetch(buildChannelPublishRequest(body?.event));
      const { delivered } = (await res.json().catch(() => ({ delivered: 0 }))) as {
        delivered?: number;
      };
      return Response.json({ delivered: delivered ?? 0 });
    }

    let user: SessionUser | null;
    try {
      user = await validateSessionCookie(request.headers.get("cookie"), env);
    } catch (err) {
      if (err instanceof SessionCheckUnavailableError) {
        return Response.json({ error: "session validation unavailable" }, { status: 503 });
      }
      throw err;
    }

    if (!user) {
      // Also covers WebSocket upgrades: a non-101 response refuses the
      // handshake cleanly before any DO is instantiated.
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    // ── Generic realtime channel routing (/realtime/<type>:<id>) ───────────
    // The session is already validated above (validate once). Now authorize
    // the specific channel, then forward the upgrade to the channel DO. The DO
    // never sees an unauthenticated/unauthorized request: a non-101 response
    // here refuses the handshake before any DO is touched.
    if (url.pathname.startsWith("/realtime/")) {
      // The channel address is the (URL-decoded) segment after "/realtime/".
      const channelSegment = decodeURIComponent(
        url.pathname.slice("/realtime/".length),
      );
      const parsed = parseChannel(channelSegment);
      if (!parsed) {
        return Response.json({ error: "invalid channel" }, { status: 400 });
      }

      // Single authorization seam: deny channels the user doesn't own and any
      // unknown channel type (see authorizeChannel). This rejects
      // /realtime/user:<otherId> for a non-owner and any unknown type.
      if (!authorizeChannel(parsed, user)) {
        return Response.json({ error: "forbidden" }, { status: 403 });
      }

      // Only WebSocket upgrades are forwarded to the channel DO. A non-WS GET/
      // POST to a user-facing /realtime/<channel> path isn't part of this
      // surface (the publish trigger has its own pre-auth route above).
      if (request.headers.get("upgrade") !== "websocket") {
        return Response.json(
          { error: "expected websocket upgrade" },
          { status: 426 },
        );
      }

      // Forward to the channel DO, passing ONLY gate-validated identity via
      // internal headers (the DO trusts these, not client-supplied identity).
      // The cookie flows through so the DO can revalidate the session later.
      // Build a fresh Request so we can attach the internal headers while
      // preserving the Upgrade header (the WebSocket constructor on `new
      // Request(url, request)` carries the upgrade + webSocket through).
      const headers = new Headers(request.headers);
      headers.set("x-realtime-user", user.id);
      headers.set("x-realtime-channel", parsed.raw);
      const forwarded = new Request(request, { headers });
      const stub = env.REALTIME_CHANNEL.get(
        env.REALTIME_CHANNEL.idFromName(parsed.raw),
      );
      return stub.fetch(forwarded);
    }

    const rewritten = rewriteAgentPath(url, user.id);
    if (!rewritten) return new Response("Not found", { status: 404 });

    const forwarded = new Request(rewritten, request);
    return (
      (await routeAgentRequest(forwarded, env)) ??
      new Response("Not found", { status: 404 })
    );
  },
} satisfies ExportedHandler<Env>;
