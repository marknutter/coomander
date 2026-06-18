/**
 * Drops — append-only acts of execution (#152).
 *
 * A drop records that something happened: a reel shipped, a wall piece captured,
 * a purchase completed. Drops are APPEND-ONLY (no update/delete in V1) so the
 * execution history is immutable. Sources: auto_ig (IG sync), auto_of, telegram
 * (inbound classify), manual_ui.
 *
 * Counting helpers (per beat / today / window) feed the TodayModel and
 * consistency derivations.
 */

import crypto from "crypto";
import { and, eq, gte, lt, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { drops, type Drop } from "@/lib/schema";
import type { Platform } from "./beats";

export type DropKind = "shipped" | "purchased" | "completed" | "captured";
export type DropSource = "auto_ig" | "auto_of" | "telegram" | "manual_ui";

export interface LogDropInput {
  beatId: string;
  kind: DropKind;
  source: DropSource;
  platform?: Platform | null;
  externalRef?: string | null;
  contentStateId?: string | null;
  payload?: Record<string, unknown>;
  droppedAt?: number; // unix seconds; defaults to now
}

export async function logDrop(userId: string, input: LogDropInput): Promise<Drop> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(drops).values({
    id,
    user_id: userId,
    beat_id: input.beatId,
    kind: input.kind,
    source: input.source,
    platform: input.platform ?? null,
    external_ref: input.externalRef ?? null,
    content_state_id: input.contentStateId ?? null,
    payload_json: input.payload ? JSON.stringify(input.payload) : "{}",
    dropped_at: input.droppedAt ?? now,
    created_at: now,
  });
  const rows = await db.select().from(drops).where(and(eq(drops.user_id, userId), eq(drops.id, id))).limit(1);
  return rows[0] as Drop;
}

/** All drops for a user, newest-first, optionally filtered by beat. */
export async function listDrops(userId: string, opts: { beatId?: string; limit?: number } = {}): Promise<Drop[]> {
  const db = getDb();
  const conds = [eq(drops.user_id, userId)];
  if (opts.beatId) conds.push(eq(drops.beat_id, opts.beatId));
  let q = db.select().from(drops).where(and(...conds)).orderBy(desc(drops.dropped_at));
  if (opts.limit) q = q.limit(opts.limit) as typeof q;
  return (await q) as Drop[];
}

/** Drops for a beat within [sinceUnix, untilUnix). */
export async function countDropsForBeat(
  userId: string,
  beatId: string,
  sinceUnix: number,
  untilUnix: number,
): Promise<number> {
  const db = getDb();
  const rows = (await db
    .select({ id: drops.id })
    .from(drops)
    .where(and(
      eq(drops.user_id, userId),
      eq(drops.beat_id, beatId),
      gte(drops.dropped_at, sinceUnix),
      lt(drops.dropped_at, untilUnix),
    ))) as Array<{ id: string }>;
  return rows.length;
}

/** All drops for a user within a window, for in-memory bucketing (TodayModel). */
export async function dropsInWindow(userId: string, sinceUnix: number, untilUnix: number): Promise<Drop[]> {
  const db = getDb();
  return (await db
    .select()
    .from(drops)
    .where(and(eq(drops.user_id, userId), gte(drops.dropped_at, sinceUnix), lt(drops.dropped_at, untilUnix)))) as Drop[];
}
