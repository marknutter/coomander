/**
 * GET /api/coomander/weekly-review/latest — convenience: the authed user's most
 * recent stored weekly review (#154).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getLatestWeeklyReview } from "@/lib/coomander/weeklyReview";
import { UnauthorizedError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();
    return NextResponse.json({ review: await getLatestWeeklyReview(session.user.id) });
  } catch (error) {
    log.error("GET /api/coomander/weekly-review/latest failed", { error });
    return errorResponse(error);
  }
}
