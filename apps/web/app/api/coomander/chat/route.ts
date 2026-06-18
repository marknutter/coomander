/**
 * /api/coomander/chat — in-app Coomander chat (#169, epic #168).
 *
 * GET  → the unified thread (the SAME `coomander_message_log` as Telegram, so
 *        web + phone are one conversation) + whether ops is enabled.
 * POST → one chat turn: Coomander either converses or takes a domain action
 *        (tool-use), grounded in the live TodayModel. Persists both sides.
 *
 * V1 is request/response JSON (replies are short, 1-4 sentences). Token-level
 * SSE streaming is a follow-up polish.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { handleChatTurn, streamChatTurn, recentTurns } from "@/lib/coomander/coomanderChat";
import { listMessages } from "@/lib/coomander/coomanderMessages";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();
  return session.user.id;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUser(request);
    const db = getDb();
    const rows = (await db.select({ enabled: userT.coomanderEnabled }).from(userT).where(eq(userT.id, userId)).limit(1)) as Array<{ enabled: number }>;
    const enabled = (rows[0]?.enabled ?? 0) === 1;
    const messages = await listMessages(userId, 100);
    return NextResponse.json({
      enabled,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.direction === "inbound" ? "user" : "assistant",
        content: m.text,
        createdAt: m.createdAt,
      })),
    });
  } catch (error) {
    log.error("GET /api/coomander/chat failed", { error });
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as { message?: unknown };
    const message = typeof body.message === "string" ? body.message.trim() : "";
    if (!message) throw new BadRequestError("message is required");

    // Content-negotiate: SSE token streaming for clients that ask for it (the
    // mobile XHR-SSE path, mirroring geology's /api/chat), JSON otherwise (the
    // web chat depends on the byte-for-byte `{ reply, acted }` shape).
    const wantsStream = request.headers.get("accept")?.includes("text/event-stream");
    if (wantsStream) {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          streamChatTurn(userId, message, {
            onText(text) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
            },
            onDone(fullText, acted) {
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ done: true, fullText, acted })}\n\n`),
              );
              controller.close();
            },
            onError(error) {
              log.error("POST /api/coomander/chat stream failed", { error });
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ error: "Something went wrong. Please try again." })}\n\n`,
                ),
              );
              controller.close();
            },
          });
        },
      });
      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const result = await handleChatTurn(userId, message);
    return NextResponse.json({ reply: result.reply, acted: result.acted });
  } catch (error) {
    log.error("POST /api/coomander/chat failed", { error });
    return errorResponse(error);
  }
}

// `recentTurns` re-exported intentionally unused here; keeps the module's public
// surface discoverable for future SSE work.
void recentTurns;
