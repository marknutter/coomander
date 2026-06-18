import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";
import { isPg } from "@/lib/db-dialect";

export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_ANALYTICS);
  if (error) return error;

  const adapter = getRawAdapter();

  // Users with at least 1 item
  const usersWithItems = (await adapter.queryFirst<{ cnt: number }>(
    "SELECT COUNT(DISTINCT user_id) AS cnt FROM items"
  ))?.cnt ?? 0;

  // Total items
  const totalItems = (await adapter.queryFirst<{ cnt: number }>(
    "SELECT COUNT(*) AS cnt FROM items"
  ))?.cnt ?? 0;

  const avgItemsPerUser = usersWithItems > 0 ? totalItems / usersWithItems : 0;

  // Total users
  const totalUsers = (await adapter.queryFirst<{ cnt: number }>(
    `SELECT COUNT(*) AS cnt FROM "user"`
  ))?.cnt ?? 0;

  // Items created by day — last 30 days
  const itemsByDayQuery = isPg()
    ? `SELECT
         date(created_at) AS day,
         COUNT(*) AS count
       FROM items
       WHERE created_at >= (current_date - interval '30 days')::text
       GROUP BY day
       ORDER BY day ASC`
    : `SELECT
         date(created_at) AS day,
         COUNT(*) AS count
       FROM items
       WHERE created_at >= date('now', '-30 days')
       GROUP BY day
       ORDER BY day ASC`;
  const itemsByDay = await adapter.queryAll<{ day: string; count: number }>(itemsByDayQuery);

  // Top 10 item names by frequency
  const topItemNames = await adapter.queryAll<{ name: string; count: number }>(
    `SELECT name, COUNT(*) AS count
     FROM items
     GROUP BY name
     ORDER BY count DESC
     LIMIT 10`
  );

  // Items per user distribution
  const itemCountDistribution = await adapter.queryAll<{ bucket: string; users: number }>(
    `SELECT
       CASE
         WHEN item_count = 1 THEN '1'
         WHEN item_count BETWEEN 2 AND 5 THEN '2-5'
         WHEN item_count BETWEEN 6 AND 10 THEN '6-10'
         ELSE '10+'
       END AS bucket,
       COUNT(*) AS users
     FROM (
       SELECT user_id, COUNT(*) AS item_count
       FROM items
       GROUP BY user_id
     ) sub
     GROUP BY bucket
     ORDER BY MIN(item_count) ASC`
  );

  return NextResponse.json({
    data: {
      avgItemsPerUser,
      usersWithItems,
      totalItems,
      totalUsers,
      itemsByDay,
      topItemNames,
      itemCountDistribution,
    },
  });
}
