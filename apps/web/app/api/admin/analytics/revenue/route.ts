import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";
import { isPg } from "@/lib/db-dialect";

const PRO_PRICE = 9.99;

export async function GET(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_ANALYTICS);
  if (error) return error;

  const adapter = getRawAdapter();

  // Single pass: compute effective plan for each user and group by it
  const planQuery = isPg()
    ? `SELECT
         CASE
           WHEN po.plan IS NOT NULL THEN po.plan
           ELSE COALESCE(u.plan, 'free')
         END AS effective_plan,
         COUNT(*) AS cnt
       FROM "user" u
       LEFT JOIN plan_overrides po
         ON po.user_id = u.id
         AND (po.expires_at IS NULL OR po.expires_at > now()::text)
       GROUP BY effective_plan`
    : `SELECT
         CASE
           WHEN po.plan IS NOT NULL THEN po.plan
           ELSE COALESCE(u.plan, 'free')
         END AS effective_plan,
         COUNT(*) AS cnt
       FROM user u
       LEFT JOIN plan_overrides po
         ON po.user_id = u.id
         AND (po.expires_at IS NULL OR po.expires_at > datetime('now'))
       GROUP BY effective_plan`;
  const planCounts = await adapter.queryAll<{ effective_plan: string; cnt: number }>(planQuery);

  const proCount = planCounts.find((r) => r.effective_plan === "pro")?.cnt ?? 0;
  const freeCount = planCounts.find((r) => r.effective_plan === "free")?.cnt ?? 0;

  const mrr = proCount * PRO_PRICE;

  // Users who became pro in last 30 days via plan_overrides
  const upgradesQuery = isPg()
    ? `SELECT u.id, u.email, po.created_at AS upgraded_at, 'override' AS source
       FROM plan_overrides po
       JOIN "user" u ON u.id = po.user_id
       WHERE po.plan = 'pro'
         AND po.created_at >= (current_date - interval '30 days')::text
       ORDER BY po.created_at DESC`
    : `SELECT u.id, u.email, po.created_at AS upgraded_at, 'override' AS source
       FROM plan_overrides po
       JOIN user u ON u.id = po.user_id
       WHERE po.plan = 'pro'
         AND po.created_at >= date('now', '-30 days')
       ORDER BY po.created_at DESC`;
  const recentUpgradesFromOverrides = await adapter.queryAll<{
    id: string; email: string; upgraded_at: string; source: string;
  }>(upgradesQuery);

  return NextResponse.json({
    data: {
      mrr,
      proPrice: PRO_PRICE,
      planBreakdown: {
        free: freeCount,
        pro: proCount,
      },
      recentUpgrades: recentUpgradesFromOverrides,
    },
  });
}
