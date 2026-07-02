/**
 * Coomander chat loop — the WebSocket counterpart to the JSON POST
 * /api/coomander/chat path (which stays as the flag-off fallback).
 *
 * Lives in its own module so `AppAgent.onMessage` stays thin: the agent runs
 * the auth `revalidateConnection` gate, then delegates the parsed user turn
 * here. This module owns the per-turn context fetch, the model call, the
 * tool-use loop, token streaming back over the socket, thread persistence
 * through the web API, and tag stripping.
 *
 * As of epic #203 the model call runs through the SAME multi-provider Vercel AI
 * SDK path (`streamText`) the web SSE engine uses: the active catalog entry
 * (admin switcher / per-user pref, fetched per turn via agent-context) is mapped
 * to an AI SDK `LanguageModel` by the per-worker provider wiring (chat-model.ts),
 * dispatching Claude (BYOK Anthropic, optionally via AI Gateway) and open
 * (Workers AI) models. The raw `@anthropic-ai/sdk` single-provider loop this
 * file used to run was removed. All of Coomander's DOMAIN logic — entitlement
 * gate, single-thread persistence, tool actions in meta, token-usage logging,
 * tag stripping — is preserved unchanged.
 *
 * ── WebSocket protocol (identical to the AppSeed template) ────────────────
 * Client → server (one JSON frame per user turn):
 *   { type: "chat", conversationId: string | null, message: string,
 *     userContext?: string }
 *
 * Server → client (multiple frames):
 *   { type: "conversation", conversationId } // always "coomander" (one thread)
 *   { type: "token", text }                  // streamed model delta
 *   { type: "done", conversationId, fullText } // final, tag-stripped text
 *   { type: "error", message }               // user-safe failure
 *
 * ── Coomander adaptations vs the template ─────────────────────────────────
 * 1. No conversations: the Coomander thread is one per-user stream
 *    (coomander_message_log), so conversationId is the sentinel "coomander"
 *    and there is no create step.
 * 2. The system prompt, model, max-tokens, and domain tool schemas are fetched
 *    per turn from GET /api/coomander/agent-context — the web app
 *    (lib/coomander/coomanderChat.ts) stays the single source of truth.
 *    userContext from the client frame is IGNORED: Coomander's context is
 *    server-rendered from the user's live ops data, never client-supplied.
 * 3. Entitlement: the context reports `entitled` (= Coomander ops enabled); a
 *    non-enabled user gets a user-safe error frame and no model call. The web
 *    routes enforce the same gate server-side on the user-turn append.
 * 4. The thread interleaves Telegram pings (consecutive assistant turns), so
 *    history is merged alternating-role before the model call.
 * 5. Tool actions are collected and persisted in the assistant turn's meta, and
 *    summed token usage rides the assistant append for cost logging.
 */

import {
  streamText,
  stepCountIs,
  type ModelMessage,
  type SystemModelMessage,
  type ToolSet,
} from "ai";
import { getModel, DEFAULT_MODEL_ID } from "@coomander/core";
import type { Env } from "./index";
import {
  AgentContextUnavailableError,
  fetchAgentContext,
  stripTags,
} from "./chat-config";
import {
  PersistenceUnavailableError,
  appendMessage,
  type TurnUsage,
} from "./persistence";
import { resolveAgentModel, toAiSdkTools } from "./chat-model";
import { makeCoomanderTool } from "./tools";
import type { AgentTool, ToolContext } from "./types";

/** Mirror of the web chat limits: reject empty/oversized inputs pre-model. */
const MAX_MESSAGE_CHARS = 100_000;
/** Hard ceiling on tool-use iterations so a misbehaving tool can't loop forever. */
const MAX_TOOL_ITERATIONS = 10;

/** The Coomander thread sentinel — Coomander has one unified thread per user. */
export const COOMANDER_CONVERSATION_ID = "coomander";

/** A single conversational turn in the working buffer. */
export interface BufferTurn {
  role: "user" | "assistant";
  content: string;
}

/** What the chat loop reads/writes against (the AppAgent provides these). */
export interface ChatDeps {
  env: Env;
  /** Validated user id == agent instance name. */
  userId: string;
  /** The requesting connection's cookie (authn for persistence + tools). */
  cookie: string;
  /** Worker-side tools (e.g. schedule_followup); Coomander domain tools are
   *  added per turn from the fetched agent context. */
  tools: AgentTool[];
  /**
   * Send a JSON frame back over the socket. Returns false when the frame could
   * NOT be delivered (socket closed/erroring mid-turn) so the loop can abandon
   * the turn cleanly instead of throwing — see `safeSend` in index.ts.
   */
  send: (frame: ServerFrame) => boolean;
  /**
   * Working buffer of prior turns, hydrated lazily on cold start. Keyed by
   * conversationId ("coomander"). The AppAgent owns the Map so it survives
   * across messages on the same live DO; the loop reads/appends to the array.
   */
  getBuffer: (conversationId: string) => Promise<BufferTurn[]>;
}

export type ClientFrame = {
  type: "chat";
  conversationId: string | null;
  message: string;
  userContext?: string;
};

export type ServerFrame =
  | { type: "conversation"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "done"; conversationId: string; fullText: string }
  | { type: "error"; message: string };

/** Parse a raw WS frame into a ClientFrame, or null if it isn't a chat turn. */
export function parseClientFrame(raw: string | ArrayBuffer): ClientFrame | null {
  if (typeof raw !== "string") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== "chat") return null;
  if (typeof obj.message !== "string") return null;
  const conversationId =
    typeof obj.conversationId === "string" && obj.conversationId.length > 0
      ? obj.conversationId
      : null;
  const userContext = typeof obj.userContext === "string" ? obj.userContext : undefined;
  return { type: "chat", conversationId, message: obj.message, userContext };
}

/** True when the agents worker is configured to route Anthropic through AI Gateway. */
export function isAgentGatewayEnabled(env: Env): boolean {
  return Boolean(env.CLOUDFLARE_ACCOUNT_ID && env.AI_GATEWAY_ID);
}

/**
 * Merge consecutive same-role turns and drop leading assistant turns so the
 * array is valid as model messages (alternating, starts with user). The
 * Coomander thread interleaves Telegram pings, which produce consecutive
 * assistant rows. Returns AI SDK `ModelMessage[]` (text-only content), the shape
 * `streamText` consumes.
 */
export function mergeAlternating(turns: BufferTurn[]): ModelMessage[] {
  const merged: ModelMessage[] = [];
  for (const t of turns) {
    const last = merged[merged.length - 1];
    if (last && last.role === t.role) {
      last.content = `${last.content as string}\n\n${t.content}`;
    } else {
      merged.push({ role: t.role, content: t.content });
    }
  }
  while (merged.length && merged[0].role === "assistant") merged.shift();
  return merged;
}

/**
 * Run one user turn end to end: fetch the Coomander context, gate on
 * entitlement, persist the user message, stream the model response (driving the
 * tool-use loop via streamText's native multi-step tools), persist the assistant
 * message, and emit a final `done` frame. All failures are reported to the
 * client as a user-safe `error` frame; this function never throws.
 */
export async function handleChatTurn(deps: ChatDeps, frame: ClientFrame): Promise<void> {
  const { env, userId, cookie, send } = deps;

  const message = frame.message.trim();
  if (!message) {
    send({ type: "error", message: "Message is empty." });
    return;
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    send({ type: "error", message: "Message is too long." });
    return;
  }

  // ── Per-turn Coomander context (prompt, model, tools, entitlement) ────────
  let context;
  try {
    context = await fetchAgentContext(env, cookie);
  } catch (err) {
    if (err instanceof AgentContextUnavailableError) {
      console.error(`[AppAgent ${userId}] agent-context unavailable`, err);
    } else {
      console.error(`[AppAgent ${userId}] agent-context unexpected error`, err);
    }
    send({ type: "error", message: "Coomander is unavailable right now. Please try again." });
    return;
  }
  if (!context.entitled) {
    send({ type: "error", message: "Turn on Coomander in the app to start chatting." });
    return;
  }

  const conversationId = COOMANDER_CONVERSATION_ID;
  send({ type: "conversation", conversationId });

  // Hydrate prior context (cold start) before appending the new user turn.
  let buffer: BufferTurn[];
  try {
    buffer = await deps.getBuffer(conversationId);
  } catch (err) {
    console.error(`[AppAgent ${userId}] hydrate failed`, err);
    send({ type: "error", message: "Could not load conversation history. Please try again." });
    return;
  }

  try {
    await appendMessage(env, cookie, "user", message);
  } catch (err) {
    console.error(`[AppAgent ${userId}] failed to persist user turn`, err);
    const status = err instanceof PersistenceUnavailableError ? err.status : undefined;
    send({
      type: "error",
      message:
        status === 402
          ? "Turn on Coomander in the app to start chatting."
          : status === 429
            ? "You're sending messages too quickly. Give it a moment."
            : "Could not save your message. Please try again.",
    });
    return;
  }
  buffer.push({ role: "user", content: message });

  // ── Resolve the active model (catalog entry → AI SDK LanguageModel) ───────
  // The agent-context already resolved the model id (admin switcher / per-user
  // pref). Look the entry up in the SAME @coomander/core catalog the web used;
  // an unknown id means catalogs drifted — fall back to the default so chat
  // never hard-fails. resolveAgentModel dispatches the provider client.
  const entry = getModel(context.model) ?? getModel(DEFAULT_MODEL_ID)!;
  const { model, resolvedId } = resolveAgentModel(entry, env);
  const isAnthropic = entry.provider === "anthropic";

  // ── Build the model-facing message history ────────────────────────────────
  // The thread can hold consecutive same-role turns (Telegram pings), so merge
  // before the call; streamText's native multi-step tools append valid
  // alternating blocks in place.
  const messages: ModelMessage[] = mergeAlternating(buffer);

  // ── Tool-use loop wiring ──────────────────────────────────────────────────
  const ctx: ToolContext = { userId, cookie, env, conversationId };

  // Coomander domain tools (web-served defs, web-executed handlers) + worker
  // tools. Actions are collected for the assistant turn's meta — the onAction
  // callback fires inside each tool's execute() while streamText runs the loop.
  const actions: string[] = [];
  const allTools: AgentTool[] = [
    ...context.tools.map((t) => makeCoomanderTool(t, (a) => actions.push(a))),
    ...deps.tools,
  ];
  // Only attach tools when the active model handles them reliably (catalog
  // `supportsTools`). Small Workers AI open models handle the AI-SDK tool
  // protocol poorly — they refuse normal chat or leak raw tool-call JSON as text
  // — so they run tool-free. Claude models keep their tools.
  const aiTools: ToolSet = context.supportsTools ? toAiSdkTools(allTools, ctx) : {};

  // Tag with cf-aig-metadata for per-user/model attribution in the gateway
  // dashboard — only when routing through the gateway. Use the RESOLVED id so
  // the metadata reflects what actually ran (after any fallback).
  const headers = isAgentGatewayEnabled(env)
    ? { "cf-aig-metadata": JSON.stringify({ userId, model: resolvedId }) }
    : undefined;

  let assistantText = "";
  const usage: TurnUsage = { input_tokens: 0, output_tokens: 0 };
  // streamText reports a stream-stopping error to this `onError` callback and
  // simply ENDS the textStream — it does NOT reliably throw. A request the
  // model rejects up front (e.g. an unprocessable image) ends the textStream
  // empty without throwing, so the for-await loop below completes normally
  // with no tokens. Capture the error here and surface it in the unified
  // check after the try/catch; otherwise the turn would silently finalize as
  // an empty `done` (and an empty assistant turn would get persisted) — the
  // client then shows the user nothing: a sent message with no reply.
  let streamError: unknown = null;

  // Lets us stop the model stream (and stop billing) the instant the client
  // socket drops mid-turn — see the send-returns-false bail below — or when
  // the stream goes silent for too long (inactivity watchdog below).
  const abortController = new AbortController();
  // True only when we aborted because the socket is already gone (send()
  // returned false) — the catch block then knows not to bother sending an
  // error frame, since there's no live socket to receive it.
  let closedMidStream = false;

  // Reset on every token; fires if the model stream goes silent for this long
  // (a stalled/misbehaving provider, or a tool call that never resolves) so a
  // turn can never hang the client's spinner forever.
  const STREAM_INACTIVITY_TIMEOUT_MS = 30_000;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const clearWatchdog = () => {
    if (watchdog) {
      clearTimeout(watchdog);
      watchdog = null;
    }
  };
  const armWatchdog = () => {
    clearWatchdog();
    watchdog = setTimeout(() => {
      console.warn(
        `[AppAgent ${userId}] model stream stalled — no token within ${STREAM_INACTIVITY_TIMEOUT_MS}ms; aborting turn`,
      );
      abortController.abort();
    }, STREAM_INACTIVITY_TIMEOUT_MS);
  };

  // Cache the (large, live-data) system prompt — mirror of coomanderChat's
  // cache_control usage. The Anthropic provider reads cache_control from the
  // SYSTEM MESSAGE's providerOptions, so for Claude we pass the prompt as a
  // SystemModelMessage carrying anthropic.cacheControl. Prompt caching is an
  // Anthropic-only feature, so Workers AI models get a plain system string.
  const system: SystemModelMessage | string = isAnthropic
    ? {
        role: "system",
        content: context.systemPrompt,
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      }
    : context.systemPrompt;

  try {
    const result = streamText({
      model,
      system,
      messages,
      maxOutputTokens: context.maxTokens,
      abortSignal: abortController.signal,
      onError: ({ error }) => {
        streamError = error;
      },
      ...(Object.keys(aiTools).length > 0
        ? { tools: aiTools, stopWhen: stepCountIs(MAX_TOOL_ITERATIONS) }
        : {}),
      ...(headers ? { headers } : {}),
    });

    // Some providers throw on a stream-stopping error (caught below); others
    // (AI SDK v6's own error path) report it via `onError` above and just end
    // textStream empty without throwing — the unified check after the
    // try/catch handles both. Stream deltas straight to the client as they
    // arrive AND accumulate the full text.
    armWatchdog();
    for await (const text of result.textStream) {
      // A chunk arrived — the model/stream is alive; reset the stall clock.
      armWatchdog();
      assistantText += text;
      // `send` returns false (never throws) when the socket closed mid-stream
      // (safeSend). Abort the model stream and abandon the turn: there's no
      // open socket to receive a token/done/error frame, and pulling more
      // tokens just burns the model budget for nothing.
      if (!send({ type: "token", text })) {
        clearWatchdog();
        closedMidStream = true;
        abortController.abort();
        console.warn(`[AppAgent ${userId}] client socket closed mid-stream — aborting turn`);
        return;
      }
    }
    clearWatchdog();

    // ── Map AI SDK usage → Coomander's TurnUsage ────────────────────────────
    // A tool-use turn makes MULTIPLE model calls (one per step). `result.usage`
    // is only the FINAL step's usage, so summing it would under-count cost on
    // any turn that called a tool — the old raw loop summed per iteration. Sum
    // across ALL steps to preserve that accounting. inputTokens/outputTokens are
    // the SDK's normalized counts; cache tokens are Anthropic-specific and
    // surface per-step via providerMetadata.anthropic.
    const steps = await result.steps;
    for (const step of steps) {
      usage.input_tokens += step.usage?.inputTokens ?? 0;
      usage.output_tokens += step.usage?.outputTokens ?? 0;
      const anthropicMeta = step.providerMetadata?.anthropic as
        | { cacheCreationInputTokens?: number; cacheReadInputTokens?: number }
        | undefined;
      if (anthropicMeta) {
        if (typeof anthropicMeta.cacheCreationInputTokens === "number") {
          usage.cache_creation_input_tokens =
            (usage.cache_creation_input_tokens ?? 0) + anthropicMeta.cacheCreationInputTokens;
        }
        if (typeof anthropicMeta.cacheReadInputTokens === "number") {
          usage.cache_read_input_tokens =
            (usage.cache_read_input_tokens ?? 0) + anthropicMeta.cacheReadInputTokens;
        }
      }
    }
  } catch (err) {
    clearWatchdog();
    // Some providers DO throw on a stream-stopping error; capture it the same
    // way as the onError callback above so the single check below handles
    // both delivery paths.
    streamError = err;
  }

  // A turn fails either by throwing (caught above) or — more commonly for
  // request-rejection errors — by ending the textStream empty and reporting
  // via `onError`. Either way, surface a user-safe error frame and DON'T
  // finalize: no empty `done` and no empty assistant turn persisted.
  if (streamError) {
    // The socket-close bail above already handled this abort — no live socket
    // to send an error frame to, so stay silent.
    if (closedMidStream) return;
    if (abortController.signal.aborted) {
      // The inactivity watchdog fired — the socket may still be open, so tell
      // the client rather than leaving the spinner hanging forever.
      console.error(`[AppAgent ${userId}] model stream stalled — aborting turn`);
      send({ type: "error", message: "The assistant stopped responding. Please try again." });
      return;
    }
    console.error(`[AppAgent ${userId}] model stream error`, streamError);
    send({ type: "error", message: "Something went wrong. Please try again." });
    return;
  }

  // ── Persist + finalize the assistant turn ────────────────────────────────
  // Strip [TAG:key=value] tags from the displayed/stored text, mirroring the
  // template chat loop. Tool actions ride the meta.
  const cleanText = stripTags(assistantText) || "Done.";

  try {
    await appendMessage(env, cookie, "assistant", cleanText, {
      meta: actions.length ? { actions } : null,
      usage,
      model: context.model,
    });
    buffer.push({ role: "assistant", content: cleanText });
  } catch (err) {
    // The user already saw the streamed reply; a persistence failure here is
    // logged but we still finalize so the UI isn't left hanging.
    if (err instanceof PersistenceUnavailableError) {
      console.error(`[AppAgent ${userId}] failed to persist assistant turn`, err);
    } else {
      console.error(`[AppAgent ${userId}] unexpected persist error`, err);
    }
  }

  send({ type: "done", conversationId, fullText: cleanText });
}
