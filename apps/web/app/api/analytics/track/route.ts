import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { track } from "@/lib/analytics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/analytics/track
 *
 * Server-side proxy for client analytics events.
 * Keeps API keys off the client and attaches userId from session.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { event, properties } = body;

    if (!event || typeof event !== "string") {
      return NextResponse.json({ error: "event is required" }, { status: 400 });
    }

    // Attach userId if authenticated
    let userId: string | undefined;
    try {
      const session = await auth.api.getSession({ headers: request.headers });
      userId = session?.user?.id;
    } catch {
      // Not authenticated — track as anonymous
    }

    await track(event, properties, userId);

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true }); // Never fail on analytics
  }
}
