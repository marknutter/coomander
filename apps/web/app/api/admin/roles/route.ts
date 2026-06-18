export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { listRoles, createRole } from "@/lib/rbac";
import { logAdminAction } from "@/lib/admin";
import { errorResponse, BadRequestError } from "@/lib/errors";
import { PERMISSIONS } from "@/lib/permissions";

export async function GET(request: Request) {
  try {
    const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_ROLES);
    if (error) return error;
    void session;

    const data = await listRoles();
    return NextResponse.json({ data });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(request: Request) {
  try {
    const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_ROLES);
    if (error) return error;

    const body = await request.json();
    const { name, description, permissions } = body;

    if (!name || typeof name !== "string") {
      throw new BadRequestError("Name is required");
    }
    if (!Array.isArray(permissions)) {
      throw new BadRequestError("Permissions must be an array");
    }

    const role = await createRole({ name, description, permissions });

    await logAdminAction(session.user.id, "role.create", "role", role.id, { name });

    return NextResponse.json({ data: role }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
