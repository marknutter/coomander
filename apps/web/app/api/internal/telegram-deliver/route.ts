import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { sendTelegram } from "@/lib/coomander/telegram";
import { timingSafeEqualStr } from "@/lib/internal-auth";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPE = "api/internal/telegram-deliver";

/**
 * Internal server-to-server endpoint for the agents Worker's proactive-delivery
 * fallback (#192).
 *
 * ⚠️ COOMANDER DIVERGENCE from the AppSeed template: where the template's
 * scheduled-wake fallback persists an in-app notification, Coomander delivers
 * the nudge over its NATIVE channel — Telegram — using the existing apps/web
 * `sendTelegram` path. The agents Worker's `AppAgent.onUndeliverable` calls this
 * when a scheduled reminder fires and no live WebSocket is connected.
 *
 * A scheduled wake fires from a Durable Object alarm with no user session — so
 * it can't authenticate the normal (cookie) way. Instead the agent proves itself
 * with the shared `AGENTS_INTERNAL_SECRET` and asserts the target `userId`. NOT
 * reachable by browsers. A user with no linked Telegram chat is a graceful
 * no-op (the reminder is still persisted to the thread by the Worker).
 *
 * Body: { userId, message }
 */
export async function POST(request: NextRequest) {
  const secret = process.env.AGENTS_INTERNAL_SECRET;
  if (!secret) {
    log.error("AGENTS_INTERNAL_SECRET not configured — refusing internal call", { scope: SCOPE });
    return NextResponse.json({ error: "internal endpoint disabled" }, { status: 503 });
  }
  const presented = request.headers.get("x-agents-internal-secret");
  if (!presented || !timingSafeEqualStr(presented, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: { userId?: string; message?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const userId = body.userId?.trim();
  const message = (body.message ?? "").trim();
  if (!userId || !message) {
    return NextResponse.json({ error: "userId and message are required" }, { status: 400 });
  }

  const db = getDb();
  const rows = (await db
    .select({ chatId: userT.telegramChatId })
    .from(userT)
    .where(eq(userT.id, userId))
    .limit(1)) as Array<{ chatId: string | null }>;
  if (!rows[0]) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const chatId = rows[0].chatId;
  if (!chatId) {
    // No linked Telegram chat — nothing to deliver to, but not an error: the
    // reminder is already persisted to the thread.
    log.info("Telegram fallback skipped — no linked chat", { scope: SCOPE, userId });
    return NextResponse.json({ delivered: false, reason: "no_telegram_chat" }, { status: 200 });
  }

  const result = await sendTelegram(chatId, message);
  log.info("Telegram fallback delivery attempted", { scope: SCOPE, userId, ok: result.ok });
  return NextResponse.json({ delivered: result.ok }, { status: result.ok ? 200 : 502 });
}
