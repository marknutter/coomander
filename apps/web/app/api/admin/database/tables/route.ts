import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";

export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_DATABASE);
  if (error) return error;

  const adapter = getRawAdapter();
  const result = await adapter.listTables();

  return NextResponse.json({ data: result });
}
