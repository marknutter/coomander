import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";
import { isPg } from "@/lib/db-dialect";

export async function GET(req: NextRequest) {
  const { session, error } = await requirePermission(req, PERMISSIONS.ADMIN_USERS);
  if (error) return error;
  void session;

  const adapter = getRawAdapter();
  const { searchParams } = new URL(req.url);

  const search = searchParams.get("search") ?? "";
  const plan = searchParams.get("plan") ?? "";
  const status = searchParams.get("status") ?? "";
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));
  const offset = page * limit;

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  const q = (col: string) => isPg() ? `"${col}"` : col;
  const now = isPg() ? "now()::text" : "datetime('now')";

  if (search) {
    conditions.push("LOWER(u.email) LIKE ?");
    const term = `%${search.toLowerCase()}%`;
    params.push(term);
  }

  if (plan && plan !== "all") {
    if (plan === "override") {
      conditions.push(`po.plan IS NOT NULL AND (po.expires_at IS NULL OR po.expires_at > ${now})`);
    } else {
      conditions.push(`(COALESCE(CASE WHEN po.expires_at IS NULL OR po.expires_at > ${now} THEN po.plan END, u.plan)) = ?`);
      params.push(plan);
    }
  }

  if (status === "disabled") {
    conditions.push("u.disabled = 1");
  } else if (status === "active") {
    conditions.push("(u.disabled IS NULL OR u.disabled = 0)");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const userTable = isPg() ? '"user"' : "user";

  const countRow = await adapter.queryFirst<{ total: number }>(
    `SELECT COUNT(*) as total
     FROM ${userTable} u
     LEFT JOIN plan_overrides po ON po.user_id = u.id
     ${where}`,
    ...params
  );

  const users = await adapter.queryAll<{
    id: string;
    email: string;
    name: string | null;
    plan: string;
    createdAt: number;
    isAdmin: number;
    subscriptionStatus: string;
    disabled: number | null;
    override_plan: string | null;
    override_expires_at: string | null;
  }>(
    `SELECT
       u.id,
       u.email,
       u.name,
       u.plan,
       u.${q("createdAt")} AS "createdAt",
       u.${q("isAdmin")} AS "isAdmin",
       u.${q("subscriptionStatus")} AS "subscriptionStatus",
       u.disabled,
       po.plan AS override_plan,
       po.expires_at AS override_expires_at
     FROM ${userTable} u
     LEFT JOIN plan_overrides po ON po.user_id = u.id
     ${where}
     ORDER BY u.${q("createdAt")} DESC
     LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );

  const data = users.map((u) => {
    const hasActiveOverride =
      u.override_plan != null &&
      (u.override_expires_at == null || new Date(u.override_expires_at) > new Date());
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      plan: u.plan,
      effectivePlan: hasActiveOverride ? u.override_plan : u.plan,
      hasOverride: hasActiveOverride,
      createdAt: u.createdAt,
      isAdmin: u.isAdmin === 1,
      subscriptionStatus: u.subscriptionStatus,
      disabled: u.disabled === 1,
    };
  });

  return NextResponse.json({
    data,
    total: countRow?.total ?? 0,
    page,
    limit,
    pages: Math.ceil((countRow?.total ?? 0) / limit),
  });
}
