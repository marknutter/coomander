import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";
import { isPg } from "@/lib/db-dialect";

export interface AnalyticsData {
  totalUsers: number;
  activeUsers: number;
  planBreakdown: { free: number; pro: number };
  totalItems: number;
  recentActivity: ActivityItem[];
}

export interface ActivityItem {
  type: "signup" | "admin_action";
  description: string;
  timestamp: string;
}

export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_ANALYTICS);
  if (error) return error;

  const adapter = getRawAdapter();

  // Total users
  const totalUsersRow = await adapter.queryFirst<{ totalUsers: number }>(
    "SELECT COUNT(*) AS \"totalUsers\" FROM \"user\""
  );
  const totalUsers = totalUsersRow?.totalUsers ?? 0;

  // Active users: users who have items created in the last 30 days
  const activeUsersQuery = isPg()
    ? `SELECT COUNT(DISTINCT user_id) AS "activeUsers"
       FROM items
       WHERE created_at >= (now() - interval '30 days')::text`
    : `SELECT COUNT(DISTINCT user_id) AS activeUsers
       FROM items
       WHERE created_at >= datetime('now', '-30 days')`;
  const activeRow = await adapter.queryFirst<{ activeUsers: number }>(activeUsersQuery);
  const activeUsers = activeRow?.activeUsers ?? 0;

  // Plan breakdown: check plan_overrides for effective plan
  const planQuery = isPg()
    ? `SELECT
         CASE WHEN po.plan IS NOT NULL THEN po.plan ELSE COALESCE(u.plan, 'free') END AS effective_plan,
         COUNT(*) AS cnt
       FROM "user" u
       LEFT JOIN plan_overrides po
         ON po.user_id = u.id
         AND (po.expires_at IS NULL OR po.expires_at > now()::text)
       GROUP BY effective_plan`
    : `SELECT
         CASE WHEN po.plan IS NOT NULL THEN po.plan ELSE COALESCE(u.plan, 'free') END AS effective_plan,
         COUNT(*) AS cnt
       FROM user u
       LEFT JOIN plan_overrides po
         ON po.user_id = u.id
         AND (po.expires_at IS NULL OR po.expires_at > datetime('now'))
       GROUP BY effective_plan`;
  const planRows = await adapter.queryAll<{ effective_plan: string; cnt: number }>(planQuery);

  const planBreakdown = { free: 0, pro: 0 };
  for (const row of planRows) {
    if (row.effective_plan === "pro") {
      planBreakdown.pro += row.cnt;
    } else {
      planBreakdown.free += row.cnt;
    }
  }

  // Total items
  const totalItemsRow = await adapter.queryFirst<{ totalItems: number }>(
    "SELECT COUNT(*) AS \"totalItems\" FROM items"
  );
  const totalItems = totalItemsRow?.totalItems ?? 0;

  // Recent activity: last 20 entries combining signups and admin logs
  const signupsQuery = isPg()
    ? `SELECT email, "createdAt"
       FROM "user"
       WHERE "createdAt" >= extract(epoch from now() - interval '7 days')::bigint * 1000
       ORDER BY "createdAt" DESC
       LIMIT 20`
    : `SELECT email, createdAt
       FROM user
       WHERE createdAt >= unixepoch('now', '-7 days') * 1000
       ORDER BY createdAt DESC
       LIMIT 20`;
  const recentSignups = await adapter.queryAll<{ email: string; createdAt: number }>(signupsQuery);

  const adminActionsQuery = isPg()
    ? `SELECT al.action, al.target_type, al.target_id, al.created_at, u.email AS admin_email
       FROM admin_logs al
       LEFT JOIN "user" u ON u.id = al.admin_id
       ORDER BY al.created_at DESC
       LIMIT 20`
    : `SELECT al.action, al.target_type, al.target_id, al.created_at, u.email AS admin_email
       FROM admin_logs al
       LEFT JOIN user u ON u.id = al.admin_id
       ORDER BY al.created_at DESC
       LIMIT 20`;
  const recentAdminActions = await adapter.queryAll<{
    action: string;
    target_type: string | null;
    target_id: string | null;
    created_at: string;
    admin_email: string | null;
  }>(adminActionsQuery);

  // Combine and sort by timestamp
  const activityItems: ActivityItem[] = [
    ...recentSignups.map((row) => ({
      type: "signup" as const,
      description: `New user signed up: ${row.email}`,
      timestamp: new Date(row.createdAt).toISOString(),
    })),
    ...recentAdminActions.map((row) => ({
      type: "admin_action" as const,
      description: `${row.admin_email ?? "Admin"} performed ${row.action}${
        row.target_type ? ` on ${row.target_type}${row.target_id ? ` #${row.target_id}` : ""}` : ""
      }`,
      timestamp: row.created_at,
    })),
  ];

  activityItems.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  const recentActivity = activityItems.slice(0, 20);

  const data: AnalyticsData = {
    totalUsers,
    activeUsers,
    planBreakdown,
    totalItems,
    recentActivity,
  };

  return NextResponse.json({ data });
}
