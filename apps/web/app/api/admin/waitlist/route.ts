import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_WAITLIST);
  if (error) return error;
  void session;

  const adapter = getRawAdapter();
  const { searchParams } = new URL(req.url);

  const search = searchParams.get("search") ?? "";
  const statusFilter = searchParams.get("status") ?? "";
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const offset = page * limit;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (search) {
    conditions.push("LOWER(w.email) LIKE ?");
    params.push(`%${search.toLowerCase()}%`);
  }

  if (statusFilter && statusFilter !== "all") {
    conditions.push("w.status = ?");
    params.push(statusFilter);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Stats
  const stats = await adapter.queryFirst<{ total: number; waiting: number; invited: number; registered: number }>(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) as waiting,
      SUM(CASE WHEN status = 'invited' THEN 1 ELSE 0 END) as invited,
      SUM(CASE WHEN status = 'registered' THEN 1 ELSE 0 END) as registered
    FROM waitlist
  `);

  // Count for pagination
  const countRow = await adapter.queryFirst<{ total: number }>(
    `SELECT COUNT(*) as total FROM waitlist w ${where}`,
    ...params
  );

  // Paginated results
  const entries = await adapter.queryAll(
    `SELECT
       w.id,
       w.email,
       w.referral_code,
       w.referred_by,
       w.referral_count,
       w.status,
       w.created_at,
       w.invited_at
     FROM waitlist w
     ${where}
     ORDER BY w.created_at ASC
     LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );

  return NextResponse.json({
    data: entries,
    stats: stats ?? { total: 0, waiting: 0, invited: 0, registered: 0 },
    total: countRow?.total ?? 0,
    page,
    limit,
    pages: Math.ceil((countRow?.total ?? 0) / limit),
  });
}
