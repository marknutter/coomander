import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";
import { getResend, FROM } from "@/lib/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_CAMPAIGNS);
  if (error) return error;

  const { id } = await params;

  const campaign = await queryFirst(
    getDb().select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  try {
    await getResend().emails.send({
      from: FROM,
      to: session.user.email,
      subject: `[Preview] ${campaign.subject}`,
      html: campaign.html_content,
    });

    return NextResponse.json({ data: { sent: true, to: session.user.email } });
  } catch (err) {
    console.error("[campaigns] preview send failed:", err);
    return NextResponse.json({ error: "Failed to send preview" }, { status: 500 });
  }
}
