/**
 * Inbound Telegram message handling for Coomander (#152).
 *
 * The creator replies in plain language; we classify with Anthropic tool-use
 * into a domain action and execute it. The placeholder single-tool version from
 * #151 is replaced here with the real vocabulary:
 *   log_drop, advance_content_state, log_purchase, add_procurement_item,
 *   mark_blocker, adjust_beat, need_clarification (fallback).
 *
 * The Anthropic call (classifyMessage) is isolated from the pure validation
 * (resolveToolUse) and the DB execution (executeTool), so the matching logic is
 * unit-testable without the network. Safety: a write only happens on a confident,
 * validated match; anything ambiguous becomes need_clarification.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logCoomanderUsage } from "./usage";
import { listBeats } from "./beats";
import { listContent, transitionContent, CONTENT_STATES, isValidTransition } from "./contentStates";
import { logDrop, type DropKind } from "./drops";
import { updateBeat } from "./beats";
import { listProcurement, createProcurement, updateProcurement, type ProcurementCategory } from "./procurement";
import { setDayQuality, todayUTC } from "./scheduling";
import type { PersonaMode } from "./settings";
import type { ContentStateValue, CadenceBeat, ContentState, ProcurementItem } from "@/lib/schema";

const MODEL = process.env.COOMANDER_AGENT_MODEL || process.env.CHAT_MODEL || "claude-sonnet-4-6";

export const TOOLS = {
  LOG_DROP: "log_drop",
  ADVANCE: "advance_content_state",
  LOG_PURCHASE: "log_purchase",
  ADD_PROCUREMENT: "add_procurement_item",
  MARK_BLOCKER: "mark_blocker",
  ADJUST_BEAT: "adjust_beat",
  CLARIFY: "need_clarification",
} as const;

const FALLBACK_REPLY =
  "I could not tell exactly what to log there. Try naming the beat or content, like \"posted the gym reel\" or \"halloween costume arrived\".";

export interface ClassifiedTool {
  toolName: string;
  input: Record<string, unknown>;
}

export interface InboundResult {
  reply: string;
  toolCall: ClassifiedTool | null;
  /** True when a domain row was actually written. */
  acted: boolean;
}

export interface InboundContext {
  beats: CadenceBeat[];
  content: ContentState[];
  procurement: ProcurementItem[];
}

// ── Anthropic tool definitions ────────────────────────────────────────────────

function tools(): Anthropic.Tool[] {
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

function contextString(ctx: InboundContext): string {
  const beats = ctx.beats.length
    ? ctx.beats.map((b) => `- id=${b.id} | "${b.name}" | ${b.cadence_kind}${b.platform_specific ? ` | ${b.platform_specific}` : ""}${b.subtype ? ` | ${b.subtype}` : ""}`).join("\n")
    : "(none)";
  const content = ctx.content.length
    ? ctx.content.map((c) => `- id=${c.id} | "${c.title}" | ${c.current_state}`).join("\n")
    : "(none)";
  const proc = ctx.procurement.length
    ? ctx.procurement.map((p) => `- id=${p.id} | "${p.label}" | ${p.category} | ${p.status}`).join("\n")
    : "(none)";
  return `Active beats:\n${beats}\n\nContent items (not yet shipped):\n${content}\n\nOpen procurement items:\n${proc}`;
}

function systemPrompt(ctx: InboundContext, personaMode: PersonaMode, today: string): string {
  return `You are Coomander, the AI operations manager inside MaddieHQ (an OnlyFans creator app). Today is ${today}. Turn the creator's Telegram message into exactly one tool call. ${
    personaMode === "operational" ? "Be terse." : "Be warm and direct."
  }

${contextString(ctx)}

Rules:
- Match the message to a real id above. If nothing clearly matches, or it is ambiguous, call need_clarification. Never guess an id.
- 'posted/shipped/went live' -> log_drop. 'editor finished / approved / scheduled it' -> advance_content_state. 'X arrived/bought' -> log_purchase. 'I need X' -> add_procurement_item. 'can't shoot / sick / blocked' -> mark_blocker. 'cut me to N / change target' -> adjust_beat.
- Resolve relative dates against today. No em-dashes in any reply text.`;
}

// ── Pure validation ────────────────────────────────────────────────────────────

export type ResolvedAction =
  | { kind: "log_drop"; beatId: string; dropKind: DropKind; platform?: string; notes?: string }
  | { kind: "advance"; contentId: string; newState: ContentStateValue; notes?: string }
  | { kind: "log_purchase"; itemId: string; actualCostCents?: number; notes?: string }
  | { kind: "add_procurement"; category: ProcurementCategory; label: string; neededBy?: string; notes?: string }
  | { kind: "mark_blocker"; beatId?: string; reason: string }
  | { kind: "adjust_beat"; beatId: string; targetCount?: number }
  | { kind: "clarify"; reply: string };

/**
 * Validate a forced tool call against the user's context. No DB, no network.
 * Returns a clarify action (never throws) when ids don't resolve or fields are
 * missing — so an ambiguous/invalid classification degrades to a question.
 */
export function resolveToolUse(toolName: string, input: Record<string, unknown>, ctx: InboundContext): ResolvedAction {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const beatExists = (id: string) => ctx.beats.some((b) => b.id === id);

  switch (toolName) {
    case TOOLS.LOG_DROP: {
      const beatId = str(input.beat_id);
      if (!beatExists(beatId)) return { kind: "clarify", reply: FALLBACK_REPLY };
      const k = str(input.kind);
      const dropKind: DropKind = (["shipped", "captured", "completed"] as readonly string[]).includes(k) ? (k as DropKind) : "shipped";
      return { kind: "log_drop", beatId, dropKind, platform: str(input.platform) || undefined, notes: str(input.notes) || undefined };
    }
    case TOOLS.ADVANCE: {
      const contentId = str(input.content_id);
      const item = ctx.content.find((c) => c.id === contentId);
      if (!item) return { kind: "clarify", reply: FALLBACK_REPLY };
      const newState = str(input.new_state) as ContentStateValue;
      if (!CONTENT_STATES.includes(newState)) return { kind: "clarify", reply: FALLBACK_REPLY };
      const check = isValidTransition(item.current_state, newState, str(input.notes) || null);
      if (!check.valid) return { kind: "clarify", reply: `That move is not allowed: ${check.error}.` };
      return { kind: "advance", contentId, newState, notes: str(input.notes) || undefined };
    }
    case TOOLS.LOG_PURCHASE: {
      const itemId = str(input.procurement_item_id);
      if (!ctx.procurement.some((p) => p.id === itemId)) return { kind: "clarify", reply: FALLBACK_REPLY };
      const cost = Number(input.actual_cost);
      return { kind: "log_purchase", itemId, actualCostCents: Number.isFinite(cost) && cost > 0 ? Math.round(cost * 100) : undefined, notes: str(input.notes) || undefined };
    }
    case TOOLS.ADD_PROCUREMENT: {
      const category = str(input.category) as ProcurementCategory;
      if (category !== "shoot_prep" && category !== "business_admin") return { kind: "clarify", reply: "Is that for a shoot, or business admin?" };
      const label = str(input.label);
      if (!label) return { kind: "clarify", reply: "What should I call that item?" };
      const neededBy = /^\d{4}-\d{2}-\d{2}$/.test(str(input.needed_by)) ? str(input.needed_by) : undefined;
      return { kind: "add_procurement", category, label, neededBy, notes: str(input.notes) || undefined };
    }
    case TOOLS.MARK_BLOCKER: {
      const reason = str(input.reason) || "blocked";
      const beatId = str(input.beat_id);
      return { kind: "mark_blocker", reason, beatId: beatId && beatExists(beatId) ? beatId : undefined };
    }
    case TOOLS.ADJUST_BEAT: {
      const beatId = str(input.beat_id);
      if (!beatExists(beatId)) return { kind: "clarify", reply: FALLBACK_REPLY };
      const tc = Number(input.target_count);
      return { kind: "adjust_beat", beatId, targetCount: Number.isFinite(tc) && tc >= 0 ? Math.round(tc) : undefined };
    }
    case TOOLS.CLARIFY:
    default: {
      const reply = str(input.reply) || FALLBACK_REPLY;
      return { kind: "clarify", reply };
    }
  }
}

// ── Execution (DB writes) ──────────────────────────────────────────────────────

async function executeAction(userId: string, action: ResolvedAction, ctx: InboundContext): Promise<{ reply: string; acted: boolean }> {
  switch (action.kind) {
    case "clarify":
      return { reply: action.reply, acted: false };
    case "log_drop": {
      const beat = ctx.beats.find((b) => b.id === action.beatId)!;
      await logDrop(userId, {
        beatId: action.beatId,
        kind: action.dropKind,
        source: "telegram",
        platform: (action.platform as never) ?? beat.platform_specific ?? null,
        payload: action.notes ? { notes: action.notes } : undefined,
      });
      return { reply: `Logged. Counted toward ${beat.name}.`, acted: true };
    }
    case "advance": {
      const res = await transitionContent(userId, action.contentId, action.newState, action.notes ?? null);
      if (!res.ok) return { reply: `Could not move that: ${res.error}.`, acted: false };
      return { reply: `Updated "${res.content!.title}" to ${action.newState}.`, acted: true };
    }
    case "log_purchase": {
      const item = ctx.procurement.find((p) => p.id === action.itemId)!;
      await updateProcurement(userId, action.itemId, { status: "received", actualCostCents: action.actualCostCents });
      return { reply: `Marked "${item.label}" as received.`, acted: true };
    }
    case "add_procurement": {
      const created = await createProcurement(userId, { category: action.category, label: action.label, neededBy: action.neededBy ?? null, notes: action.notes ?? null });
      return { reply: `Added "${created.label}" to your ${action.category === "shoot_prep" ? "shoot prep" : "admin"} list${action.neededBy ? ` (by ${action.neededBy})` : ""}.`, acted: true };
    }
    case "mark_blocker": {
      await setDayQuality(userId, todayUTC(), "bad");
      return { reply: `Got it, marked today as a tough one. I will ease off. (${action.reason})`, acted: true };
    }
    case "adjust_beat": {
      const beat = ctx.beats.find((b) => b.id === action.beatId)!;
      if (action.targetCount === undefined) return { reply: `What target should I set for ${beat.name}?`, acted: false };
      await updateBeat(userId, action.beatId, { targetCount: action.targetCount });
      return { reply: `Set ${beat.name} to ${action.targetCount}.`, acted: true };
    }
  }
}

// ── Anthropic classification ───────────────────────────────────────────────────

async function classifyMessage(userId: string, text: string, ctx: InboundContext, personaMode: PersonaMode): Promise<ClassifiedTool | null> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: [{ type: "text", text: systemPrompt(ctx, personaMode, todayUTC()), cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "any" },
    tools: tools(),
    messages: [{ role: "user", content: text }],
  });
  await logCoomanderUsage(userId, "inbound", MODEL, msg.usage?.input_tokens, msg.usage?.output_tokens);
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) return null;
  return { toolName: block.name, input: (block.input ?? {}) as Record<string, unknown> };
}

/** Load the classifier context (active beats, unshipped content, open procurement). */
export async function loadContext(userId: string): Promise<InboundContext> {
  const [beats, content, procurement] = await Promise.all([
    listBeats(userId),
    listContent(userId),
    listProcurement(userId),
  ]);
  return {
    beats,
    content: content.filter((c) => c.current_state !== "shipped"),
    procurement: procurement.filter((p) => p.status === "needed" || p.status === "ordered"),
  };
}

/**
 * Full inbound flow: classify → validate → execute. Returns the reply, the raw
 * tool call (for persistence), and whether a row was written.
 */
export async function handleInbound(userId: string, text: string, personaMode: PersonaMode = "light_companion"): Promise<InboundResult> {
  const ctx = await loadContext(userId);
  const classified = await classifyMessage(userId, text, ctx, personaMode);
  if (!classified) return { reply: FALLBACK_REPLY, toolCall: null, acted: false };
  const action = resolveToolUse(classified.toolName, classified.input, ctx);
  const { reply, acted } = await executeAction(userId, action, ctx);
  return { reply, toolCall: classified, acted };
}
