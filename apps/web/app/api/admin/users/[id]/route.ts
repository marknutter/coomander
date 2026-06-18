import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getEffectivePlan } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { user, planOverrides } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_USERS);
  if (error) return error;
  void session;

  const { id } = await params;

  if (!id) {
    return NextResponse.json({ error: "Invalid user ID" }, { status: 400 });
  }

  const db = getDb();

  const row = await queryFirst(
    db
      .select({
        id: user.id,
        email: user.email,
        name: user.name,
        plan: user.plan,
        createdAt: user.createdAt,
        isAdmin: user.isAdmin,
        subscriptionStatus: user.subscriptionStatus,
        stripeCustomerId: user.stripeCustomerId,
        stripeSubscriptionId: user.stripeSubscriptionId,
        emailVerified: user.emailVerified,
        disabled: user.disabled,
        override_plan: planOverrides.plan,
        override_reason: planOverrides.reason,
        override_expires_at: planOverrides.expires_at,
        override_created_at: planOverrides.created_at,
        override_granted_by: planOverrides.granted_by,
      })
      .from(user)
      .leftJoin(planOverrides, eq(planOverrides.user_id, user.id))
      .where(eq(user.id, id))
  );

  if (!row) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const effective = await getEffectivePlan(id);

  return NextResponse.json({
    data: {
      id: row.id,
      email: row.email,
      name: row.name,
      plan: row.plan,
      effectivePlan: effective.plan,
      createdAt: row.createdAt,
      isAdmin: row.isAdmin === 1,
      subscriptionStatus: row.subscriptionStatus,
      stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      emailVerified: row.emailVerified === 1,
      disabled: row.disabled === 1,
      planOverride: row.override_plan
        ? {
            plan: row.override_plan,
            reason: row.override_reason,
            expiresAt: row.override_expires_at,
            createdAt: row.override_created_at,
            grantedBy: row.override_granted_by,
            active: effective.override,
          }
        : null,
    },
  });
}
