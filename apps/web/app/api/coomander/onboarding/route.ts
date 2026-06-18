/**
 * GET /api/coomander/onboarding — the session user's onboarding progress (#173,
 * epic #168).
 *
 * Progress is DERIVED from real per-user signals (no extra storage), so the
 * "meet Coomander" flow is resumable across browsers and sessions — it always
 * lands the creator on the first step they haven't actually completed:
 *
 *   ops        → user.coomanderEnabled
 *   cadence    → coomander_settings.defaults_banner_dismissed_at (defaults confirmed)
 *   instagram  → an Instagram connection exists
 *   telegram   → user.telegramChatId is set (optional step)
 *
 * `complete` is true once the required steps (ops + cadence) are done; Instagram
 * and Telegram are encouraged but skippable.
 */

import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { getCoomanderSettings } from "@/lib/coomander/settings";
import { getConnectedAccount } from "@/lib/platforms/instagram";
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
      .select({ enabled: userT.coomanderEnabled, telegramChatId: userT.telegramChatId })
      .from(userT)
      .where(eq(userT.id, userId))
      .limit(1)) as Array<{ enabled: number; telegramChatId: string | null }>;

    const enabled = (rows[0]?.enabled ?? 0) === 1;
    const telegramLinked = !!rows[0]?.telegramChatId;

    const settings = await getCoomanderSettings(userId);
    const cadenceConfirmed = settings.defaultsBannerDismissedAt != null;

    let instagramConnected = false;
    try {
      instagramConnected = !!(await getConnectedAccount(userId));
    } catch {
      instagramConnected = false; // IG not configured → treat as not connected
    }

    const required = enabled && cadenceConfirmed;

    return NextResponse.json({
      steps: {
        ops: enabled,
        cadence: cadenceConfirmed,
        instagram: instagramConnected,
        telegram: telegramLinked,
      },
      complete: required,
    });
  } catch (error) {
    log.error("GET /api/coomander/onboarding failed", { error });
    return errorResponse(error);
  }
}
