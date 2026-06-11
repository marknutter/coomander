/**
 * Inbound Telegram update de-duplication (#151).
 *
 * Telegram redelivers a webhook update until it receives a 2xx, so the same
 * message can arrive more than once. We claim each update_id in `coomander_dedup`
 * before processing. Telegram's retries are sequential (after a timeout), so a
 * select-then-insert reliably catches a redelivery; onConflictDoNothing guards
 * the rare exact-simultaneous case from throwing.
 *
 * Ported from ~/Code/geology/web/node/lib/geology/telegramDedup.ts.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { coomanderDedup as dedupT } from "@/lib/schema";

/**
 * Returns true if this update_id is new (and now claimed), false if it was
 * already processed. A false result means the caller must NOT act on it again.
 */
export async function claimUpdate(updateId: number, userId: string): Promise<boolean> {
  const db = getDb();
  const existing = await db
    .select()
    .from(dedupT)
    .where(eq(dedupT.telegram_update_id, updateId))
    .limit(1);
  if (existing.length > 0) return false;
  await db
    .insert(dedupT)
    .values({ telegram_update_id: updateId, user_id: userId, processed_at: Math.floor(Date.now() / 1000) })
    .onConflictDoNothing();
  return true;
}
