/**
 * POST /api/coomander/enable — turn on the ops feature for the authed user and
 * seed the v1 playbook defaults (#153).
 *
 * Sets user.coomanderEnabled = 1 and runs seedOpsDefaults (idempotent). Returns
 * the seed result so the UI can show "seeded N pillars" or "already enabled".
 * GET returns whether ops is enabled + seeded (for the settings toggle state).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { seedOpsDefaults } from "@/lib/coomander/seed-defaults";
import { getCoomanderSettings } from "@/lib/coomander/settings";
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
    const settings = await getCoomanderSettings(userId);
    return NextResponse.json({ enabled: (rows[0]?.enabled ?? 0) === 1, seeded: settings.opsSeededAt != null });
  } catch (error) {
    log.error("GET /api/coomander/enable failed", { error });
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUser(request);
    const db = getDb();
    await db.update(userT).set({ coomanderEnabled: 1 }).where(eq(userT.id, userId));
    const seed = await seedOpsDefaults(userId);
    return NextResponse.json({ enabled: true, seed });
  } catch (error) {
    log.error("POST /api/coomander/enable failed", { error });
    return errorResponse(error);
  }
}
