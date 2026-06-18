import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_CAMPAIGNS);
  if (error) return error;

  const { id } = await params;
  const campaign = await queryFirst(
    getDb().select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  return NextResponse.json({ data: campaign });
}

export async function PATCH(
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
    return NextResponse.json({ error: "Only draft campaigns can be edited" }, { status: 400 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const allowedFields = ["name", "subject", "html_content", "preview_text", "audience_filter", "scheduled_at"];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  await db.update(emailCampaigns)
    .set(updates)
    .where(eq(emailCampaigns.id, id))
    .run();

  await logAdminAction(session.user.id, "campaign_updated", "campaign", id);

  const updated = await queryFirst(
    db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );

  return NextResponse.json({ data: updated });
}

export async function DELETE(
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
  if (campaign.status !== "draft") {
    return NextResponse.json({ error: "Only draft campaigns can be deleted" }, { status: 400 });
  }

  const changes = await executeChanges(
    db.delete(emailCampaigns).where(eq(emailCampaigns.id, id))
  );

  if (changes === 0) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  await logAdminAction(session.user.id, "campaign_deleted", "campaign", id);

  return NextResponse.json({ data: { deleted: true } });
}
