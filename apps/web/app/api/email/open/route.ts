import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emailEvents } from "@/lib/schema";
import { verifyTrackingToken, TRANSPARENT_GIF } from "@/lib/email-tracking";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Open-tracking pixel. Campaign HTML embeds a 1×1 image pointing here with a
 * signed token (`t`). We log an `opened` event and always return the pixel.
 *
 * Note: open tracking is inherently noisy — Apple Mail Privacy Protection and
 * Gmail's image proxy pre-fetch/proxy images, which inflates or suppresses
 * opens. Treat opens as directional, not exact. Clicks are the reliable signal.
 */
export async function GET(req: NextRequest) {
  const ctx = verifyTrackingToken(new URL(req.url).searchParams.get("t"));

  if (ctx) {
    try {
      const db = getDb();
      await db
        .insert(emailEvents)
        .values({
          campaign_id: ctx.campaignId,
          subscriber_email: ctx.email,
          event_type: "opened",
        })
        .run();
    } catch (err) {
      console.error("[email/open] failed to log open event:", err);
    }
  }

  return new NextResponse(new Uint8Array(TRANSPARENT_GIF), {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(TRANSPARENT_GIF.length),
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
