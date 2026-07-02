import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";
import { parseAudienceFilter, resolveAudience } from "@/lib/audiences";
import { enqueueCampaignSend } from "@/lib/campaign-send";
import { errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Kick off a campaign send (#454, epic #595, sync #222). Resolves the
 * campaign's audience_filter to a concrete recipient list, then hands off to
 * the batched producer (lib/campaign-send.ts) which enqueues the send and
 * returns immediately — the actual emails go out asynchronously via the
 * CAMPAIGN_QUEUE consumer (Workers) or the job-queue drain (dev).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_CAMPAIGNS);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  const campaign = await queryFirst(
    db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "draft") {
    return NextResponse.json({ error: "Only draft campaigns can be sent" }, { status: 400 });
  }

  const filter = parseAudienceFilter(campaign.audience_filter);
  const recipients = await resolveAudience(filter);

  try {
    await enqueueCampaignSend({
      campaignId: id,
      subject: campaign.subject,
      html: campaign.html_content,
      recipients,
    });
  } catch (err) {
    // enqueueCampaignSend flips status to 'sending' immediately, then loops
    // enqueueing batches — if any enqueue throws partway, the campaign would
    // otherwise be stuck at 'sending' forever (the UI blocks retry with "Only
    // draft campaigns can be sent"). Revert to 'failed' so an admin can resend
    // (resendCampaign only emails recipients who don't already have a `sent`
    // event, so nothing double-sends). Mirrors the pre-batching send route's
    // catch block.
    log.error("[campaigns] send failed to enqueue", {
      campaignId: id,
      error: err instanceof Error ? err.message : String(err),
    });
    await db
      .update(emailCampaigns)
      .set({ status: "failed", updated_at: new Date().toISOString() })
      .where(eq(emailCampaigns.id, id))
      .run();
    return errorResponse(err);
  }

  await logAdminAction(session.user.id, "campaign_sent", "campaign", id, {
    recipientCount: recipients.length,
  });

  const updated = await queryFirst(
    db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );

  return NextResponse.json({ data: updated });
}
