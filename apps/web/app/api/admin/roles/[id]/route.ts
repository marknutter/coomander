export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { getRole, updateRole, deleteRole } from "@/lib/rbac";
import { logAdminAction } from "@/lib/admin";
import { errorResponse, NotFoundError, BadRequestError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_ROLES);
    if (error) return error;
    void session;

    const { id } = await context.params;
    const role = await getRole(id);
    if (!role) throw new NotFoundError("Role not found");

    return NextResponse.json({ data: role });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_ROLES);
    if (error) return error;

    const { id } = await context.params;
    const body = await request.json();
    const { name, description, permissions } = body;

    if (permissions !== undefined && !Array.isArray(permissions)) {
      throw new BadRequestError("Permissions must be an array");
    }

    const role = await updateRole(id, { name, description, permissions });

    await logAdminAction(session.user.id, "role.update", "role", id, { name });

    return NextResponse.json({ data: role });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_ROLES);
    if (error) return error;

    const { id } = await context.params;
    await deleteRole(id);

    await logAdminAction(session.user.id, "role.delete", "role", id);

    return NextResponse.json({ success: true });
  } catch (err) {
    return errorResponse(err);
  }
}
