import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";
import { isPg } from "@/lib/db-dialect";

export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_ANALYTICS);
  if (error) return error;

  const adapter = getRawAdapter();

  // Signups by day — last 30 days
  const signupsByDayQuery = isPg()
    ? `SELECT
         to_char(to_timestamp("createdAt" / 1000), 'YYYY-MM-DD') AS day,
         COUNT(*) AS count
       FROM "user"
       WHERE "createdAt" >= extract(epoch from now() - interval '30 days')::bigint * 1000
       GROUP BY day
       ORDER BY day ASC`
    : `SELECT
         date(createdAt / 1000, 'unixepoch') AS day,
         COUNT(*) AS count
       FROM user
       WHERE createdAt >= (unixepoch('now', '-30 days') * 1000)
       GROUP BY day
       ORDER BY day ASC`;
  const signupsByDay = await adapter.queryAll<{ day: string; count: number }>(signupsByDayQuery);

  // DAU — distinct users who created items today
  const dauQuery = isPg()
    ? `SELECT COUNT(DISTINCT user_id) AS cnt
       FROM items
       WHERE date(created_at) = current_date::text`
    : `SELECT COUNT(DISTINCT user_id) AS cnt
       FROM items
       WHERE date(created_at) = date('now')`;
  const dau = (await adapter.queryFirst<{ cnt: number }>(dauQuery))?.cnt ?? 0;

  // WAU — distinct users who created items in last 7 days
  const wauQuery = isPg()
    ? `SELECT COUNT(DISTINCT user_id) AS cnt
       FROM items
       WHERE created_at >= (current_date - interval '7 days')::text`
    : `SELECT COUNT(DISTINCT user_id) AS cnt
       FROM items
       WHERE created_at >= date('now', '-7 days')`;
  const wau = (await adapter.queryFirst<{ cnt: number }>(wauQuery))?.cnt ?? 0;

  // MAU — distinct users who created items in last 30 days
  const mauQuery = isPg()
    ? `SELECT COUNT(DISTINCT user_id) AS cnt
       FROM items
       WHERE created_at >= (current_date - interval '30 days')::text`
    : `SELECT COUNT(DISTINCT user_id) AS cnt
       FROM items
       WHERE created_at >= date('now', '-30 days')`;
  const mau = (await adapter.queryFirst<{ cnt: number }>(mauQuery))?.cnt ?? 0;

  // Total users
  const totalUsers = (await adapter.queryFirst<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM "user"`
  ))?.cnt ?? 0;

  // Pro users
  const proQuery = isPg()
    ? `SELECT COUNT(DISTINCT u.id) AS cnt
       FROM "user" u
       LEFT JOIN plan_overrides po
         ON po.user_id = u.id
         AND (po.expires_at IS NULL OR po.expires_at > now()::text)
       WHERE
         (po.plan = 'pro') OR
         (po.plan IS NULL AND u.plan = 'pro')`
    : `SELECT COUNT(DISTINCT u.id) AS cnt
       FROM user u
       LEFT JOIN plan_overrides po
         ON po.user_id = u.id
         AND (po.expires_at IS NULL OR po.expires_at > datetime('now'))
       WHERE
         (po.plan = 'pro') OR
         (po.plan IS NULL AND u.plan = 'pro')`;
  const proUsers = (await adapter.queryFirst<{ cnt: number }>(proQuery))?.cnt ?? 0;

  const conversionRate = totalUsers > 0 ? proUsers / totalUsers : 0;

  return NextResponse.json({
    data: {
      signupsByDay,
      dau,
      wau,
      mau,
      conversionRate,
      totalUsers,
      proUsers,
    },
  });
}
