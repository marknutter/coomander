import { NextRequest, NextResponse } from "next/server";
import { eq, count, sql } from "drizzle-orm";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailEvents } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_CAMPAIGNS);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  const rows = await db
    .select({
      event_type: emailEvents.event_type,
      count: count(),
    })
    .from(emailEvents)
    .where(eq(emailEvents.campaign_id, id))
    .groupBy(emailEvents.event_type)
    .all();

  const analytics: Record<string, number> = {
    delivered: 0,
    opened: 0,
    clicked: 0,
    bounced: 0,
    complained: 0,
  };

  for (const row of rows) {
    if (row.event_type in analytics) {
      analytics[row.event_type] = row.count;
    }
  }

  return NextResponse.json({ data: analytics });
}
