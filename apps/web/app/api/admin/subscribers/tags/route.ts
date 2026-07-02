import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { listTagsWithCounts } from "@/lib/audiences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Distinct tags across active subscribers with member counts (#596/#222) —
 * powers the subscribers admin and the campaign audience picker.
 */
export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_CRM);
  if (error) return error;

  const tags = await listTagsWithCounts();
  return NextResponse.json({ data: tags });
}
