/**
 * Cadence beat CRUD + pure status computation (#152).
 *
 * A beat is a recurring rhythm within a pillar with a declared cadence_kind.
 * `computeBeatStatus` is PURE (takes pre-counted inputs, no DB) so it is fully
 * unit-testable; todayModel.ts does the DB reads and feeds it.
 *
 * Status rules per cadence_kind:
 *   daily:               expected = target. 0 → untouched; < target → behind;
 *                        == target → completed; > target → ahead.
 *   weekly:              pace against week-to-date. 0 → untouched; > target →
 *                        ahead; == target → completed; >= expectedToDate
 *                        (target * dayOfWeek/7) → on_pace; else behind.
 *   window:              completion = actual/target vs time elapsed. 0 →
 *                        untouched; > target → ahead; == target → completed;
 *                        completion >= elapsedFrac → on_pace; else behind.
 *   daily_vlog_buffer:   passive. healthy when current_days >= goal_days →
 *                        buffer_healthy; else buffer_low. (Never nags per-day.)
 */

import crypto from "crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cadenceBeats, type CadenceBeat } from "@/lib/schema";

export type CadenceKind = "daily" | "weekly" | "window" | "daily_vlog_buffer";
export type Platform = "ig" | "tiktok" | "fb" | "snap" | "of";
export type BeatPriority = "low" | "med" | "high";

export type BeatStatus =
  | "on_pace" | "behind" | "ahead" | "untouched" | "completed" | "buffer_healthy" | "buffer_low";

export interface BeatStatusInput {
  cadenceKind: CadenceKind;
  targetCount: number;
  /** Drops counting toward today (daily). */
  actualToday: number;
  /** Drops in the current week (weekly) or current window (window). */
  actualWindow?: number;
  /** 1..7 (Mon..Sun) for weekly pacing. */
  dayOfWeek?: number;
  windowDaysRemaining?: number;
  windowTotalDays?: number;
  bufferCurrentDays?: number;
  bufferGoalDays?: number;
}

export interface BeatStatusResult {
  expected_today: number;
  status: BeatStatus;
  window_progress?: { days_remaining: number; completion: number };
  buffer_status?: { current_days: number; goal_days: number; healthy: boolean };
}

export function computeBeatStatus(input: BeatStatusInput): BeatStatusResult {
  const target = Math.max(0, input.targetCount);

  if (input.cadenceKind === "daily") {
    const actual = input.actualToday;
    let status: BeatStatus;
    if (target > 0 && actual === 0) status = "untouched";
    else if (actual > target) status = "ahead";
    else if (actual === target) status = "completed";
    else status = "behind";
    return { expected_today: target, status };
  }

  if (input.cadenceKind === "weekly") {
    const actual = input.actualWindow ?? 0;
    const dow = Math.min(7, Math.max(1, input.dayOfWeek ?? 7));
    const expectedToDate = target * (dow / 7);
    const daysLeft = Math.max(1, 7 - dow + 1);
    const expectedToday = Math.max(0, Math.ceil((target - actual) / daysLeft));
    let status: BeatStatus;
    if (target > 0 && actual === 0) status = "untouched";
    else if (actual > target) status = "ahead";
    else if (actual === target) status = "completed";
    else if (actual >= expectedToDate) status = "on_pace";
    else status = "behind";
    return { expected_today: expectedToday, status };
  }

  if (input.cadenceKind === "window") {
    const actual = input.actualWindow ?? 0;
    const daysRemaining = Math.max(0, input.windowDaysRemaining ?? 0);
    const totalDays = Math.max(1, input.windowTotalDays ?? 1);
    const completion = target > 0 ? actual / target : 0;
    const elapsedFrac = (totalDays - daysRemaining) / totalDays;
    const expectedToday = Math.max(0, Math.ceil((target - actual) / Math.max(1, daysRemaining)));
    let status: BeatStatus;
    if (target > 0 && actual === 0) status = "untouched";
    else if (actual > target) status = "ahead";
    else if (actual === target) status = "completed";
    else if (completion >= elapsedFrac) status = "on_pace";
    else status = "behind";
    return {
      expected_today: expectedToday,
      status,
      window_progress: { days_remaining: daysRemaining, completion },
    };
  }

  // daily_vlog_buffer — passive, buffer-driven.
  const current = Math.max(0, input.bufferCurrentDays ?? 0);
  const goal = Math.max(0, input.bufferGoalDays ?? 0);
  const healthy = current >= goal;
  return {
    expected_today: 0,
    status: healthy ? "buffer_healthy" : "buffer_low",
    buffer_status: { current_days: current, goal_days: goal, healthy },
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateBeatInput {
  pillarId: string;
  name: string;
  cadenceKind: CadenceKind;
  targetCount?: number;
  bufferGoalDays?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  priority?: BeatPriority;
  platformSpecific?: Platform | null;
  subtype?: string | null;
  notes?: string | null;
}

export async function createBeat(userId: string, input: CreateBeatInput): Promise<CadenceBeat> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(cadenceBeats).values({
    id,
    user_id: userId,
    pillar_id: input.pillarId,
    name: input.name,
    cadence_kind: input.cadenceKind,
    target_count: input.targetCount ?? 1,
    buffer_goal_days: input.bufferGoalDays ?? null,
    window_start: input.windowStart ?? null,
    window_end: input.windowEnd ?? null,
    priority: input.priority ?? "med",
    platform_specific: input.platformSpecific ?? null,
    subtype: input.subtype ?? null,
    active: 1,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  });
  return (await getBeat(userId, id))!;
}

export async function getBeat(userId: string, id: string): Promise<CadenceBeat | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(cadenceBeats)
    .where(and(eq(cadenceBeats.user_id, userId), eq(cadenceBeats.id, id)))
    .limit(1);
  return (rows[0] as CadenceBeat) ?? null;
}

export async function listBeats(userId: string, opts: { pillarId?: string; includeInactive?: boolean } = {}): Promise<CadenceBeat[]> {
  const db = getDb();
  const conds = [eq(cadenceBeats.user_id, userId)];
  if (opts.pillarId) conds.push(eq(cadenceBeats.pillar_id, opts.pillarId));
  if (!opts.includeInactive) {
    conds.push(eq(cadenceBeats.active, 1));
    conds.push(isNull(cadenceBeats.archived_at));
  }
  return (await db.select().from(cadenceBeats).where(and(...conds))) as CadenceBeat[];
}

export interface UpdateBeatInput {
  name?: string;
  cadenceKind?: CadenceKind;
  targetCount?: number;
  bufferGoalDays?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
  priority?: BeatPriority;
  platformSpecific?: Platform | null;
  subtype?: string | null;
  notes?: string | null;
  active?: boolean;
  archived?: boolean;
}

export async function updateBeat(userId: string, id: string, input: UpdateBeatInput): Promise<CadenceBeat | null> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const set: Record<string, unknown> = { updated_at: now };
  if (input.name !== undefined) set.name = input.name;
  if (input.cadenceKind !== undefined) set.cadence_kind = input.cadenceKind;
  if (input.targetCount !== undefined) set.target_count = input.targetCount;
  if (input.bufferGoalDays !== undefined) set.buffer_goal_days = input.bufferGoalDays;
  if (input.windowStart !== undefined) set.window_start = input.windowStart;
  if (input.windowEnd !== undefined) set.window_end = input.windowEnd;
  if (input.priority !== undefined) set.priority = input.priority;
  if (input.platformSpecific !== undefined) set.platform_specific = input.platformSpecific;
  if (input.subtype !== undefined) set.subtype = input.subtype;
  if (input.notes !== undefined) set.notes = input.notes;
  if (input.active !== undefined) set.active = input.active ? 1 : 0;
  if (input.archived !== undefined) set.archived_at = input.archived ? now : null;
  await db.update(cadenceBeats).set(set).where(and(eq(cadenceBeats.user_id, userId), eq(cadenceBeats.id, id)));
  return getBeat(userId, id);
}

export async function deleteBeat(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  await db.delete(cadenceBeats).where(and(eq(cadenceBeats.user_id, userId), eq(cadenceBeats.id, id)));
  return true;
}
