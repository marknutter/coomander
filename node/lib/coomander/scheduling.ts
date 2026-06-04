/**
 * Coomander cron scheduling (#151).
 *
 * Simpler than geology's per-user local-time scheduling (#89): Coomander fires
 * on fixed-UTC Cloudflare crons for the default `tight` preset, and the
 * `scheduled()` handler maps the cron expression that fired to a slot. Per-user
 * nag-preset suppression then happens inside planPing (agent.ts), and per-user
 * local-time ping windows are deferred (the `ping_times_json` override column
 * exists for that future work).
 *
 * Cron times are UTC. Mark is in US Central; the tight-preset local intent is
 * roughly morning 07:00, midday 13:00, check 16:00, evening 20:00 CT, translated
 * to the UTC expressions below. They drift ~1h across DST; per-user local
 * scheduling (a later milestone) removes that drift.
 *
 * The pure helper (cronToSlot) takes no DB and is unit-testable.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { coomanderDayState as dayT } from "@/lib/schema";
import type { Slot } from "./agentPrompts";
import { newId } from "./settings";

/** Tight-preset cron expressions (UTC) → slot. Keep in sync with wrangler.toml. */
export const CRON_SLOT_MAP: Record<string, Slot> = {
  "0 12 * * *": "morning", // ~07:00 CT
  "0 18 * * *": "midday", //  ~13:00 CT
  "0 21 * * *": "check", //   ~16:00 CT
  "0 1 * * *": "evening", //  ~20:00 CT (previous-day UTC)
};

/** Map a fired cron expression to its slot, or null if unrecognized. */
export function cronToSlot(cron: string): Slot | null {
  return CRON_SLOT_MAP[cron.trim()] ?? null;
}

/** Slot → the day_state column that records the send time. */
export const SENT_COLUMN: Record<Slot, "morning_ping_sent_at" | "midday_ping_sent_at" | "evening_recap_at"> = {
  morning: "morning_ping_sent_at",
  midday: "midday_ping_sent_at",
  // "check" is the second midday touchpoint; it shares the midday column.
  check: "midday_ping_sent_at",
  evening: "evening_recap_at",
};

/** Today's date as YYYY-MM-DD in UTC. */
export function todayUTC(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export interface DayState {
  date: string;
  morning_ping_sent_at: number | null;
  midday_ping_sent_at: number | null;
  evening_recap_at: number | null;
  day_quality: "good" | "bad" | null;
}

/** Read a user's day_state row for a date, or null if none yet. */
export async function getDayState(userId: string, date: string): Promise<DayState | null> {
  const db = getDb();
  const rows = (await db
    .select()
    .from(dayT)
    .where(and(eq(dayT.user_id, userId), eq(dayT.date, date)))
    .limit(1)) as unknown as DayState[];
  return rows[0] ?? null;
}

/** Stamp a slot as delivered for the user's day (upserts the row). */
export async function markSlotSent(userId: string, slot: Slot, date: string): Promise<void> {
  const db = getDb();
  const col = SENT_COLUMN[slot];
  const now = Math.floor(Date.now() / 1000);
  const existing = (await db
    .select({ id: dayT.id })
    .from(dayT)
    .where(and(eq(dayT.user_id, userId), eq(dayT.date, date)))
    .limit(1)) as Array<{ id: string }>;
  if (existing[0]) {
    await db.update(dayT).set({ [col]: now }).where(eq(dayT.id, existing[0].id));
  } else {
    await db.insert(dayT).values({ id: newId(), user_id: userId, date, [col]: now });
  }
}
