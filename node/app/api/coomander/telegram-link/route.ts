/**
 * /api/coomander/telegram-link — connect/disconnect the creator's Telegram (#185).
 *
 * GET    → { linked, botUsername } (for the connect UI to poll).
 * POST   → mint a one-time link code: { code, botUsername, deepLink, expiresAt }.
 *          The creator taps the deep link (or sends the code) to @coomander_bot;
 *          the webhook's consumeLinkCode binds their chat.
 * DELETE → disconnect (clears user.telegramChatId + any pending code).
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { createLinkCode, unlinkTelegram, deepLink, COOMANDER_BOT_USERNAME } from "@/lib/coomander/linkCodes";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireUser(request: Request): Promise<string> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();
  return session.user.id;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUser(request);
    const db = getDb();
    const rows = (await db.select({ chatId: userT.telegramChatId }).from(userT).where(eq(userT.id, userId)).limit(1)) as Array<{ chatId: string | null }>;
    return NextResponse.json({ linked: !!rows[0]?.chatId, botUsername: COOMANDER_BOT_USERNAME });
  } catch (error) {
    log.error("GET /api/coomander/telegram-link failed", { error });
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUser(request);
    const { code, expiresAt } = await createLinkCode(userId);
    return NextResponse.json({
      ok: true,
      code,
      expiresAt,
      botUsername: COOMANDER_BOT_USERNAME,
      deepLink: deepLink(code),
      instructions: `Open Telegram, message @${COOMANDER_BOT_USERNAME}, and send: ${code}`,
    });
  } catch (error) {
    log.error("POST /api/coomander/telegram-link failed", { error });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUser(request);
    await unlinkTelegram(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("DELETE /api/coomander/telegram-link failed", { error });
    return errorResponse(error);
  }
}
