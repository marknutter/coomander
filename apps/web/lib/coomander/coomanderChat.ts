/**
 * Coomander two-way conversation state (#151).
 *
 * A thin layer over `coomander_message_log` that exposes the running thread as
 * Anthropic-shaped turns, so future milestones can give the classifier and the
 * in-app chat conversational context (and so the full-companion layer has a
 * ready source of history). Outbound Coomander messages map to the "assistant"
 * role, inbound creator messages to "user".
 *
 * Ported/simplified from ~/Code/geology/web/node/lib/geology/geoChat.ts — the
 * geology version also drives an in-app chat endpoint; that surface is deferred
 * for Coomander, so this keeps only the history/context helpers.
 */

import Anthropic from "@anthropic-ai/sdk";
import { listMessages, appendMessage, type CoomanderMessage } from "./coomanderMessages";
import { getCoomanderSettings, userToday } from "./settings";
import { coomanderSystem } from "./agentPrompts";
import { getTodayModel } from "./todayModel";
import { renderContext, daysSinceStart } from "./agent";
import { tools, resolveToolUse, executeAction, loadContext } from "./inbound";
import { logCoomanderUsage } from "./usage";

const MODEL = process.env.COOMANDER_AGENT_MODEL || process.env.CHAT_MODEL || "claude-sonnet-4-6";

/**
 * Public model/token settings, exported so the agents Worker contract route
 * (GET /api/coomander/agent-context, #192) can report the SAME values the
 * in-app POST path uses — keeping the WebSocket and JSON chat paths identical.
 */
export const COOMANDER_CHAT_MODEL = MODEL;
export const COOMANDER_CHAT_MAX_TOKENS = 600;

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/** Map a stored message's direction to an Anthropic chat role. */
export function roleForDirection(direction: CoomanderMessage["direction"]): ChatRole {
  return direction === "inbound" ? "user" : "assistant";
}

/**
 * The recent thread as Anthropic-shaped turns, oldest-first, ready to prepend to
 * a `messages.create` call. Defaults to the last 20 turns.
 */
export async function recentTurns(userId: string, limit = 20): Promise<ChatTurn[]> {
  const messages = await listMessages(userId, limit);
  return messages.map((m) => ({ role: roleForDirection(m.direction), content: m.text }));
}

export interface ChatTurnResult {
  reply: string;
  /** True when the turn took a domain action (logged a drop, advanced state, etc.). */
  acted: boolean;
}

/** The model response handleChatTurn reasons over (content blocks + usage). */
export interface ChatModelResult {
  content: Anthropic.ContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * The model call, injectable for tests (mirrors buildWeeklyReview's `generate`
 * stub pattern). Given the assembled system prompt + the new user message, it
 * returns Coomander's raw content blocks (a tool_use block to act, or text to
 * converse). The default hits Anthropic with `tool_choice: auto`.
 */
export type ChatModelFn = (system: string, userText: string) => Promise<ChatModelResult>;

const defaultChatModel: ChatModelFn = async (system, userText) => {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: tools(),
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: userText }],
  });
  return { content: msg.content, usage: msg.usage ?? undefined };
};

export interface HandleChatTurnOptions {
  /** Inject the model call in tests; defaults to the real Anthropic call. */
  model?: ChatModelFn;
}

/**
 * Handle one in-app chat turn (#169). Same brain as the Telegram inbound, but
 * `tool_choice: auto` so Coomander can either CONVERSE or take a domain action.
 * Grounds the reply in the live TodayModel + recent thread, executes any tool
 * call via the shared executors, and persists both sides to the no-TTL log (the
 * SAME thread as Telegram, so the conversation is continuous across surfaces).
 *
 * Never throws into the route's hot path beyond the model call; the route
 * wraps it.
 */
/**
 * The in-app web-chat surface guidance appended to the system prompt (#172):
 * the web client renders markdown links to /app/* as tappable buttons, so
 * Coomander can deep-link the creator to the detailed surfaces behind it.
 * (Telegram uses the bare prompt — these links are no-ops there.)
 */
const WEB_SURFACES = [
  "You are in the in-app web chat. When it helps, deep-link the creator to a detailed surface using a markdown link — they render as tappable buttons:",
  "- Cadence (pillars, beats, and the latest weekly review): [Open Cadence](/app/cadence)",
  "- Insights (Instagram analytics): [Open Insights](/app/insights)",
  "Don't link on every turn — only when pointing at the right view is the natural next step.",
].join("\n");

/**
 * Build the fully rendered in-app chat system prompt for a user — the SAME
 * prompt the POST path uses, exported so the agents Worker contract route
 * (GET /api/coomander/agent-context, #192) can serve it to the WebSocket chat
 * loop. lib/coomander/coomanderChat.ts stays the single source of truth.
 */
export async function chatSystemPrompt(userId: string): Promise<string> {
  const settings = await getCoomanderSettings(userId);
  const date = await userToday(userId);
  const [model, turns] = await Promise.all([
    getTodayModel(userId, date),
    recentTurns(userId, 10),
  ]);
  const stateCtx = renderContext(model, await daysSinceStart(userId, date));
  const history = turns.length
    ? `\n\nRecent conversation (oldest first):\n${turns.map((t) => `${t.role}: ${t.content}`).join("\n")}`
    : "";
  return `${coomanderSystem(settings.personaMode)}\n\n${WEB_SURFACES}\n\nCurrent ops state:\n${stateCtx}${history}`;
}

/**
 * The Coomander domain tool schemas (Anthropic.Tool[]), exported for the agents
 * Worker contract route. Same vocabulary the classifier + in-app chat use.
 */
export function chatTools(): Anthropic.Tool[] {
  return tools();
}

/**
 * Execute one Coomander domain tool call for the agents Worker
 * (POST /api/coomander/agent-tool, #192). Runs through the EXACT
 * resolveToolUse + executeAction path handleChatTurn uses, returning the
 * `{ action, note }` shape the Worker's tool proxy expects: `note` becomes the
 * tool_result the model sees; `action` lands in the assistant turn's meta.
 */
export async function runCoomanderTool(
  userId: string,
  name: string,
  input: Record<string, unknown>,
): Promise<{ action: string | null; note: string }> {
  const inboundCtx = await loadContext(userId);
  const resolved = resolveToolUse(name, input, inboundCtx);
  const res = await executeAction(userId, resolved, inboundCtx);
  return { action: res.acted ? name : null, note: res.reply };
}

/**
 * Streaming sibling of `handleChatTurn` (SSE token streaming, mirrors geology's
 * `/api/chat`). Builds the SAME inputs as `handleChatTurn` (loadContext,
 * chatSystemPrompt, recent turns + the new user message, the Coomander tools),
 * but uses the Anthropic streaming helper so the route can emit token deltas.
 *
 * Text vs tool paths:
 * - If the model streams TEXT, those deltas are the reply. `onText` fires per
 *   delta during streaming; `fullText` is the concatenation.
 * - If the final message contains a `tool_use` block, the streamed text was
 *   empty/partial, so we run resolveToolUse + executeAction (the SAME path as
 *   handleChatTurn) and emit the resulting note via `onText` so the client
 *   still shows it. `fullText` becomes that note.
 *
 * Persistence mirrors handleChatTurn exactly: inbound user message first (with
 * its toolCall when one fired), then the outbound reply — both best-effort.
 * This is the SAME no-TTL thread as Telegram and the JSON path, so we persist
 * once here and the route does NOT persist again (no double-write).
 */
export interface StreamChatTurnCallbacks {
  onText: (delta: string) => void;
  onDone: (fullText: string, acted: boolean) => void;
  onError: (error: unknown) => void;
}

export async function streamChatTurn(
  userId: string,
  text: string,
  cb: StreamChatTurnCallbacks,
): Promise<void> {
  try {
    const settings = await getCoomanderSettings(userId);

    // Same grounding context for tool execution as handleChatTurn.
    const inboundCtx = await loadContext(userId);

    // Same fully rendered prompt (recent turns are baked into the system prompt,
    // matching handleChatTurn — the new user message is the single user turn).
    const system = await chatSystemPrompt(userId);

    const client = new Anthropic();
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: COOMANDER_CHAT_MAX_TOKENS,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      tools: tools(),
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: text }],
    });

    // Pipe text deltas straight through to the client.
    stream.on("text", (delta) => {
      if (delta) cb.onText(delta);
    });

    const final = await stream.finalMessage();
    await logCoomanderUsage(
      userId,
      "inbound",
      MODEL,
      final.usage?.input_tokens,
      final.usage?.output_tokens,
    );

    const toolBlock = final.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
    );

    let reply: string;
    let acted = false;
    let toolCall: { toolName: string; input: Record<string, unknown> } | null = null;

    if (toolBlock) {
      // Tool path: the streamed text was empty/partial. Run the SAME executor
      // path handleChatTurn uses; the note becomes the reply and we emit it so
      // the client shows it (streamed deltas alone wouldn't include it).
      toolCall = { toolName: toolBlock.name, input: (toolBlock.input ?? {}) as Record<string, unknown> };
      const action = resolveToolUse(toolBlock.name, toolCall.input, inboundCtx);
      const res = await executeAction(userId, action, inboundCtx);
      reply = res.reply;
      acted = res.acted;
      if (reply) cb.onText(reply);
    } else {
      // Text path: the streamed deltas already are the reply.
      reply =
        final.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("")
          .trim() || "Got it.";
    }

    // Persist both sides to the shared thread (best-effort), inbound first —
    // identical to handleChatTurn so the JSON and SSE paths write the same rows.
    await appendMessage(userId, "inbound", text, {
      personaMode: settings.personaMode,
      toolCall: toolCall ?? undefined,
    }).catch(() => {});
    await appendMessage(userId, "outbound", reply, {
      personaMode: settings.personaMode,
    }).catch(() => {});

    cb.onDone(reply, acted);
  } catch (error) {
    cb.onError(error);
  }
}

export async function handleChatTurn(
  userId: string,
  text: string,
  opts: HandleChatTurnOptions = {},
): Promise<ChatTurnResult> {
  const settings = await getCoomanderSettings(userId);

  // Grounding context for tool execution (live ops state + beats/content).
  const inboundCtx = await loadContext(userId);

  // Same fully rendered prompt the WebSocket path gets via agent-context.
  const system = await chatSystemPrompt(userId);

  const runModel = opts.model ?? defaultChatModel;
  const msg = await runModel(system, text);
  await logCoomanderUsage(userId, "inbound", MODEL, msg.usage?.input_tokens, msg.usage?.output_tokens);

  const toolBlock = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  let reply: string;
  let acted = false;
  let toolCall: { toolName: string; input: Record<string, unknown> } | null = null;

  if (toolBlock) {
    toolCall = { toolName: toolBlock.name, input: (toolBlock.input ?? {}) as Record<string, unknown> };
    const action = resolveToolUse(toolBlock.name, toolCall.input, inboundCtx);
    const res = await executeAction(userId, action, inboundCtx);
    reply = res.reply;
    acted = res.acted;
  } else {
    reply = msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim() || "Got it.";
  }

  // Persist both sides to the shared thread (best-effort).
  await appendMessage(userId, "inbound", text, { personaMode: settings.personaMode, toolCall: toolCall ?? undefined }).catch(() => {});
  await appendMessage(userId, "outbound", reply, { personaMode: settings.personaMode }).catch(() => {});

  return { reply, acted };
}
