/**
 * Pure, framework-free protocol + state logic for the agents-worker WebSocket
 * chat transport — the SINGLE mobile chat transport (#203; the POST/SSE fallback
 * was removed). NO React/React Native imports — this module is the unit-tested
 * heart of the mobile streaming path and must stay portable.
 *
 * It mirrors the wire protocol the agents Worker speaks (apps/agents/src/chat.ts
 * for chat-turn frames) and the web client that already consumes it
 * (apps/web/lib/use-agent-chat.ts). Agent-initiated messages
 * (apps/agents/src/index.ts `deliverProactive`) publish to the realtime
 * channel instead — see the note below.
 *
 * ── WebSocket protocol ────────────────────────────────────────────────────
 * Client → server (one JSON frame per user turn):
 *   { type: "chat", conversationId: string | null, message: string,
 *     userContext?: string }
 *   (userContext is IGNORED server-side for Coomander — context is rendered from
 *    the user's live ops data — but the field is kept for template parity.)
 *
 * Server → client (multiple frames):
 *   { type: "conversation"; conversationId }          // always "coomander"
 *   { type: "token"; text }                            // streamed model delta
 *   { type: "done"; conversationId; fullText }         // final, tag-stripped
 *   { type: "error"; message }                         // user-safe failure
 *
 * The hook (use-agent-socket.ts) wraps a raw RN WebSocket, parses each frame
 * with `parseServerFrame`, and folds it into `StreamState` via `reduce`.
 *
 * Agent-initiated ("proactive") messages no longer ride this socket (#222) —
 * the agent is a TENANT of the realtime layer and publishes them as
 * `{ type: "agent-message", ... }` on the user's `user:<id>` realtime channel
 * instead (see `use-realtime.ts`).
 */

/** Coomander has one unified thread per user; this is the sentinel id. */
export const COOMANDER_CONVERSATION_ID = "coomander";

/**
 * The agents Worker routes `/agents/<kebab-binding>/<name>`. The binding is
 * `AppAgent` → `app-agent`; the Worker ignores the client-supplied name and
 * routes by the validated session userId, so the name is cosmetic.
 */
export const AGENT_PATH_PREFIX = "/agents/app-agent";

// ── Wire frames ─────────────────────────────────────────────────────────────

/** A user turn sent client → server. */
export interface ClientFrame {
  type: "chat";
  conversationId: string | null;
  message: string;
  userContext?: string;
}

/** Any frame the server may send back. */
export type ServerFrame =
  | { type: "conversation"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "done"; conversationId: string; fullText: string }
  | { type: "error"; message: string };

/**
 * Parse a raw WebSocket payload into a typed ServerFrame, or null if it isn't a
 * well-formed frame. Defensive by contract: it NEVER throws — malformed JSON,
 * non-string payloads (Blob/ArrayBuffer), wrong/missing `type`, or missing
 * required fields all return null so the caller can simply ignore them.
 */
export function parseServerFrame(data: unknown): ServerFrame | null {
  if (typeof data !== "string") return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;

  const o = parsed as Record<string, unknown>;
  switch (o.type) {
    case "conversation":
      return typeof o.conversationId === "string"
        ? { type: "conversation", conversationId: o.conversationId }
        : null;
    case "token":
      return typeof o.text === "string" ? { type: "token", text: o.text } : null;
    case "done":
      return typeof o.conversationId === "string" && typeof o.fullText === "string"
        ? { type: "done", conversationId: o.conversationId, fullText: o.fullText }
        : null;
    case "error":
      return typeof o.message === "string" ? { type: "error", message: o.message } : null;
    default:
      return null;
  }
}

/** Serialize a user turn into the JSON `chat` frame the Worker expects. */
export function encodeChatFrame(args: {
  conversationId: string | null;
  message: string;
  userContext?: string;
}): string {
  const frame: ClientFrame = {
    type: "chat",
    conversationId: args.conversationId,
    message: args.message,
    ...(args.userContext !== undefined ? { userContext: args.userContext } : {}),
  };
  return JSON.stringify(frame);
}

/**
 * Build the WebSocket URL from the HTTP API base: swap the scheme
 * (http→ws / https→wss) and append the agent instance path. `name` is cosmetic
 * (the Worker routes by validated session), defaulting to "me".
 */
export function buildWsUrl(apiUrl: string, name = "me"): string {
  const base = apiUrl.replace(/\/+$/, "");
  // Normalize the scheme to a lowercase ws/wss (literal replacements, so an
  // uppercase HTTPS:// can't leak a stray uppercase letter into the scheme).
  // `https` is checked first; `^http:` won't match `https:` anyway (no colon
  // after "http"), so the order is just for clarity.
  const wsBase = base.replace(/^https:/i, "wss:").replace(/^http:/i, "ws:");
  return `${wsBase}${AGENT_PATH_PREFIX}/${encodeURIComponent(name)}`;
}

// ── Stream reducer (the testable heart) ──────────────────────────────────────

/**
 * The evolving state of the live WebSocket stream for the current turn. The
 * screen renders the in-progress assistant bubble from `streamingText` (then
 * `finalText` on done) and reacts to `done` / `error`.
 *
 * Agent-initiated ("proactive") messages no longer flow through this state
 * (#222) — they arrive on the realtime channel (`use-realtime.ts`) as
 * `{ type: "agent-message", ... }` and are handled independently by the
 * screen.
 */
export interface StreamState {
  /** Tokens accumulated for the in-flight assistant turn (null when idle). */
  streamingText: string | null;
  /** The final, tag-clean assistant text once `done` arrives (null until then). */
  finalText: string | null;
  /** Conversation id tracked from `conversation` / `done` frames. */
  conversationId: string | null;
  /** True once the in-flight turn finishes (a `done` frame arrived). */
  done: boolean;
  /** A user-safe error surfaced this turn (null = none). */
  error: string | null;
}

export const initialStreamState: StreamState = {
  streamingText: null,
  finalText: null,
  conversationId: null,
  done: false,
  error: null,
};

/**
 * Fold one server frame into the stream state. Pure and immutable — always
 * returns a NEW object; never mutates the input. Unknown frame types return
 * the same state reference.
 *
 *   conversation → track conversationId (no text change)
 *   token        → append the delta to streamingText (null treated as "")
 *   done         → finalize: clear streamingText, set finalText + conversationId,
 *                  mark done
 *   error        → surface the message, clear streamingText
 */
export function reduce(state: StreamState, frame: ServerFrame): StreamState {
  switch (frame.type) {
    case "conversation":
      return { ...state, conversationId: frame.conversationId };
    case "token":
      return { ...state, streamingText: (state.streamingText ?? "") + frame.text };
    case "done":
      return {
        ...state,
        streamingText: null,
        finalText: frame.fullText,
        conversationId: frame.conversationId,
        done: true,
      };
    case "error":
      return { ...state, streamingText: null, error: frame.message };
    default:
      return state;
  }
}

/**
 * Reset the per-turn fields before sending a new turn (or after handling a
 * finished/errored one). Preserves `conversationId`.
 */
export function resetTurn(state: StreamState): StreamState {
  return { ...state, streamingText: null, finalText: null, done: false, error: null };
}
