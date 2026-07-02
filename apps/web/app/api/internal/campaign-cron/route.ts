import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqualStr } from "@/lib/internal-auth";
import { log } from "@/lib/logger";
import { dispatchScheduledCampaigns } from "@/jobs/index";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPE = "api/internal/campaign-cron";

/**
 * Internal server-to-server endpoint invoked by the Workers Cron Trigger
 * (custom-worker.ts `scheduled()`, the every-15-minutes cron expression) to
 * run the campaign-engine recurring jobs — dispatching due scheduled sends
 * (#597, epic #595, sync #222). A Workers `scheduled()` handler can't touch D1 directly (no request
 * context), so it replays through the app's own fetch pipeline, same pattern
 * as app/api/internal/campaign-batch/route.ts.
 *
 * Auth: shared AGENTS_INTERNAL_SECRET via `x-agents-internal-secret`,
 * constant-time compared — NOT AppSeed's CRON_SECRET (#222 convention).
 */
export async function POST(request: NextRequest) {
  const secret = process.env.AGENTS_INTERNAL_SECRET;
  if (!secret) {
    log.error("AGENTS_INTERNAL_SECRET not configured — refusing internal call", { scope: SCOPE });
    return NextResponse.json({ error: "internal endpoint disabled" }, { status: 503 });
  }
  const presented = request.headers.get("x-agents-internal-secret");
  if (!presented || !timingSafeEqualStr(presented, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await dispatchScheduledCampaigns();

  return NextResponse.json({ ok: true });
}
