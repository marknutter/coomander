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

import { generateText, tool, type ModelMessage } from "ai";
import { z } from "zod";
import { resolveInboundModel } from "./inbound-model";
import { logCoomanderUsage } from "./usage";
import { listMessages } from "./coomanderMessages";
import { listBeats } from "./beats";
import { listContent, transitionContent, CONTENT_STATES, isValidTransition } from "./contentStates";
import { logDrop, type DropKind } from "./drops";
import { updateBeat } from "./beats";
import { listProcurement, createProcurement, updateProcurement, type ProcurementCategory } from "./procurement";
import { setDayQuality } from "./scheduling";
import { checkWallProhibitions } from "./wallProhibitions";
import { userToday, type PersonaMode } from "./settings";
import { getTodayModel, type TodayModel } from "./todayModel";
import { daysSinceStart } from "./agent";
import { expectedToday } from "./ramp";
import type { ContentStateValue, CadenceBeat, ContentState, ProcurementItem } from "@/lib/schema";

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

export function isTodayPlanQuestion(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[?!.,]+$/g, "");
  return [
    /\bwhat (?:do|should) i (?:need to )?(?:do|get done|work on|focus on)(?: today)?\b/,
    /\bwhat(?:'s| is) (?:on )?(?:my|the) (?:plan|plate|table|list)(?: today)?\b/,
    /\bwhat(?:'s| is) (?:the )?plan for today\b/,
  ].some((pattern) => pattern.test(normalized));
}

export function todayPlanReply(model: TodayModel, daysIn: number): string {
  const tasks: string[] = [];
  const cushionUnit = model.content_cushion_days === 1 ? "day" : "days";

  for (const pillar of model.pillars) {
    for (const item of pillar.beats) {
      const expected = expectedToday(item.beat, daysIn);
      const remaining = Math.max(0, expected - item.actual_today);
      if (remaining > 0) {
        tasks.push(`${item.beat.name}: ${remaining} remaining`);
      }

      const buffer = item.buffer_status;
      if (buffer && buffer.current_days < buffer.goal_days) {
        tasks.push(`${item.beat.name}: build the buffer (${buffer.current_days}/${buffer.goal_days} days)`);
      }
    }
  }

  const urgent = [
    ...model.procurement_urgent.shoot_prep,
    ...model.procurement_urgent.business_admin,
  ];
  for (const item of urgent) {
    tasks.push(`Get ${item.label}${item.needed_by ? ` by ${item.needed_by}` : ""}`);
  }

  if (!tasks.length) {
    return `You're clear on today's tracked cadence. Your content cushion is ${model.content_cushion_days} ${cushionUnit}.`;
  }

  return `Today: ${tasks.join("; ")}. Content cushion: ${model.content_cushion_days} ${cushionUnit}.`;
}

export interface ClassifiedTool {
  toolName: string;
  input: Record<string, unknown>;
}

export interface InboundResult {
  reply: string;
  /** The classifier tool-call(s) taken for this message (one per action). */
  toolCall: ClassifiedTool[] | null;
  /** True when a domain row was actually written. */
  acted: boolean;
}

export interface InboundContext {
  beats: CadenceBeat[];
  content: ContentState[];
  procurement: ProcurementItem[];
}

// ── Tool definitions (Vercel AI SDK + zod) ─────────────────────────────────────
// One tool per TOOLS.* name, keyed identically so resolveToolUse/executeAction
// are untouched. No `execute` — the model's tool calls are returned for our own
// validation (resolveToolUse) rather than auto-executed. Tool descriptions are
// verbatim from the prior Anthropic schema; property hints preserved via
// `.describe()`. Exported so a test can assert the tool shapes.

export function inboundTools() {
  return {
    [TOOLS.LOG_DROP]: tool({
      description:
        "Record an act of execution against one of the creator's beats: a reel shipped, a live stream done, wall content captured. 'kind' is 'shipped' for a posted/published piece, 'captured' for wall content shot but not yet posted, 'completed' for a non-content task, 'purchased' is not used here (use log_purchase). Set platform when known.",
      inputSchema: z.object({
        beat_id: z.string().describe("id of the matched beat (from the list provided)."),
        kind: z.enum(["shipped", "captured", "completed"]).describe("shipped=posted; captured=shot for the wall buffer; completed=other task."),
        count: z.number().int().min(1).optional().describe("How many of THIS beat were shipped/captured in this message (e.g. 'posted 2 reels' -> 2). Defaults to 1. Use one log_drop with count=N for N of the same beat; use separate log_drop calls for different beats."),
        platform: z.enum(["ig", "tiktok", "fb", "snap", "of"]).optional().describe("Platform, if stated or obvious."),
        notes: z.string().optional().describe("Optional free text."),
      }),
    }),
    [TOOLS.ADVANCE]: tool({
      description:
        "Move a content item to a new lifecycle state (e.g. 'the editor finished the gym reel' -> edited). You may advance one step forward or move backward with a reason. States: drafted, shot, approved, uploaded_to_edit, edited, scheduled, shipped.",
      inputSchema: z.object({
        content_id: z.string().describe("id of the content item (from the list provided)."),
        new_state: z.enum(CONTENT_STATES as unknown as [string, ...string[]]).describe("The target state."),
        notes: z.string().optional().describe("Reason (required when moving backward)."),
      }),
    }),
    [TOOLS.LOG_PURCHASE]: tool({
      description: "Mark a procurement item as received/purchased (e.g. 'the Halloween costume arrived').",
      inputSchema: z.object({
        procurement_item_id: z.string().describe("id of the procurement item (from the list provided)."),
        actual_cost: z.number().optional().describe("Optional actual cost in dollars."),
        notes: z.string().optional(),
      }),
    }),
    [TOOLS.ADD_PROCUREMENT]: tool({
      description: "Add a new thing to acquire (e.g. 'I need new ring lights by next Friday'). category: shoot_prep (costumes, props, lights, locations) or business_admin (invoices, gear, tax).",
      inputSchema: z.object({
        category: z.enum(["shoot_prep", "business_admin"]),
        label: z.string().describe("Short label for the item."),
        needed_by: z.string().optional().describe("Optional deadline as YYYY-MM-DD (resolve relative dates against today)."),
        notes: z.string().optional(),
      }),
    }),
    [TOOLS.MARK_BLOCKER]: tool({
      description: "The creator can't execute today (e.g. 'can't shoot today, sick'). Sets the day to a bad day so Coomander softens and suppresses midday nags.",
      inputSchema: z.object({
        beat_id: z.string().optional().describe("Optional beat this blocks."),
        reason: z.string().describe("Short reason."),
      }),
    }),
    [TOOLS.ADJUST_BEAT]: tool({
      description: "Change a beat's target (e.g. 'cut me down to 3 reels a week this month').",
      inputSchema: z.object({
        beat_id: z.string().describe("id of the beat to adjust."),
        target_count: z.number().optional().describe("New target count."),
      }),
    }),
    [TOOLS.CLARIFY]: tool({
      description: "Ask a short clarifying question. Use when the message does not clearly match one beat/content/procurement item, or is not about logging at all. Never guess.",
      inputSchema: z.object({
        reply: z.string().describe("A short friendly question. No em-dashes."),
      }),
    }),
  };
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
  return `You are Coomander, the AI operations manager inside Coomander (an OnlyFans creator app). Today is ${today}. Turn the creator's Telegram message into one or more tool calls — one per DISTINCT action. If they did several different things in one message, emit a tool call for each. For multiple of the SAME beat (e.g. "posted 2 reels"), use a single log_drop with count=2. ${
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
  | { kind: "log_drop"; beatId: string; dropKind: DropKind; count: number; platform?: string; notes?: string }
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
      const cnt = Number(input.count);
      const count = Number.isFinite(cnt) && cnt >= 1 ? Math.min(Math.round(cnt), 20) : 1;
      return { kind: "log_drop", beatId, dropKind, count, platform: str(input.platform) || undefined, notes: str(input.notes) || undefined };
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

export async function executeAction(userId: string, action: ResolvedAction, ctx: InboundContext): Promise<{ reply: string; acted: boolean }> {
  switch (action.kind) {
    case "clarify":
      return { reply: action.reply, acted: false };
    case "log_drop": {
      const beat = ctx.beats.find((b) => b.id === action.beatId)!;
      for (let i = 0; i < action.count; i++) {
        await logDrop(userId, {
          beatId: action.beatId,
          kind: action.dropKind,
          source: "telegram",
          platform: (action.platform as never) ?? beat.platform_specific ?? null,
          payload: action.notes ? { notes: action.notes } : undefined,
        });
      }
      // Soft wall-content prohibition warnings on a capture (#153).
      let warn = "";
      if (action.dropKind === "captured") {
        const ws = checkWallProhibitions(action.notes);
        if (ws.length) warn = " " + ws.map((w) => w.message).join(" ");
      }
      const n = action.count > 1 ? ` ${action.count}` : "";
      return { reply: `Logged${n}. Counted toward ${beat.name}.${warn}`, acted: true };
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
      await setDayQuality(userId, await userToday(userId), "bad");
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

// ── Multi-provider classification (#218) ────────────────────────────────────────

async function classifyMessage(userId: string, text: string, ctx: InboundContext, personaMode: PersonaMode): Promise<ClassifiedTool[]> {
  // Inject the recent thread (oldest-first) so a clarification answer resolves
  // against the message that prompted it — e.g. "normal reels" right after
  // "posted 2 gym reels" must log a drop, not ask again. The current inbound
  // message is persisted only AFTER this runs (see the webhook), so it is not
  // duplicated here. Parity with coomanderChat.chatSystemPrompt.
  const recent = await listMessages(userId, 10);
  const today = await userToday(userId);
  const history = recent.length
    ? `\n\nRecent conversation (oldest first):\n${recent
        .map((m) => `${m.direction === "inbound" ? "creator" : "coomander"}: ${m.text}`)
        .join("\n")}\n\nIf the newest message answers a clarification you just asked, combine it with that earlier context and take the action — do not ask the same question again.`
    : "";
  // Resolve the admin/per-user-chosen model (Anthropic or Workers AI) via the
  // multi-provider engine; falls back to the Anthropic default when the chosen
  // model lacks tool support or its binding is unavailable (see inbound-model).
  const { model, resolvedId } = await resolveInboundModel(userId);
  const result = await generateText({
    model,
    maxOutputTokens: 300,
    system: systemPrompt(ctx, personaMode, today) + history,
    tools: inboundTools(),
    toolChoice: "required",
    messages: [{ role: "user", content: text }] as ModelMessage[],
  });
  await logCoomanderUsage(userId, "inbound", resolvedId, result.usage?.inputTokens, result.usage?.outputTokens).catch(() => {});
  return result.toolCalls.map((tc) => ({ toolName: tc.toolName, input: (tc.input ?? {}) as Record<string, unknown> }));
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
  if (isTodayPlanQuestion(text)) {
    const date = await userToday(userId);
    const model = await getTodayModel(userId, date);
    return {
      reply: todayPlanReply(model, await daysSinceStart(userId, date)),
      toolCall: [{ toolName: "answer_today", input: {} }],
      acted: false,
    };
  }

  const ctx = await loadContext(userId);
  const classified = await classifyMessage(userId, text, ctx, personaMode);
  if (!classified.length) return { reply: FALLBACK_REPLY, toolCall: null, acted: false };
  // Execute every action in the message (e.g. "posted a reel and shot 3 wall
  // clips" -> two calls), aggregating the replies.
  const replies: string[] = [];
  let acted = false;
  for (const c of classified) {
    const action = resolveToolUse(c.toolName, c.input, ctx);
    const res = await executeAction(userId, action, ctx);
    replies.push(res.reply);
    acted = acted || res.acted;
  }
  return { reply: replies.join(" "), toolCall: classified, acted };
}
