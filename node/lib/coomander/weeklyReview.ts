/**
 * Coomander weekly review (#154).
 *
 * Deterministic-where-possible: the pillar math, procurement buckets,
 * consistency, and content-cushion trend are computed by the PURE
 * `buildDeterministicReview` (unit-testable, no DB, no network). An opinionated
 * AI synthesis layer (highlights / drift / next_week_focus / drift_questions) is
 * generated on top, grounded in that deterministic data, via a generator that
 * can be STUBBED in tests.
 *
 * `buildWeeklyReview` fetches the data, runs both layers, and returns the full
 * artifact; the route persists it and sends Telegram.
 */

import Anthropic from "@anthropic-ai/sdk";
import { eq, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import {
  cadencePillars, cadenceBeats, drops as dropsT, contentStates, procurementItems, coomanderDayState,
  weeklyReviews,
  type CadencePillar, type CadenceBeat, type Drop, type ProcurementItem,
} from "@/lib/schema";
import { contentCushionDays, daysBetween, toDateUTC } from "./consistency";
import { getCoomanderSettings, type PersonaMode } from "./settings";
import { coomanderSystem } from "./agentPrompts";
import { logCoomanderUsage } from "./usage";

const MODEL = process.env.COOMANDER_AGENT_MODEL || process.env.CHAT_MODEL || "claude-sonnet-4-6";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface WeeklyReviewPillar {
  pillar: CadencePillar;
  expected_total: number;
  actual_total: number;
  drops: Drop[];
  on_pace: boolean;
  platform_breakdown: Record<string, number>;
  note: string;
}

export interface DeterministicReview {
  week_ending: string;
  user_id: string;
  pillars: WeeklyReviewPillar[];
  procurement: {
    received_this_week: ProcurementItem[];
    overdue: ProcurementItem[];
    upcoming_next_2_weeks: ProcurementItem[];
  };
  consistency: { longest_streak_days: number; days_with_zero_drops: number; bad_days: number };
  content_cushion_days_trend: { start_of_week: number; end_of_week: number };
}

export interface ReviewNarrative {
  highlights: string[];
  drift: string[];
  next_week_focus: string;
  drift_questions: Array<{ question: string; related_drift_item?: string }>;
}

export interface WeeklyReview extends DeterministicReview, ReviewNarrative {
  generated_at: string;
  model: string;
}

// ── Pure deterministic builder ──────────────────────────────────────────────────

export interface DeterministicInputs {
  userId: string;
  weekEnding: string; // Sunday YYYY-MM-DD
  pillars: CadencePillar[];
  beats: CadenceBeat[];
  weekDrops: Drop[]; // drops in [weekStart, weekEnding]
  allShippedDropDates: string[]; // YYYY-MM-DD of all shipped drops (for cushion recency)
  content: ContentLite[];
  procurement: ProcurementItem[];
  badDayCount: number; // day_states with quality 'bad' in the week
  now?: string; // defaults to weekEnding
}

interface ContentLite { current_state: string }

/** Weekly-expected drop count for a beat. */
export function weeklyExpected(beat: Pick<CadenceBeat, "cadence_kind" | "target_count">): number {
  switch (beat.cadence_kind) {
    case "daily": return beat.target_count * 7;
    case "weekly": return beat.target_count;
    case "window": return beat.target_count;
    case "daily_vlog_buffer":
    default: return 0;
  }
}

export function weekStartFor(weekEnding: string): string {
  return new Date(Date.parse(weekEnding + "T00:00:00Z") - 6 * 86400000).toISOString().slice(0, 10);
}

/** Longest consecutive-day run among a set of active YYYY-MM-DD days within [start,end]. */
export function longestStreakInWeek(activeDays: Set<string>, weekStart: string, weekEnding: string): number {
  let longest = 0, run = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(Date.parse(weekStart + "T00:00:00Z") + i * 86400000).toISOString().slice(0, 10);
    if (d > weekEnding) break;
    if (activeDays.has(d)) { run++; longest = Math.max(longest, run); } else { run = 0; }
  }
  return longest;
}

function daysSinceShipAsOf(shippedDates: string[], asOf: string): number {
  const prior = shippedDates.filter((d) => d <= asOf).sort();
  if (prior.length === 0) return 0;
  return Math.max(0, daysBetween(prior[prior.length - 1], asOf));
}

export function buildDeterministicReview(inp: DeterministicInputs): DeterministicReview {
  const weekStart = weekStartFor(inp.weekEnding);
  const beatsByPillar = new Map<string, CadenceBeat[]>();
  for (const b of inp.beats) {
    const arr = beatsByPillar.get(b.pillar_id) ?? [];
    arr.push(b);
    beatsByPillar.set(b.pillar_id, arr);
  }
  const beatIds = new Set(inp.beats.map((b) => b.id));

  const pillars: WeeklyReviewPillar[] = inp.pillars.map((pillar) => {
    const pBeats = beatsByPillar.get(pillar.id) ?? [];
    const pBeatIds = new Set(pBeats.map((b) => b.id));
    const expected_total = pBeats.reduce((s, b) => s + weeklyExpected(b), 0);
    const pDrops = inp.weekDrops.filter((d) => pBeatIds.has(d.beat_id));
    const platform_breakdown: Record<string, number> = {};
    for (const d of pDrops) {
      const key = d.platform ?? "none";
      platform_breakdown[key] = (platform_breakdown[key] ?? 0) + 1;
    }
    const actual_total = pDrops.length;
    const on_pace = expected_total > 0 ? actual_total >= expected_total : true;
    return {
      pillar,
      expected_total,
      actual_total,
      drops: pDrops,
      on_pace,
      platform_breakdown,
      note: `${actual_total}/${expected_total}`,
    };
  });

  // Procurement buckets.
  const isOpen = (p: ProcurementItem) => p.status === "needed" || p.status === "ordered";
  const received_this_week = inp.procurement.filter(
    (p) => p.status === "received" && toDateUTC(p.updated_at) >= weekStart && toDateUTC(p.updated_at) <= inp.weekEnding,
  );
  const overdue = inp.procurement.filter((p) => isOpen(p) && p.needed_by != null && p.needed_by < inp.weekEnding);
  const twoWeeks = new Date(Date.parse(inp.weekEnding + "T00:00:00Z") + 14 * 86400000).toISOString().slice(0, 10);
  const upcoming_next_2_weeks = inp.procurement.filter(
    (p) => isOpen(p) && p.needed_by != null && p.needed_by >= inp.weekEnding && p.needed_by <= twoWeeks,
  );

  // Consistency.
  const activeDays = new Set(inp.weekDrops.filter((d) => beatIds.has(d.beat_id)).map((d) => toDateUTC(d.dropped_at)));
  const distinctActive = [...activeDays].filter((d) => d >= weekStart && d <= inp.weekEnding).length;
  const consistency = {
    longest_streak_days: longestStreakInWeek(activeDays, weekStart, inp.weekEnding),
    days_with_zero_drops: Math.max(0, 7 - distinctActive),
    bad_days: inp.badDayCount,
  };

  // Content cushion trend.
  const readyCount = inp.content.filter((c) => c.current_state === "approved" || c.current_state === "scheduled").length;
  const dailyTarget = inp.beats.filter((b) => b.cadence_kind === "daily" && b.platform_specific !== "of").reduce((s, b) => s + b.target_count, 0);
  const content_cushion_days_trend = {
    start_of_week: contentCushionDays({ readyCount, dailyTarget, daysSinceLastDrop: daysSinceShipAsOf(inp.allShippedDropDates, weekStart) }),
    end_of_week: contentCushionDays({ readyCount, dailyTarget, daysSinceLastDrop: daysSinceShipAsOf(inp.allShippedDropDates, inp.weekEnding) }),
  };

  return { week_ending: inp.weekEnding, user_id: inp.userId, pillars, procurement: { received_this_week, overdue, upcoming_next_2_weeks }, consistency, content_cushion_days_trend };
}

// ── LLM narrative (stubbable) ────────────────────────────────────────────────────

function narrativeSummary(det: DeterministicReview): string {
  const lines = [`Week ending ${det.week_ending}. Cushion ${det.content_cushion_days_trend.start_of_week} -> ${det.content_cushion_days_trend.end_of_week} days.`];
  for (const p of det.pillars) lines.push(`- ${p.pillar.name}: ${p.actual_total}/${p.expected_total} (${p.on_pace ? "on pace" : "behind"})`);
  lines.push(`Consistency: longest streak ${det.consistency.longest_streak_days}d, ${det.consistency.days_with_zero_drops} zero-drop days, ${det.consistency.bad_days} bad days.`);
  if (det.procurement.overdue.length) lines.push(`Overdue procurement: ${det.procurement.overdue.map((p) => p.label).join(", ")}.`);
  if (det.procurement.received_this_week.length) lines.push(`Received: ${det.procurement.received_this_week.map((p) => p.label).join(", ")}.`);
  return lines.join("\n");
}

export type NarrativeGenerator = (det: DeterministicReview, personaMode: PersonaMode, userId: string) => Promise<ReviewNarrative>;

const NARRATIVE_TOOL = "weekly_review_narrative";

/** Real Anthropic-backed generator. */
export const anthropicNarrative: NarrativeGenerator = async (det, personaMode, userId) => {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 600,
    system: [{ type: "text", text: coomanderSystem(personaMode), cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "tool", name: NARRATIVE_TOOL },
    tools: [{
      name: NARRATIVE_TOOL,
      description: "Produce the synthesis layer of the weekly review, grounded ONLY in the provided data. highlights = 1-3 specific, data-grounded wins (no generic praise). drift = 1-3 specific misses. next_week_focus = 1-2 sentence opinionated suggestion (if cushion is dropping, address it). drift_questions = 1-3 real-manager-style questions tied to specific drift items.",
      input_schema: {
        type: "object",
        properties: {
          highlights: { type: "array", items: { type: "string" } },
          drift: { type: "array", items: { type: "string" } },
          next_week_focus: { type: "string" },
          drift_questions: {
            type: "array",
            items: { type: "object", properties: { question: { type: "string" }, related_drift_item: { type: "string" } }, required: ["question"] },
          },
        },
        required: ["highlights", "drift", "next_week_focus", "drift_questions"],
      },
    }],
    messages: [{ role: "user", content: `Here is this week's data:\n\n${narrativeSummary(det)}\n\nGenerate the review synthesis. No em-dashes.` }],
  });
  await logCoomanderUsage(userId, "inbound", MODEL, msg.usage?.input_tokens, msg.usage?.output_tokens);
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const input = (block?.input ?? {}) as Partial<ReviewNarrative>;
  return {
    highlights: Array.isArray(input.highlights) ? input.highlights.slice(0, 3) : [],
    drift: Array.isArray(input.drift) ? input.drift.slice(0, 3) : [],
    next_week_focus: typeof input.next_week_focus === "string" ? input.next_week_focus : "",
    drift_questions: Array.isArray(input.drift_questions) ? input.drift_questions.slice(0, 3) : [],
  };
};

// ── Orchestration ────────────────────────────────────────────────────────────────

export interface BuildOptions {
  generate?: NarrativeGenerator; // inject a stub in tests
  now?: string;
}

export async function buildWeeklyReview(userId: string, weekEnding: string, opts: BuildOptions = {}): Promise<WeeklyReview> {
  const db = getDb();
  const weekStart = weekStartFor(weekEnding);
  const weekStartUnix = Math.floor(Date.parse(weekStart + "T00:00:00Z") / 1000);
  const weekEndUnix = Math.floor(Date.parse(weekEnding + "T23:59:59Z") / 1000);

  const [pillars, beats, allDrops, content, procurement, dayStates] = await Promise.all([
    db.select().from(cadencePillars).where(eq(cadencePillars.user_id, userId)) as Promise<CadencePillar[]>,
    db.select().from(cadenceBeats).where(eq(cadenceBeats.user_id, userId)) as Promise<CadenceBeat[]>,
    db.select().from(dropsT).where(eq(dropsT.user_id, userId)) as Promise<Drop[]>,
    db.select({ current_state: contentStates.current_state }).from(contentStates).where(eq(contentStates.user_id, userId)) as Promise<ContentLite[]>,
    db.select().from(procurementItems).where(eq(procurementItems.user_id, userId)) as Promise<ProcurementItem[]>,
    db.select().from(coomanderDayState).where(eq(coomanderDayState.user_id, userId)) as Promise<Array<{ date: string; day_quality: string | null }>>,
  ]);

  const weekDrops = allDrops.filter((d) => d.dropped_at >= weekStartUnix && d.dropped_at <= weekEndUnix);
  const allShippedDropDates = allDrops.filter((d) => d.kind === "shipped").map((d) => toDateUTC(d.dropped_at));
  const badDayCount = dayStates.filter((s) => s.day_quality === "bad" && s.date >= weekStart && s.date <= weekEnding).length;

  const det = buildDeterministicReview({
    userId, weekEnding, pillars, beats, weekDrops, allShippedDropDates, content, procurement, badDayCount,
  });

  const settings = await getCoomanderSettings(userId);
  const generate = opts.generate ?? anthropicNarrative;
  let narrative: ReviewNarrative;
  try {
    narrative = await generate(det, settings.personaMode, userId);
  } catch {
    narrative = { highlights: [], drift: [], next_week_focus: "", drift_questions: [] };
  }

  return { ...det, ...narrative, generated_at: new Date(weekEndUnix * 1000).toISOString(), model: MODEL };
}

/** Latest stored review for a user (Manager Brief #145 consumes this). Null if none. */
export async function getLatestWeeklyReview(userId: string): Promise<WeeklyReview | null> {
  const db = getDb();
  const rows = (await db
    .select({ review_json: weeklyReviews.review_json })
    .from(weeklyReviews)
    .where(eq(weeklyReviews.user_id, userId))
    .orderBy(desc(weeklyReviews.created_at))
    .limit(1)) as Array<{ review_json: string }>;
  if (!rows[0]) return null;
  try { return JSON.parse(rows[0].review_json) as WeeklyReview; } catch { return null; }
}

/** Read a stored review for a specific week, or null. */
export async function getWeeklyReview(userId: string, weekEnding: string): Promise<WeeklyReview | null> {
  const db = getDb();
  const rows = (await db
    .select({ review_json: weeklyReviews.review_json })
    .from(weeklyReviews)
    .where(eq(weeklyReviews.user_id, userId))
    .orderBy(desc(weeklyReviews.created_at))) as Array<{ review_json: string }>;
  for (const r of rows) {
    try { const rv = JSON.parse(r.review_json) as WeeklyReview; if (rv.week_ending === weekEnding) return rv; } catch { /* skip */ }
  }
  return null;
}

/** Render the condensed Telegram message for a review. */
export function renderReviewMessage(review: WeeklyReview, appUrl: string): string {
  const trend = review.content_cushion_days_trend;
  const arrow = trend.end_of_week > trend.start_of_week ? `(up from ${trend.start_of_week})` : trend.end_of_week < trend.start_of_week ? `(down from ${trend.start_of_week})` : "";
  const onPace = review.pillars.filter((p) => p.on_pace && p.expected_total > 0).map((p) => `${p.pillar.name} (${p.actual_total}/${p.expected_total})`);
  const behind = review.pillars.filter((p) => !p.on_pace).map((p) => `${p.pillar.name} (${p.actual_total}/${p.expected_total})`);
  const lines = [`Week ending ${review.week_ending} - cushion: ${trend.end_of_week} days ${arrow}`.trim()];
  if (onPace.length) lines.push(`On pace: ${onPace.join(", ")}`);
  if (behind.length) lines.push(`Behind: ${behind.join(", ")}`);
  const proc = review.procurement;
  if (proc.received_this_week.length || proc.overdue.length) {
    lines.push(`Procurement: ${proc.received_this_week.length} received, ${proc.overdue.length} overdue`);
  }
  if (review.highlights[0]) lines.push(`Win: ${review.highlights[0]}`);
  if (review.drift[0]) lines.push(`Drift: ${review.drift[0]}`);
  if (review.next_week_focus) lines.push(`Next week: ${review.next_week_focus}`);
  lines.push(`Full review: ${appUrl}/app/coomander/review/${review.week_ending}`);
  return lines.join("\n\n");
}
