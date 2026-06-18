/**
 * /api/coomander/weekly-review (#154).
 *
 * POST — Sunday cron target, guarded by x-agent-secret. For each ops-enabled
 * user: build the review, persist it, send the condensed Telegram message + each
 * drift question (threaded), and stamp day_state.
 *
 * GET — the authed user's stored review for ?date=YYYY-MM-DD, or the latest if no
 * date is given.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { eq, and } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { weeklyReviews } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { usersToPing, getTimezone } from "@/lib/coomander/settings";
import { todayLocal } from "@/lib/coomander/consistency";
import { buildWeeklyReview, getWeeklyReview, getLatestWeeklyReview, renderReviewMessage } from "@/lib/coomander/weeklyReview";
import { sendTelegram } from "@/lib/coomander/telegram";
import { appendMessage } from "@/lib/coomander/coomanderMessages";
import { setDayQuality } from "@/lib/coomander/scheduling";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 290;

/** Most recent Sunday (YYYY-MM-DD, UTC) on or before `now`. */
export function mostRecentSunday(now: Date): string {
  const dow = now.getUTCDay(); // 0=Sun
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - dow * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Most recent Sunday (YYYY-MM-DD) on or before the creator's LOCAL today (#183). */
export function mostRecentSundayLocal(tz: string): string {
  const today = todayLocal(tz); // YYYY-MM-DD in tz
  const dow = new Date(today + "T00:00:00Z").getUTCDay(); // weekday of the date string; 0=Sun
  const t = Date.parse(today + "T00:00:00Z") - dow * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

async function persistReview(userId: string, weekEnding: string, reviewJson: string, telegramMessageId: number | null, driftIds: number[]): Promise<void> {
  const db = getDb();
  const existing = (await db.select({ id: weeklyReviews.id }).from(weeklyReviews).where(and(eq(weeklyReviews.user_id, userId), eq(weeklyReviews.week_ending, weekEnding))).limit(1)) as Array<{ id: string }>;
  if (existing[0]) {
    await db.update(weeklyReviews).set({ review_json: reviewJson, telegram_message_id: telegramMessageId, drift_question_message_ids_json: JSON.stringify(driftIds) }).where(eq(weeklyReviews.id, existing[0].id));
  } else {
    await db.insert(weeklyReviews).values({
      id: crypto.randomUUID(), user_id: userId, week_ending: weekEnding,
      review_json: reviewJson, telegram_message_id: telegramMessageId,
      drift_question_message_ids_json: JSON.stringify(driftIds), created_at: Math.floor(Date.now() / 1000),
    });
  }
}

export async function POST(request: Request) {
  const secret = process.env.COOMANDER_RUN_SECRET;
  if (!secret) return NextResponse.json({ error: "COOMANDER_RUN_SECRET not configured" }, { status: 503 });
  if (request.headers.get("x-agent-secret") !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: { weekEnding?: unknown } = {};
  try { body = (await request.json()) ?? {}; } catch { body = {}; }
  // An explicit weekEnding (manual/testing) applies to all; otherwise each user
  // gets the most recent Sunday in THEIR local timezone (#183).
  const explicitWeekEnding = typeof body.weekEnding === "string" ? body.weekEnding : null;
  const appUrl = process.env.APP_URL || "https://coomander.com";

  const recipients = await usersToPing();
  const results: Array<{ userId: string; ok: boolean; weekEnding?: string; error?: string }> = [];

  for (const r of recipients) {
    try {
      const weekEnding = explicitWeekEnding ?? mostRecentSundayLocal(await getTimezone(r.userId));
      const review = await buildWeeklyReview(r.userId, weekEnding);
      const message = renderReviewMessage(review, appUrl);
      const send = await sendTelegram(r.chatId, message);
      await appendMessage(r.userId, "outbound", message, {}).catch(() => {});

      // Drift questions as separate threaded messages.
      const driftIds: number[] = [];
      for (const q of review.drift_questions) {
        const qs = await sendTelegram(r.chatId, q.question);
        if (qs.ok && qs.messageId) driftIds.push(qs.messageId);
        await appendMessage(r.userId, "outbound", q.question, {}).catch(() => {});
      }

      await persistReview(r.userId, weekEnding, JSON.stringify(review), send.messageId ?? null, driftIds);
      await setDayQuality(r.userId, weekEnding, null).catch(() => {}); // stamp the Sunday row exists
      results.push({ userId: r.userId, ok: true, weekEnding });
    } catch (e) {
      log.error("[POST /api/coomander/weekly-review]", { userId: r.userId, error: (e as Error).message });
      results.push({ userId: r.userId, ok: false, error: (e as Error).message });
    }
  }

  return NextResponse.json({ ok: true, weekEnding: explicitWeekEnding ?? "(per-user local Sunday)", users: recipients.length, results });
}

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();
    const date = new URL(request.url).searchParams.get("date");
    const review = date ? await getWeeklyReview(session.user.id, date) : await getLatestWeeklyReview(session.user.id);
    return NextResponse.json({ review });
  } catch (error) {
    log.error("GET /api/coomander/weekly-review failed", { error });
    return errorResponse(error);
  }
}
