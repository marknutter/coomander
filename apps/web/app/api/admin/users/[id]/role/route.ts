export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { assignRole, removeRole, getUserRoles } from "@/lib/rbac";
import { logAdminAction } from "@/lib/admin";
import { errorResponse, BadRequestError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_USERS);
    if (error) return error;
    void session;

    const { id } = await context.params;
    const data = await getUserRoles(id);

    return NextResponse.json({ data });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_ROLES);
    if (error) return error;

    const { id: userId } = await context.params;
    const body = await request.json();
    const { roleId } = body;

    if (!roleId || typeof roleId !== "string") {
      throw new BadRequestError("roleId is required");
    }

    await assignRole(userId, roleId, session.user.id);

    await logAdminAction(session.user.id, "role.assign", "user", userId, { roleId });

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_ROLES);
    if (error) return error;

    const { id: userId } = await context.params;
    const { searchParams } = new URL(request.url);
    const roleId = searchParams.get("roleId");

    if (!roleId) {
      throw new BadRequestError("roleId query parameter is required");
    }

    await removeRole(userId, roleId);

    await logAdminAction(session.user.id, "role.remove", "user", userId, { roleId });

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
