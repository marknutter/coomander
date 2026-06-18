import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { eq, like, desc, count, and } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_CAMPAIGNS);
  if (error) return error;

  const db = getDb();
  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") ?? "";
  const status = searchParams.get("status") ?? "";
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "50")));
  const offset = (page - 1) * limit;

  const conditions = [];
  if (search) conditions.push(like(emailCampaigns.name, `%${search}%`));
  if (status) conditions.push(eq(emailCampaigns.status, status));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const totalRow = await queryFirst(
    db.select({ count: count() }).from(emailCampaigns).where(where)
  );
  const total = totalRow?.count ?? 0;

  const campaigns = await db
    .select({
      id: emailCampaigns.id,
      name: emailCampaigns.name,
      subject: emailCampaigns.subject,
      status: emailCampaigns.status,
      recipient_count: emailCampaigns.recipient_count,
      sent_count: emailCampaigns.sent_count,
      scheduled_at: emailCampaigns.scheduled_at,
      sent_at: emailCampaigns.sent_at,
      created_at: emailCampaigns.created_at,
    })
    .from(emailCampaigns)
    .where(where)
    .orderBy(desc(emailCampaigns.created_at))
    .limit(limit)
    .offset(offset)
    .all();

  return NextResponse.json({ data: campaigns, total, page, limit });
}

export async function POST(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_CAMPAIGNS);
  if (error) return error;

  let body: { name?: string; subject?: string; html_content?: string; preview_text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, subject, html_content, preview_text } = body;
  if (!name || typeof name !== "string") {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  if (!subject || typeof subject !== "string") {
    return NextResponse.json({ error: "subject is required" }, { status: 400 });
  }
  if (!html_content || typeof html_content !== "string") {
    return NextResponse.json({ error: "html_content is required" }, { status: 400 });
  }

  const id = randomUUID();
  const db = getDb();

  await db.insert(emailCampaigns)
    .values({
      id,
      name,
      subject,
      html_content,
      preview_text: preview_text ?? "",
      status: "draft",
      created_by: session.user.id,
    })
    .run();

  await logAdminAction(session.user.id, "campaign_created", "campaign", id, { name });

  const campaign = await queryFirst(
    db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );

  return NextResponse.json({ data: campaign }, { status: 201 });
}
