/**
 * /api/coomander/chat — in-app Coomander chat history (#169, epic #168).
 *
 * GET → the unified thread (the SAME `coomander_message_log` as Telegram, so
 *       web + phone are one conversation) + whether ops is enabled.
 *
 * The SEND path (chat turns) moved entirely to the agents WebSocket in Phase D
 * (#203) — there is no longer a POST handler here. Both web and mobile send over
 * the WebSocket and use THIS GET to hydrate the thread on mount/refresh.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { listMessages } from "@/lib/coomander/coomanderMessages";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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
