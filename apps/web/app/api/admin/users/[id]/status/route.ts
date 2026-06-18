import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getDb } from "@/lib/db";
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

  const db = getDb();

  const existingUser = await queryFirst(db.select({ id: user.id }).from(user).where(eq(user.id, id)));
  if (!existingUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  await db.update(user).set({ disabled: body.disabled ? 1 : 0 }).where(eq(user.id, id));

  const adminId = session.user.id;
  await logAdminAction(adminId, body.disabled ? "user_disabled" : "user_enabled", "user", id);

  return NextResponse.json({ data: { success: true, disabled: body.disabled } });
}
