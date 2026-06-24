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
import { TOOLS, resolveToolUse, executeAction, loadContext } from "./inbound";
import { CONTENT_STATES } from "./contentStates";

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
 * Worker contract route (served as `{name, description, input_schema}` JSON and
 * re-wrapped via `jsonSchema()` on the Worker). Same vocabulary as the Telegram
 * inbound classifier, which uses the Vercel-AI-SDK/zod representation in
 * `inbound.ts::inboundTools()` (#218 moved the classifier off the Anthropic SDK).
 *
 * IMPORTANT: these definitions MUST stay in sync with `inboundTools()` — same
 * tool names, property names, enums, and required/optional shape — so the agent
 * chat and the Telegram classifier validate identically through
 * `resolveToolUse`/`executeAction`. (Kept as two representations on purpose: the
 * agent path consumes JSON Schema, the classifier consumes zod; unifying them
 * behind one source is a sensible follow-up.)
 */
export function chatTools(): Anthropic.Tool[] {
  return [
    {
      name: TOOLS.LOG_DROP,
      description:
        "Record an act of execution against one of the creator's beats: a reel shipped, a live stream done, wall content captured. 'kind' is 'shipped' for a posted/published piece, 'captured' for wall content shot but not yet posted, 'completed' for a non-content task, 'purchased' is not used here (use log_purchase). Set platform when known.",
      input_schema: {
        type: "object",
        properties: {
          beat_id: { type: "string", description: "id of the matched beat (from the list provided)." },
          kind: { type: "string", enum: ["shipped", "captured", "completed"], description: "shipped=posted; captured=shot for the wall buffer; completed=other task." },
          count: { type: "integer", minimum: 1, description: "How many of THIS beat were shipped/captured in this message (e.g. 'posted 2 reels' -> 2). Defaults to 1. Use one log_drop with count=N for N of the same beat; use separate log_drop calls for different beats." },
          platform: { type: "string", enum: ["ig", "tiktok", "fb", "snap", "of"], description: "Platform, if stated or obvious." },
          notes: { type: "string", description: "Optional free text." },
        },
        required: ["beat_id", "kind"],
      },
    },
    {
      name: TOOLS.ADVANCE,
      description:
        "Move a content item to a new lifecycle state (e.g. 'the editor finished the gym reel' -> edited). You may advance one step forward or move backward with a reason. States: drafted, shot, approved, uploaded_to_edit, edited, scheduled, shipped.",
      input_schema: {
        type: "object",
        properties: {
          content_id: { type: "string", description: "id of the content item (from the list provided)." },
          new_state: { type: "string", enum: CONTENT_STATES as unknown as string[], description: "The target state." },
          notes: { type: "string", description: "Reason (required when moving backward)." },
        },
        required: ["content_id", "new_state"],
      },
    },
    {
      name: TOOLS.LOG_PURCHASE,
      description: "Mark a procurement item as received/purchased (e.g. 'the Halloween costume arrived').",
      input_schema: {
        type: "object",
        properties: {
          procurement_item_id: { type: "string", description: "id of the procurement item (from the list provided)." },
          actual_cost: { type: "number", description: "Optional actual cost in dollars." },
          notes: { type: "string" },
        },
        required: ["procurement_item_id"],
      },
    },
    {
      name: TOOLS.ADD_PROCUREMENT,
      description: "Add a new thing to acquire (e.g. 'I need new ring lights by next Friday'). category: shoot_prep (costumes, props, lights, locations) or business_admin (invoices, gear, tax).",
      input_schema: {
        type: "object",
        properties: {
          category: { type: "string", enum: ["shoot_prep", "business_admin"] },
          label: { type: "string", description: "Short label for the item." },
          needed_by: { type: "string", description: "Optional deadline as YYYY-MM-DD (resolve relative dates against today)." },
          notes: { type: "string" },
        },
        required: ["category", "label"],
      },
    },
    {
      name: TOOLS.MARK_BLOCKER,
      description: "The creator can't execute today (e.g. 'can't shoot today, sick'). Sets the day to a bad day so Coomander softens and suppresses midday nags.",
      input_schema: {
        type: "object",
        properties: {
          beat_id: { type: "string", description: "Optional beat this blocks." },
          reason: { type: "string", description: "Short reason." },
        },
        required: ["reason"],
      },
    },
    {
      name: TOOLS.ADJUST_BEAT,
      description: "Change a beat's target (e.g. 'cut me down to 3 reels a week this month').",
      input_schema: {
        type: "object",
        properties: {
          beat_id: { type: "string", description: "id of the beat to adjust." },
          target_count: { type: "number", description: "New target count." },
        },
        required: ["beat_id"],
      },
    },
    {
      name: TOOLS.CLARIFY,
      description: "Ask a short clarifying question. Use when the message does not clearly match one beat/content/procurement item, or is not about logging at all. Never guess.",
      input_schema: {
        type: "object",
        properties: { reply: { type: "string", description: "A short friendly question. No em-dashes." } },
        required: ["reply"],
      },
    },
  ];
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

