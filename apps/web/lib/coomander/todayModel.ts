/**
 * TodayModel (#152) — the single structure Coomander's planPing (#151) and the
 * Manager Brief (#145) read to understand the creator's current ops state.
 *
 * `buildTodayModel` is PURE: it takes already-fetched rows and returns the model,
 * so it unit-tests without a DB. `getTodayModel` does the DB reads then calls it.
 *
 * Drop attribution: a drop counts toward a beat only if beat_id matches AND, when
 * the beat is platform_specific, the drop's platform matches (so a trial reel
 * tagged ig only counts toward the IG beat). daily_vlog_buffer beats derive a
 * buffer depth from captured-minus-shipped drops rather than a per-day target.
 */

import { computeBeatStatus, type BeatStatus } from "./beats";
import { contentCushionDays, daysBetween, toDateLocal, todayLocal } from "./consistency";
import { getDayState } from "./scheduling";
import { getTimezone } from "./settings";
import type {
  CadencePillar,
  CadenceBeat,
  ContentState,
  Drop,
  ProcurementItem,
  ContentStateValue,
} from "@/lib/schema";
import { listPillars } from "./pillars";
import { listBeats } from "./beats";
import { listContent } from "./contentStates";
import { listDrops } from "./drops";
import { listProcurement } from "./procurement";
import { splitUrgent } from "./procurement";

export interface TodayBeat {
  beat: CadenceBeat;
  expected_today: number;
  actual_today: number;
  window_progress?: { days_remaining: number; completion: number };
  buffer_status?: { current_days: number; goal_days: number; healthy: boolean };
  streak_days?: number;
  status: BeatStatus;
}

export interface TodayPillar {
  pillar: CadencePillar;
  beats: TodayBeat[];
}

export interface TodayModel {
  date: string;
  pillars: TodayPillar[];
  content_pipeline: Record<ContentStateValue, number> & { shipped_today: number };
  content_cushion_days: number;
  procurement_urgent: { shoot_prep: ProcurementItem[]; business_admin: ProcurementItem[] };
  day_quality: "good" | "bad" | null;
  overall_state: "green" | "yellow" | "red";
}

// ── date helpers ──────────────────────────────────────────────────────────────

/** Day of week 1..7 (Mon..Sun) for a YYYY-MM-DD. */
function dayOfWeekMon(date: string): number {
  const d = new Date(date + "T00:00:00Z").getUTCDay(); // 0=Sun..6=Sat
  return d === 0 ? 7 : d;
}

/** Monday of the week containing `date`. */
function weekStart(date: string): string {
  const dow = dayOfWeekMon(date);
  const t = Date.parse(date + "T00:00:00Z") - (dow - 1) * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

function dropDate(d: Drop, tz: string): string {
  return toDateLocal(d.dropped_at, tz);
}

/** Whether a drop counts toward a beat (matching id + platform constraint). */
function dropMatchesBeat(d: Drop, beat: CadenceBeat): boolean {
  if (d.beat_id !== beat.id) return false;
  if (beat.platform_specific && d.platform && d.platform !== beat.platform_specific) return false;
  return true;
}

// ── pure builder ──────────────────────────────────────────────────────────────

export interface TodayInputs {
  date: string;
  /** IANA timezone for bucketing drop timestamps to the creator's local day (#183). */
  tz: string;
  pillars: CadencePillar[];
  beats: CadenceBeat[];
  drops: Drop[];
  content: ContentState[];
  procurement: ProcurementItem[];
  dayQuality: "good" | "bad" | null;
}

export function buildTodayModel(inputs: TodayInputs): TodayModel {
  const { date, tz, pillars, beats, drops, content, procurement, dayQuality } = inputs;
  const ws = weekStart(date);
  const dow = dayOfWeekMon(date);
  const dropDay = (d: Drop): string => dropDate(d, tz);

  const beatsByPillar = new Map<string, CadenceBeat[]>();
  for (const b of beats) {
    const arr = beatsByPillar.get(b.pillar_id) ?? [];
    arr.push(b);
    beatsByPillar.set(b.pillar_id, arr);
  }

  const todayPillars: TodayPillar[] = pillars.map((pillar) => {
    const pBeats = (beatsByPillar.get(pillar.id) ?? []).map((beat): TodayBeat => {
      const beatDrops = drops.filter((d) => dropMatchesBeat(d, beat));
      const actualToday = beatDrops.filter((d) => dropDay(d) === date).length;

      if (beat.cadence_kind === "daily") {
        const res = computeBeatStatus({ cadenceKind: "daily", targetCount: beat.target_count, actualToday });
        return { beat, expected_today: res.expected_today, actual_today: actualToday, status: res.status, streak_days: streakForBeat(beatDrops, date, tz) };
      }

      if (beat.cadence_kind === "weekly") {
        const actualWindow = beatDrops.filter((d) => { const dd = dropDay(d); return dd >= ws && dd <= date; }).length;
        const res = computeBeatStatus({ cadenceKind: "weekly", targetCount: beat.target_count, actualToday, actualWindow, dayOfWeek: dow });
        return { beat, expected_today: res.expected_today, actual_today: actualToday, status: res.status };
      }

      if (beat.cadence_kind === "window") {
        const start = beat.window_start ?? date;
        const end = beat.window_end ?? date;
        const actualWindow = beatDrops.filter((d) => { const dd = dropDay(d); return dd >= start && dd <= end; }).length;
        const totalDays = Math.max(1, daysBetween(start, end) + 1);
        const daysRemaining = Math.max(0, daysBetween(date, end));
        const res = computeBeatStatus({ cadenceKind: "window", targetCount: beat.target_count, actualToday, actualWindow, windowDaysRemaining: daysRemaining, windowTotalDays: totalDays });
        return { beat, expected_today: res.expected_today, actual_today: actualToday, status: res.status, window_progress: res.window_progress };
      }

      // daily_vlog_buffer
      const captured = beatDrops.filter((d) => d.kind === "captured").length;
      const shipped = beatDrops.filter((d) => d.kind === "shipped").length;
      const perDay = Math.max(1, beat.target_count);
      const bufferCurrentDays = Math.floor(Math.max(0, captured - shipped) / perDay);
      const res = computeBeatStatus({ cadenceKind: "daily_vlog_buffer", targetCount: beat.target_count, actualToday, bufferCurrentDays, bufferGoalDays: beat.buffer_goal_days ?? 0 });
      return { beat, expected_today: res.expected_today, actual_today: actualToday, status: res.status, buffer_status: res.buffer_status };
    });
    return { pillar, beats: pBeats };
  });

  // Content pipeline counts.
  const pipeline = { drafted: 0, shot: 0, approved: 0, uploaded_to_edit: 0, edited: 0, scheduled: 0, shipped: 0 } as Record<ContentStateValue, number>;
  for (const c of content) pipeline[c.current_state]++;
  const shippedToday = drops.filter((d) => d.kind === "shipped" && dropDay(d) === date).length;

  // Content cushion days.
  const readyCount = pipeline.approved + pipeline.scheduled;
  const dailyTarget = beats
    .filter((b) => b.cadence_kind === "daily" && (b.platform_specific !== "of"))
    .reduce((s, b) => s + b.target_count, 0);
  const shippedDates = drops.filter((d) => d.kind === "shipped").map(dropDay).sort();
  const lastShip = shippedDates.length ? shippedDates[shippedDates.length - 1] : null;
  const sinceLast = lastShip ? Math.max(0, daysBetween(lastShip, date)) : 0;
  const cushion = contentCushionDays({ readyCount, dailyTarget, daysSinceLastDrop: sinceLast });

  // Procurement urgency.
  const procurement_urgent = splitUrgent(procurement, date);

  // Overall heuristic.
  const allBeats = todayPillars.flatMap((p) => p.beats);
  const behindHigh = allBeats.some((b) => b.beat.priority === "high" && (b.status === "behind" || b.status === "untouched" || b.status === "buffer_low"));
  const anyBehind = allBeats.some((b) => b.status === "behind" || b.status === "buffer_low");
  let overall: "green" | "yellow" | "red";
  if (dayQuality === "bad" || behindHigh) overall = "red";
  else if (anyBehind || cushion < 2) overall = "yellow";
  else overall = "green";

  return {
    date,
    pillars: todayPillars,
    content_pipeline: { ...pipeline, shipped_today: shippedToday },
    content_cushion_days: cushion,
    procurement_urgent,
    day_quality: dayQuality,
    overall_state: overall,
  };
}

/** Streak of consecutive days (ending today/yesterday) with a drop for this beat. */
function streakForBeat(beatDrops: Drop[], today: string, tz: string): number {
  const days = new Set(beatDrops.map((d) => dropDate(d, tz)));
  // inline of consistency.streakDays to avoid an extra import cycle for one call
  const shift = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
  let cursor: string;
  if (days.has(today)) cursor = today;
  else if (days.has(shift(today, -1))) cursor = shift(today, -1);
  else return 0;
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor = shift(cursor, -1); }
  return streak;
}

// ── async fetcher ─────────────────────────────────────────────────────────────

export async function getTodayModel(userId: string, date?: string): Promise<TodayModel> {
  const tz = await getTimezone(userId);
  const d = date ?? todayLocal(tz);
  const [pillars, beats, content, drops, procurement, dayState] = await Promise.all([
    listPillars(userId),
    listBeats(userId),
    listContent(userId),
    listDrops(userId),
    listProcurement(userId),
    getDayState(userId, d),
  ]);
  return buildTodayModel({
    date: d,
    tz,
    pillars,
    beats,
    content,
    drops,
    procurement,
    dayQuality: dayState?.day_quality ?? null,
  });
}
