/**
 * GET /api/coomander/today — the TodayModel for the authed user (#152).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getTodayModel } from "@/lib/coomander/todayModel";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();
    const url = new URL(request.url);
    const date = url.searchParams.get("date") ?? undefined;
    const model = await getTodayModel(session.user.id, date);
    return NextResponse.json({ model });
  } catch (error) {
    log.error("GET /api/coomander/today failed", { error });
    return errorResponse(error);
  }
}
