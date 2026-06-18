/**
 * Coomander chat loop — the WebSocket counterpart to the JSON POST
 * /api/coomander/chat path (which stays as the flag-off fallback).
 *
 * Lives in its own module so `AppAgent.onMessage` stays thin: the agent runs
 * the auth `revalidateConnection` gate, then delegates the parsed user turn
 * here. This module owns the per-turn context fetch, the Anthropic call, the
 * tool-use loop, token streaming back over the socket, thread persistence
 * through the web API, and tag stripping.
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
 *    history is merged alternating-role before the Anthropic call.
 * 5. Tool actions are collected and persisted in the assistant turn's meta, and
 *    summed token usage rides the assistant append for cost logging.
 */

import Anthropic from "@anthropic-ai/sdk";
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
  /** Send a JSON frame back over the socket. */
  send: (frame: ServerFrame) => void;
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

let _client: Anthropic | null = null;
function getClient(env: Env): Anthropic {
  if (!_client) {
    // ANTHROPIC_API_KEY is a worker secret (.dev.vars in dev). Pass it
    // explicitly — workerd has no process.env auto-resolution.
    _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/** Map app-level tools to the Anthropic tool definition shape. */
function toAnthropicTools(tools: AgentTool[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Tool.InputSchema,
  }));
}

/**
 * Merge consecutive same-role turns and drop leading assistant turns so the
 * array is valid for the Anthropic API (alternating, starts with user). The
 * Coomander thread interleaves Telegram pings, which produce consecutive
 * assistant rows.
 */
export function mergeAlternating(turns: BufferTurn[]): Anthropic.MessageParam[] {
  const merged: Anthropic.MessageParam[] = [];
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

function addUsage(total: TurnUsage, usage: Anthropic.Usage | undefined): void {
  if (!usage) return;
  total.input_tokens += usage.input_tokens ?? 0;
  total.output_tokens += usage.output_tokens ?? 0;
  total.cache_creation_input_tokens =
    (total.cache_creation_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  total.cache_read_input_tokens =
    (total.cache_read_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
}

/**
 * Run one user turn end to end: fetch the Coomander context, gate on
 * entitlement, persist the user message, stream the model response (driving the
 * tool-use loop), persist the assistant message, and emit a final `done` frame.
 * All failures are reported to the client as a user-safe `error` frame; this
 * function never throws.
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

  // ── Run the model (tool-use loop) ────────────────────────────────────────
  const ctx: ToolContext = { userId, cookie, env, conversationId };

  // Coomander domain tools (web-served defs, web-executed handlers) + worker
  // tools. Actions are collected for the assistant turn's meta.
  const actions: string[] = [];
  const tools: AgentTool[] = [
    ...context.tools.map((t) => makeCoomanderTool(t, (a) => actions.push(a))),
    ...deps.tools,
  ];
  const anthropicTools = toAnthropicTools(tools);

  // The model-facing message history. The thread can hold consecutive same-role
  // turns (Telegram pings), so merge before the first call; tool iterations
  // then append valid alternating blocks in place.
  const messages: Anthropic.MessageParam[] = mergeAlternating(buffer);

  let assistantText = "";
  const usage: TurnUsage = { input_tokens: 0, output_tokens: 0 };
  const client = getClient(env);

  try {
    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
      const stream = client.messages.stream({
        model: context.model,
        max_tokens: context.maxTokens,
        // Cache the (large, live-data) system prompt within the turn's tool
        // iterations — mirror of coomanderChat's cache_control usage.
        system: [
          { type: "text", text: context.systemPrompt, cache_control: { type: "ephemeral" } },
        ],
        messages,
        ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
      });

      // Stream text deltas straight to the client as they arrive.
      stream.on("text", (text) => {
        assistantText += text;
        send({ type: "token", text });
      });

      const final = await stream.finalMessage();
      addUsage(usage, final.usage);

      // Preserve the full assistant content (text + tool_use blocks) so the
      // next request carries the tool_use ids the tool_results refer to.
      messages.push({ role: "assistant", content: final.content });

      if (final.stop_reason !== "tool_use") {
        break;
      }

      // Dispatch every tool_use block; collect tool_result blocks for the
      // follow-up turn. A handler throw becomes an is_error tool_result so the
      // model can recover gracefully rather than the whole turn failing.
      const toolUses = final.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const use of toolUses) {
        const tool = tools.find((t) => t.name === use.name);
        if (!tool) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: `Unknown tool: ${use.name}`,
          });
          continue;
        }
        try {
          const result = await tool.handler((use.input ?? {}) as Record<string, unknown>, ctx);
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            content: typeof result === "string" ? result : JSON.stringify(result),
          });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: err instanceof Error ? err.message : String(err),
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  } catch (err) {
    console.error(`[AppAgent ${userId}] model stream error`, err);
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
