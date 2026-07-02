import { NextRequest, NextResponse } from "next/server";
import { eq, and } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Cancel a scheduled send (#597/#222), returning the campaign to `draft` and
 * clearing scheduled_at. Guarded on status='scheduled' so it can't race a
 * dispatch tick that has already claimed the campaign into 'sending'.
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
  if (campaign.status !== "scheduled") {
    return NextResponse.json({ error: "Only scheduled campaigns can be cancelled" }, { status: 400 });
  }

  const changes = await executeChanges(
    db.update(emailCampaigns)
      .set({ status: "draft", scheduled_at: null, updated_at: new Date().toISOString() })
      .where(and(eq(emailCampaigns.id, id), eq(emailCampaigns.status, "scheduled")))
  );
  if (changes === 0) {
    // Lost the race to a dispatch tick — it's already sending/sent.
    return NextResponse.json({ error: "Campaign already dispatched" }, { status: 409 });
  }

  await logAdminAction(session.user.id, "campaign_schedule_cancelled", "campaign", id);

  const updated = await queryFirst(
    db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );
  return NextResponse.json({ data: updated });
}
