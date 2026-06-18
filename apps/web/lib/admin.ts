import { NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { user, planOverrides, adminLogs } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";

export interface AdminSession {
  user: { id: string; email: string };
}

export async function isAdmin(userId: string): Promise<boolean> {
  const db = getDb();
  const row = await queryFirst(
    db
      .select({ isAdmin: user.isAdmin })
      .from(user)
      .where(eq(user.id, userId))
  );
  return row?.isAdmin === 1;
}

export async function requireAdmin(request: Request): Promise<
  | { session: AdminSession; error?: never }
  | { session?: never; error: NextResponse }
> {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user?.id) {
    return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  }
  if (!(await isAdmin(session.user.id))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { session: { user: { id: session.user.id, email: session.user.email } } };
}

export async function logAdminAction(
  adminId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  details?: Record<string, unknown>
): Promise<void> {
  const db = getDb();
  await db.insert(adminLogs).values({
    admin_id: adminId,
    action,
    target_type: targetType ?? null,
    target_id: targetId ?? null,
    details: details ? JSON.stringify(details) : null,
  });
}

export async function getEffectivePlan(userId: string): Promise<{ plan: string; override: boolean; expiresAt: string | null }> {
  const db = getDb();
  const row = await queryFirst(
    db
      .select({
        user_plan: user.plan,
        override_plan: planOverrides.plan,
        expires_at: planOverrides.expires_at,
      })
      .from(user)
      .leftJoin(
        planOverrides,
        sql`${planOverrides.user_id} = ${user.id} AND (${planOverrides.expires_at} IS NULL OR ${planOverrides.expires_at} > datetime('now'))`,
      )
      .where(eq(user.id, userId))
  );

  if (!row) return { plan: "free", override: false, expiresAt: null };
  if (row.override_plan) return { plan: row.override_plan, override: true, expiresAt: row.expires_at };
  return { plan: row.user_plan ?? "free", override: false, expiresAt: null };
}
