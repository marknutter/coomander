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
import { getCoomanderSettings } from "./settings";
import { coomanderSystem } from "./agentPrompts";
import { getTodayModel } from "./todayModel";
import { renderContext, daysSinceStart } from "./agent";
import { tools, resolveToolUse, executeAction, loadContext } from "./inbound";
import { todayUTC } from "./scheduling";
import { logCoomanderUsage } from "./usage";

const MODEL = process.env.COOMANDER_AGENT_MODEL || process.env.CHAT_MODEL || "claude-sonnet-4-6";

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

/**
 * Handle one in-app chat turn (#169). Same brain as the Telegram inbound, but
 * `tool_choice: auto` so Coomander can either CONVERSE or take a domain action.
 * Grounds the reply in the live TodayModel + recent thread, executes any tool
 * call via the shared executors, and persists both sides to the no-TTL log (the
 * SAME thread as Telegram, so the conversation is continuous across surfaces).
 *
 * Never throws into the route's hot path beyond the Anthropic call; the route
 * wraps it.
 */
export async function handleChatTurn(userId: string, text: string): Promise<ChatTurnResult> {
  const settings = await getCoomanderSettings(userId);
  const date = todayUTC();

  // Build grounding context: live ops state + recent conversation. We inject the
  // thread into the system prompt (rather than as message turns) to avoid
  // role-alternation constraints, and send only the new user message.
  const [model, turns] = await Promise.all([
    getTodayModel(userId, date),
    recentTurns(userId, 10),
  ]);
  const stateCtx = renderContext(model, await daysSinceStart(userId, date));
  const inboundCtx = await loadContext(userId);

  const history = turns.length
    ? `\n\nRecent conversation (oldest first):\n${turns.map((t) => `${t.role}: ${t.content}`).join("\n")}`
    : "";
  const system = `${coomanderSystem(settings.personaMode)}\n\nCurrent ops state:\n${stateCtx}${history}`;

  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    tools: tools(),
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content: text }],
  });
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
