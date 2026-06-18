import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailCampaigns, newsletterSubscribers } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";
import { sendCampaignDirect } from "@/lib/broadcasts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

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

  // Update status to sending
  await db.update(emailCampaigns)
    .set({ status: "sending", updated_at: new Date().toISOString() })
    .where(eq(emailCampaigns.id, id))
    .run();

  try {
    // Cloudflare Email Service has no audience/broadcast API, so campaigns are
    // always sent directly to our active subscribers, one email per recipient.
    const subscribers = await db
      .select({ email: newsletterSubscribers.email })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.status, "active"))
      .all();

    const emails = subscribers.map((s) => s.email);

    await db.update(emailCampaigns)
      .set({ recipient_count: emails.length, updated_at: new Date().toISOString() })
      .where(eq(emailCampaigns.id, id))
      .run();

    const result = await sendCampaignDirect(id, campaign.subject, campaign.html_content, emails);

    await db.update(emailCampaigns)
      .set({
        status: "sent",
        sent_count: result.sent,
        sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .where(eq(emailCampaigns.id, id))
      .run();

    await logAdminAction(session.user.id, "campaign_sent", "campaign", id);

    const updated = await queryFirst(
      db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
    );

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("[campaigns] send failed:", err);

    await db.update(emailCampaigns)
      .set({ status: "failed", updated_at: new Date().toISOString() })
      .where(eq(emailCampaigns.id, id))
      .run();

    return NextResponse.json({ error: "Failed to send campaign" }, { status: 500 });
  }
}
