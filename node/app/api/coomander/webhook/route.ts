/**
 * POST /api/coomander/webhook — inbound Telegram updates for @coomander_bot (#151).
 *
 * The creator replies in plain language; we classify it (placeholder
 * need_clarification tool for now) and reply. Both the inbound message (with the
 * classifier's tool-call JSON) and the outbound reply are persisted to the
 * no-TTL `coomander_message_log`.
 *
 * Security: Telegram echoes the secret_token set at webhook registration in the
 * `x-telegram-bot-api-secret-token` header. We reject a mismatch (401) and 503
 * if `MADDIE_TELEGRAM_WEBHOOK_SECRET` is unset. Every other outcome returns 200
 * so Telegram does not retry-storm. Unknown chats get a one-line hint.
 *
 * Ported from ~/Code/geology/web/node/app/api/telegram/webhook/route.ts,
 * simplified to Coomander's user-row chat mapping (no link-code flow).
 */

import { NextResponse } from "next/server";
import { handleInbound } from "@/lib/coomander/inbound";
import { claimUpdate } from "@/lib/coomander/telegramDedup";
import { sendTelegram } from "@/lib/coomander/telegram";
import { resolveUserByChatId, getCoomanderSettings } from "@/lib/coomander/settings";
import { appendMessage } from "@/lib/coomander/coomanderMessages";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60; // Telegram retries until a 2xx; stay inside its timeout

export async function POST(request: Request) {
  const secret = process.env.MADDIE_TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "MADDIE_TELEGRAM_WEBHOOK_SECRET not configured" }, { status: 503 });
  }
  if (request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: { update_id?: number; message?: { text?: string; chat?: { id?: number | string } } };
  try {
    update = await request.json();
  } catch {
    return NextResponse.json({ ok: true, ignored: "invalid JSON" });
  }

  let chatId: string | null = null;
  try {
    const updateId = update.update_id;
    const text = update.message?.text;
    chatId = update.message?.chat?.id != null ? String(update.message.chat.id) : null;

    // Ignore non-text updates (stickers, edits, joins, etc.).
    if (typeof updateId !== "number" || !text || !chatId) {
      return NextResponse.json({ ok: true, ignored: "non-text update" });
    }

    // Unknown chat -> a one-line hint, nothing persisted.
    const userId = await resolveUserByChatId(chatId);
    if (!userId) {
      await sendTelegram(
        chatId,
        "I do not recognize this chat yet. Enable Coomander in Coomander and link this Telegram to start.",
      );
      return NextResponse.json({ ok: true, ignored: "unlinked chat" });
    }

    // De-dup: a redelivered update must never double-process.
    const fresh = await claimUpdate(updateId, userId);
    if (!fresh) return NextResponse.json({ ok: true, ignored: "duplicate update" });

    const settings = await getCoomanderSettings(userId);
    const result = await handleInbound(userId, text, settings.personaMode);

    // Persist inbound (with the classifier tool-call) + outbound to the substrate.
    await appendMessage(userId, "inbound", text, {
      personaMode: settings.personaMode,
      telegramUpdateId: updateId,
      toolCall: result.toolCall ?? undefined,
    }).catch(() => {});

    await sendTelegram(chatId, result.reply);
    await appendMessage(userId, "outbound", result.reply, { personaMode: settings.personaMode }).catch(() => {});

    return NextResponse.json({ ok: true, classified: result.toolCall?.map((t) => t.toolName).join(",") ?? null });
  } catch (e) {
    // Always 200 so Telegram does not retry-storm.
    log.error("[POST /api/coomander/webhook]", { error: e instanceof Error ? e.message : String(e) });
    if (chatId) {
      await sendTelegram(chatId, "Something went wrong on my end. Try again in a moment.").catch(() => {});
    }
    return NextResponse.json({ ok: true, error: (e as Error).message });
  }
}
