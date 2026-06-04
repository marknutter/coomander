/**
 * Auto-drop detection from the IG sync pipeline (#152).
 *
 * When IG sync lands a NEW post, we try to attribute it to a content beat and
 * record an `auto_ig` drop, and (if a content item is sitting in `scheduled`)
 * auto-advance it to `shipped`. The match heuristic is intentionally WEAK in V1
 * — Coomander confirms over Telegram ("looks like you posted a reel, counted it")
 * so the creator can correct a wrong attribution.
 *
 * Best-effort: this must NEVER break IG sync, so onNewInstagramPost swallows all
 * its own errors. The pure matcher (matchBeatForIgPost) is unit-testable.
 */

import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cadenceBeats, contentStates, type CadenceBeat } from "@/lib/schema";
import { logDrop } from "./drops";
import { transitionContent } from "./contentStates";
import { getCoomanderSettings, resolveUserByChatId } from "./settings";
import { sendTelegram } from "./telegram";
import { appendMessage } from "./coomanderMessages";
import { user as userT } from "@/lib/schema";
import { log } from "@/lib/logger";

const PRIORITY_RANK: Record<string, number> = { high: 3, med: 2, low: 1 };

/**
 * Pick the best beat for a new IG post. Candidates are active beats that are
 * IG-eligible (platform_specific 'ig' or platform-agnostic) and not wall-buffer
 * beats. Highest priority wins, then most recently created. Returns null if no
 * candidate (caller skips the drop).
 */
export function matchBeatForIgPost(beats: CadenceBeat[]): CadenceBeat | null {
  const candidates = beats.filter(
    (b) =>
      b.active === 1 &&
      b.archived_at == null &&
      (b.platform_specific === "ig" || b.platform_specific == null) &&
      b.cadence_kind !== "daily_vlog_buffer",
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pr = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
    if (pr !== 0) return pr;
    return (b.created_at ?? 0) - (a.created_at ?? 0);
  });
  return candidates[0];
}

export interface NewIgPost {
  mediaId: string;
  mediaType?: string | null;
  caption?: string | null;
  permalink?: string | null;
}

/**
 * Record an auto_ig drop for a freshly-synced IG post and confirm over Telegram.
 * Never throws.
 */
export async function onNewInstagramPost(userId: string, post: NewIgPost): Promise<void> {
  try {
    const db = getDb();
    const beats = (await db
      .select()
      .from(cadenceBeats)
      .where(eq(cadenceBeats.user_id, userId))) as CadenceBeat[];
    const beat = matchBeatForIgPost(beats);
    if (!beat) return; // nothing to attribute to yet

    // Auto-advance a scheduled content item for this beat, if any.
    let advancedTitle: string | null = null;
    const scheduled = await db
      .select()
      .from(contentStates)
      .where(and(
        eq(contentStates.user_id, userId),
        eq(contentStates.beat_id, beat.id),
        eq(contentStates.current_state, "scheduled"),
      ))
      .limit(1);
    const scheduledRow = scheduled[0] as { id: string; title: string } | undefined;

    await logDrop(userId, {
      beatId: beat.id,
      kind: "shipped",
      source: "auto_ig",
      platform: "ig",
      externalRef: post.mediaId,
      contentStateId: scheduledRow?.id ?? null,
      payload: { caption: post.caption ?? null, permalink: post.permalink ?? null, mediaType: post.mediaType ?? null },
    });

    if (scheduledRow) {
      const res = await transitionContent(userId, scheduledRow.id, "shipped");
      if (res.ok) advancedTitle = scheduledRow.title;
    }

    // Confirm over Telegram so the creator can correct a wrong match.
    const settings = await getCoomanderSettings(userId);
    const rows = (await db.select({ chatId: userT.telegramChatId, enabled: userT.coomanderEnabled }).from(userT).where(eq(userT.id, userId)).limit(1)) as Array<{ chatId: string | null; enabled: number }>;
    const u = rows[0];
    if (u?.enabled === 1 && u.chatId) {
      const extra = advancedTitle ? ` Marked "${advancedTitle}" as shipped.` : "";
      const msg = `Looks like you posted a reel. I counted it toward ${beat.name}.${extra} Reply if that is wrong.`;
      const send = await sendTelegram(u.chatId, msg);
      if (send.ok) {
        await appendMessage(userId, "outbound", msg, { personaMode: settings.personaMode }).catch(() => {});
      }
    }
  } catch (e) {
    log.error("[coomander/autoDrop] onNewInstagramPost failed", {
      error: e instanceof Error ? e.message : String(e),
      userId,
      mediaId: post.mediaId,
    });
  }
}

// `resolveUserByChatId` re-exported for symmetry with future auto_of detection.
export { resolveUserByChatId };
