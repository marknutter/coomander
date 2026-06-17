/**
 * Consistency derivations (#152).
 *
 * Streak, on-pace, adherence %, and the headline CONTENT CUSHION DAYS metric are
 * all DERIVED (not stored) from drops + content states. These are pure functions
 * (no DB) so they unit-test directly; todayModel.ts gathers the inputs.
 */

/** UTC YYYY-MM-DD for a unix-seconds timestamp. */
export function toDateUTC(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Per-creator timezone day boundary (#183). All "today"/day-bucketing in the ops
 * layer is the creator's LOCAL calendar day, not UTC — otherwise a US creator's
 * day rolls over at ~6-7pm local (UTC midnight) and evening work counts as
 * tomorrow. Ported from geology's floor.ts: `en-CA` renders YYYY-MM-DD, and
 * forcing `timeZone` makes it independent of the server's clock.
 */
export const DEFAULT_TIMEZONE = process.env.COOMANDER_TIMEZONE || "America/Chicago";

/** Today's date as YYYY-MM-DD in an IANA timezone. */
export function todayLocal(tz: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Local YYYY-MM-DD (in tz) for a unix-seconds timestamp. */
export function toDateLocal(unixSeconds: number, tz: string = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(unixSeconds * 1000));
}

/** Whole days from a → b (both YYYY-MM-DD). Positive if b is after a. */
export function daysBetween(a: string, b: string): number {
  const da = Date.parse(a + "T00:00:00Z");
  const db = Date.parse(b + "T00:00:00Z");
  if (Number.isNaN(da) || Number.isNaN(db)) return 0;
  return Math.round((db - da) / 86400000);
}

function shiftDate(date: string, deltaDays: number): string {
  const t = Date.parse(date + "T00:00:00Z");
  return new Date(t + deltaDays * 86400000).toISOString().slice(0, 10);
}

/**
 * Consecutive-day streak ending at (or just before) `today`.
 *
 * `activeDays` = the set of YYYY-MM-DD that had at least one drop. The streak is
 * counted from today backward while each day is present. If today has no drop
 * the streak is NOT yet broken — it counts back from yesterday — so a streak
 * survives until a full empty day passes. Returns 0 if neither today nor
 * yesterday is active.
 */
export function streakDays(activeDays: Iterable<string>, today: string): number {
  const set = activeDays instanceof Set ? activeDays : new Set(activeDays);
  let cursor: string;
  if (set.has(today)) cursor = today;
  else if (set.has(shiftDate(today, -1))) cursor = shiftDate(today, -1);
  else return 0;
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

/**
 * Adherence percentage over a window: actual vs expected drops, 0..100.
 * expected <= 0 → 0 (nothing was expected, so adherence is undefined → 0).
 */
export function adherencePct(actualDrops: number, expectedDrops: number): number {
  if (expectedDrops <= 0) return 0;
  return Math.min(100, Math.round((actualDrops / expectedDrops) * 100));
}

export interface CushionInput {
  /** Count of ready-to-post content (approved + scheduled states). */
  readyCount: number;
  /** Posts-per-day target (sum of daily content beats' target_count). */
  dailyTarget: number;
  /** Whole days since the last shipped drop. */
  daysSinceLastDrop: number;
}

/**
 * CONTENT CUSHION DAYS — the agency's headline leading indicator: how many days
 * of approved-and-ready content we have, net of how stale the last ship is.
 *
 *   cushion = readyCount / dailyTarget - daysSinceLastDrop   (floored at 0)
 *
 * dailyTarget <= 0 → 0 (no daily posting target → metric not meaningful).
 */
export function contentCushionDays(input: CushionInput): number {
  if (input.dailyTarget <= 0) return 0;
  const raw = input.readyCount / input.dailyTarget - input.daysSinceLastDrop;
  return Math.max(0, Math.round(raw));
}

/** Whole days since the most recent drop date, relative to today. null → large. */
export function daysSinceLastDrop(lastDropDate: string | null, today: string): number {
  if (!lastDropDate) return Number.MAX_SAFE_INTEGER;
  return Math.max(0, daysBetween(lastDropDate, today));
}
