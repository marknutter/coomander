import { NextRequest, NextResponse } from "next/server";
import { eq, desc, count } from "drizzle-orm";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailEvents } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ email: string }> }
) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  const { email } = await params;
  const decodedEmail = decodeURIComponent(email);

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") ?? "1"));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") ?? "50")));
  const offset = (page - 1) * limit;

  const db = getDb();
  const where = eq(emailEvents.subscriber_email, decodedEmail);

  const totalRow = await queryFirst(
    db.select({ count: count() }).from(emailEvents).where(where)
  );
  const total = totalRow?.count ?? 0;

  const events = await db
    .select({
      id: emailEvents.id,
      email_id: emailEvents.email_id,
      campaign_id: emailEvents.campaign_id,
      event_type: emailEvents.event_type,
      link_url: emailEvents.link_url,
      created_at: emailEvents.created_at,
    })
    .from(emailEvents)
    .where(where)
    .orderBy(desc(emailEvents.created_at))
    .limit(limit)
    .offset(offset)
    .all();

  return NextResponse.json({ data: events, total, page, limit });
}
