import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";
import { resendCampaign } from "@/lib/campaign-send";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Re-dispatch a FAILED campaign to the recipients that never received it
 * (hardening follow-up, sync #222). Idempotent — already-sent recipients are
 * excluded, so no one is emailed twice. Atomic claim (failed→sending)
 * prevents a double-resend from two clicks.
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
    db.select({ status: emailCampaigns.status }).from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "failed") {
    return NextResponse.json({ error: "Only failed campaigns can be resent" }, { status: 400 });
  }

  // Atomic claim so two resend clicks can't both dispatch.
  const claimed = await executeChanges(
    db.update(emailCampaigns)
      .set({ status: "sending", updated_at: new Date().toISOString() })
      .where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "failed")))
  );
  if (claimed === 0) {
    return NextResponse.json({ error: "Campaign is no longer failed" }, { status: 409 });
  }

  try {
    const result = await resendCampaign(id);
    await logAdminAction(session.user.id, "campaign_resent", "campaign", id, {
      recipients: result.recipients,
      skipped_already_sent: result.alreadySent,
    });
    const updated = await queryFirst(
      db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
    );
    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("[campaigns] resend failed:", err);
    await db.update(emailCampaigns)
      .set({ status: "failed", updated_at: new Date().toISOString() })
      .where(eq(emailCampaigns.id, id))
      .run();
    return NextResponse.json({ error: "Failed to resend campaign" }, { status: 500 });
  }
}
