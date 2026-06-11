/**
 * GET /api/coomander/home — everything the agent-first home (`/app`) needs in
 * one request (#170, epic #168): whether ops is enabled/seeded, the deterministic
 * "what's on the table today" brief (grounded in the live TodayModel + Day 1-6
 * ramp), and the last few thread messages for the recent-conversation snippet.
 *
 * Loads cleanly with no ops data — `brief` is null when ops is off, so the home
 * renders its new-user "meet Coomander" empty state instead of a 500.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { getCoomanderSettings } from "@/lib/coomander/settings";
import { getHomeBrief } from "@/lib/coomander/homeBrief";
import { listMessages } from "@/lib/coomander/coomanderMessages";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();
    const userId = session.user.id;

    const db = getDb();
    const rows = (await db
      .select({ enabled: userT.coomanderEnabled })
      .from(userT)
      .where(eq(userT.id, userId))
      .limit(1)) as Array<{ enabled: number }>;
    const enabled = (rows[0]?.enabled ?? 0) === 1;
    const settings = await getCoomanderSettings(userId);
    const seeded = settings.opsSeededAt != null;

    const brief = enabled ? await getHomeBrief(userId) : null;
    const recent = (await listMessages(userId, 4)).map((m) => ({
      id: m.id,
      role: m.direction === "inbound" ? "user" : "assistant",
      content: m.text,
      createdAt: m.createdAt,
    }));

    return NextResponse.json({ enabled, seeded, brief, recentMessages: recent });
  } catch (error) {
    log.error("GET /api/coomander/home failed", { error });
    return errorResponse(error);
  }
}
