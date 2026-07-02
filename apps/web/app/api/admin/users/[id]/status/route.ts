export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
import { auth } from "@/lib/auth";
import { user } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";

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

  let body: { disabled: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.disabled !== "boolean") {
    return NextResponse.json({ error: "disabled (boolean) is required" }, { status: 400 });
  }

  const existingUser = await queryFirst(getDb().select({ id: user.id }).from(user).where(eq(user.id, id)));
  if (!existingUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Route the disable/enable action through Better Auth's admin-plugin ban API.
  // Better Auth ENFORCES `banned` natively — it blocks future sign-ins AND
  // revokes the target's existing sessions (deleteUserSessions) — whereas the
  // legacy `disabled` column was never read anywhere. Passing the request
  // headers lets Better Auth resolve the calling admin's session for its own
  // admin middleware. banUser self-protects (throws YOU_CANNOT_BAN_YOURSELF).
  try {
    if (body.disabled) {
      await auth.api.banUser({
        body: { userId: id },
        headers: req.headers,
      });
    } else {
      await auth.api.unbanUser({
        body: { userId: id },
        headers: req.headers,
      });
    }
  } catch (err) {
    if (err instanceof APIError) {
      const status = typeof err.statusCode === "number" ? err.statusCode : 400;
      return NextResponse.json(
        { error: err.body?.message ?? err.message ?? "Failed to update user status" },
        { status }
      );
    }
    console.error("[admin] Failed to update user status:", err);
    return NextResponse.json({ error: "Failed to update user status" }, { status: 500 });
  }

  const adminId = session.user.id;
  await logAdminAction(adminId, body.disabled ? "user_disabled" : "user_enabled", "user", id);

  return NextResponse.json({ data: { success: true, disabled: body.disabled } });
}
