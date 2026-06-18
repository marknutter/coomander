import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emailEvents } from "@/lib/schema";
import { verifyTrackingToken } from "@/lib/email-tracking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Click-tracking redirect. Campaign links are rewritten to point here with a
 * signed token (`t`) whose payload includes the destination URL. We log a
 * `clicked` event and 302 to that signed destination. Because the destination
 * is part of the HMAC signature (not a separate, swappable query param), this
 * endpoint cannot be coerced into an open redirect: an unverifiable token, or a
 * signed destination that isn't http(s), sends the visitor to the app home.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const ctx = verifyTrackingToken(searchParams.get("t"));
  // NextResponse.redirect requires an absolute URL; resolve APP_URL (or "/")
  // against the request origin so the home fallback is always absolute.
  const home = new URL(process.env.APP_URL || "/", req.url);
  const safeTarget =
    ctx?.url && /^https?:\/\//i.test(ctx.url) ? ctx.url : null;

  if (!ctx || !safeTarget) {
    return NextResponse.redirect(home, 302);
  }

  try {
    const db = getDb();
    await db
      .insert(emailEvents)
      .values({
        campaign_id: ctx.campaignId,
        subscriber_email: ctx.email,
        event_type: "clicked",
        link_url: safeTarget,
      })
      .run();
  } catch (err) {
    // Never let logging failure break the redirect for the recipient.
    console.error("[email/click] failed to log click event:", err);
  }

  return NextResponse.redirect(safeTarget, 302);
}
