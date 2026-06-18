import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { getRawAdapter } from "@/lib/db-raw";
import { isPg } from "@/lib/db-dialect";
import { user, planOverrides } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_USERS);
  if (error) return error;

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  let body: { plan: string; reason: string; expiresAt?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { plan, reason, expiresAt } = body;

  if (!plan || typeof plan !== "string") {
    return NextResponse.json({ error: "plan is required" }, { status: 400 });
  }
  if (!reason || typeof reason !== "string") {
    return NextResponse.json({ error: "reason is required" }, { status: 400 });
  }

  const db = getDb();

  const existingUser = await queryFirst(db.select({ id: user.id }).from(user).where(eq(user.id, id)));
  if (!existingUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const adminId = session.user.id;

  // ON CONFLICT upsert via raw adapter
  const now = isPg() ? "now()::text" : "CURRENT_TIMESTAMP";
  await getRawAdapter().run(
    `INSERT INTO plan_overrides (user_id, plan, reason, granted_by, expires_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       plan = excluded.plan,
       reason = excluded.reason,
       granted_by = excluded.granted_by,
       expires_at = excluded.expires_at,
       created_at = ${now}`,
    id, plan, reason, adminId, expiresAt ?? null
  );

  await logAdminAction(adminId, "plan_override", "user", id, { plan, reason, expiresAt });

  return NextResponse.json({ data: { success: true, plan, reason, expiresAt } });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_USERS);
  if (error) return error;

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const changes = await executeChanges(
    getDb()
      .delete(planOverrides)
      .where(eq(planOverrides.user_id, id))
  );

  if (changes === 0) {
    return NextResponse.json({ error: "No override found for this user" }, { status: 404 });
  }

  const adminId = session.user.id;
  await logAdminAction(adminId, "plan_override_removed", "user", id);

  return NextResponse.json({ data: { success: true } });
}
