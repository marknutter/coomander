/**
 * POST /api/coomander/run — Coomander cron entrypoint (#151, milestone 1).
 *
 * Fired by the Cloudflare cron (see custom-worker.ts), not a browser, so there
 * is no user session. Guarded by a shared secret: the caller must send
 * `x-agent-secret: $COOMANDER_RUN_SECRET`. Returns 503 if the secret is unset,
 * 401 on mismatch. Always returns 200 with a status object on the happy path so
 * the cron never sees a 500 and retry-storms.
 *
 * MILESTONE 1 SCOPE (deliberately minimal — see docs/strategy/next-session-brief.md §6):
 *   - No planPing decision logic yet: the ping is UNCONDITIONAL (good for testing).
 *   - No slot routing: the request body's `slot` is accepted but ignored.
 *   - Iterate every user with `coomanderEnabled = 1` AND a `telegramChatId`,
 *     send a fixed placeholder message, and log each send to
 *     `coomander_message_log` (the indefinite-retention substrate).
 *
 * Decision logic, per-slot persona prompts, and nag presets land in later
 * milestones.
 */

import { NextResponse } from "next/server";
import crypto from "crypto";
import { getDb } from "@/lib/db";
import { user, coomanderMessageLog } from "@/lib/schema";
import { sendTelegram } from "@/lib/coomander/telegram";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PLACEHOLDER — real persona-driven content lands in #153. This fixed string
// only proves the cron → route → Telegram → log path end-to-end.
const PLACEHOLDER_MESSAGE = "Coomander online — this is a test ping. The infra works.";

export async function POST(request: Request) {
  const secret = process.env.COOMANDER_RUN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "COOMANDER_RUN_SECRET not configured" }, { status: 503 });
  }
  if (request.headers.get("x-agent-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Body is optional; `slot` is accepted for forward-compat but ignored in M1.
  try {
    await request.json().catch(() => ({}));
  } catch {
    // Non-JSON body is fine for the unconditional M1 ping.
  }

  const db = getDb();
  const { eq, and, isNotNull } = await import("drizzle-orm");

  // Users who have opted into Coomander AND have a Telegram destination.
  const recipients = await db
    .select({ id: user.id, chatId: user.telegramChatId })
    .from(user)
    .where(and(eq(user.coomanderEnabled, 1), isNotNull(user.telegramChatId)));

  const results: Array<{ userId: string; sent: boolean; messageId?: number; error?: string }> = [];

  for (const r of recipients) {
    const chatId = r.chatId ?? "";
    const send = await sendTelegram(chatId, PLACEHOLDER_MESSAGE);

    // Persist the outbound message to the no-TTL log regardless of send outcome,
    // so the substrate captures intent even if Telegram delivery failed.
    try {
      await db.insert(coomanderMessageLog).values({
        id: crypto.randomUUID(),
        user_id: r.id,
        direction: "outbound",
        telegram_update_id: null,
        text: PLACEHOLDER_MESSAGE,
        tool_call_json: null,
        persona_mode: "light_companion",
        created_at: Math.floor(Date.now() / 1000),
      });
    } catch (e) {
      log.error("[POST /api/coomander/run] failed to log outbound message", {
        error: e instanceof Error ? e.message : String(e),
        userId: r.id,
      });
    }

    if (!send.ok) {
      log.warn("[POST /api/coomander/run] telegram send failed", { userId: r.id, error: send.error });
    }
    results.push({ userId: r.id, sent: send.ok, messageId: send.messageId, error: send.error });
  }

  log.info("[POST /api/coomander/run] complete", {
    recipients: recipients.length,
    sent: results.filter((x) => x.sent).length,
  });

  return NextResponse.json({ ok: true, recipients: recipients.length, results });
}
