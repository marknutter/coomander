import { NextRequest, NextResponse } from "next/server";
import { processCampaignBatch, type CampaignBatchPayload } from "@/lib/campaign-send";
import { timingSafeEqualStr } from "@/lib/internal-auth";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPE = "api/internal/campaign-batch";

/**
 * Internal server-to-server endpoint that runs one campaign send batch (#454,
 * epic #595, sync #222). Called by the CAMPAIGN_QUEUE consumer
 * (lib/queue-consumer.ts, on Workers) or the dev SQLite/D1 job-queue drain
 * (lib/jobs.ts, off Workers) — never reachable by browsers.
 *
 * Auth mirrors the agents-worker internal pattern (see
 * app/api/internal/telegram-deliver/route.ts): a shared AGENTS_INTERNAL_SECRET
 * presented via `x-agents-internal-secret`, compared in constant time.
 * Deliberately NOT AppSeed's CRON_SECRET (#222 convention).
 *
 * Body: CampaignBatchPayload ({ campaignId, subject, html, recipients }).
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

  let payload: CampaignBatchPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  if (!payload?.campaignId || !Array.isArray(payload?.recipients)) {
    return NextResponse.json({ error: "invalid batch payload" }, { status: 400 });
  }

  try {
    await processCampaignBatch(payload);
    return NextResponse.json({ ok: true });
  } catch (err) {
    // Rate-limit errors (and any other throw) surface as a non-2xx so the
    // queue consumer / job-queue retries the whole batch.
    log.warn("[campaign-batch] batch processing failed, will be retried", {
      scope: SCOPE,
      campaignId: payload.campaignId,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "batch failed" },
      { status: 429 },
    );
  }
}
