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
import { listMessages, type CoomanderMessage } from "./coomanderMessages";
import { getCoomanderSettings, userToday } from "./settings";
import { coomanderSystem } from "./agentPrompts";
import { getTodayModel } from "./todayModel";
import { renderContext, daysSinceStart } from "./agent";
import { tools, resolveToolUse, executeAction, loadContext } from "./inbound";

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
 * (POST /api/coomander/agent-tool, #192). Runs through the EXACT same
 * resolveToolUse + executeAction path the Telegram inbound classifier uses,
 * returning the `{ action, note }` shape the Worker's tool proxy expects: `note`
 * becomes the tool_result the model sees; `action` lands in the assistant turn's
 * meta. This is the single remaining web-side entry into the domain executors
 * after the SSE/POST chat path was removed in Phase D (#203).
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

