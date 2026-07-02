import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Schedule (or reschedule) a one-off campaign send (#597/#222). Allowed from
 * `draft` (schedule) or `scheduled` (reschedule). Stores status="scheduled"
 * and a normalized ISO-8601 UTC `scheduled_at` — the
 * dispatch-scheduled-campaigns job (jobs/index.ts) scans for due ones
 * (scheduled_at <= now) and dispatches them.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_CAMPAIGNS);
  if (error) return error;

  const { id } = await params;
  const db = getDb();

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.scheduled_at;
  if (typeof raw !== "string" || !raw.trim()) {
    return NextResponse.json({ error: "scheduled_at is required" }, { status: 400 });
  }
  const when = new Date(raw);
  if (Number.isNaN(when.getTime())) {
    return NextResponse.json({ error: "scheduled_at is not a valid date" }, { status: 400 });
  }
  if (when.getTime() <= Date.now()) {
    return NextResponse.json({ error: "scheduled_at must be in the future" }, { status: 400 });
  }

  const campaign = await queryFirst(
    db.select({ status: emailCampaigns.status }).from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  if (campaign.status !== "draft" && campaign.status !== "scheduled") {
    return NextResponse.json(
      { error: "Only draft or scheduled campaigns can be scheduled" },
      { status: 400 },
    );
  }

  const scheduledIso = when.toISOString();
  // Atomic guard: only transition from draft/scheduled. Prevents a schedule/reschedule
  // from racing the dispatch job (which claims scheduled→sending) and resurrecting an
  // already-dispatching campaign back to "scheduled".
  const changes = await executeChanges(
    db.update(emailCampaigns)
      .set({ status: "scheduled", scheduled_at: scheduledIso, updated_at: new Date().toISOString() })
      .where(and(eq(emailCampaigns.id, id), inArray(emailCampaigns.status, ["draft", "scheduled"])))
  );
  if (changes === 0) {
    return NextResponse.json({ error: "Campaign is no longer draft or scheduled" }, { status: 409 });
  }

  await logAdminAction(session.user.id, "campaign_scheduled", "campaign", id, { scheduled_at: scheduledIso });

  const updated = await queryFirst(
    db.select().from(emailCampaigns).where(eq(emailCampaigns.id, id))
  );
  return NextResponse.json({ data: updated });
}
