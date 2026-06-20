import { NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getAiUsage, isAiUsageWindow, type AiUsageWindow } from "@/lib/ai-usage";
import { errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/admin/ai-usage (admin-only — ADMIN_ANALYTICS permission).
 *
 * Returns AI Gateway usage/cost from the Cloudflare GraphQL Analytics API:
 * per-model rows, a time series, and account-wide totals.
 *
 * Query params:
 *   - `window` = "24h" | "7d"  (default "24h")
 *   - `userId` = optional — scope the report to one user via the
 *     `cf-aig-metadata` userId tag (per-user attribution).
 *
 * When the analytics creds aren't configured, returns
 * `{ data: { configured: false, missing: [...] } }` (HTTP 200) so the
 * dashboard renders a friendly empty-state instead of an error.
 */
export async function GET(request: Request) {
  try {
    const { error } = await requirePermission(request, PERMISSIONS.ADMIN_ANALYTICS);
    if (error) return error;

    const url = new URL(request.url);
    const windowParam = url.searchParams.get("window");
    const window: AiUsageWindow = isAiUsageWindow(windowParam) ? windowParam : "24h";

    // Empty string → treat as "no filter" (account-wide).
    const userIdParam = url.searchParams.get("userId");
    const userId = userIdParam && userIdParam.trim() !== "" ? userIdParam.trim() : null;

    const data = await getAiUsage(window, userId);
    return NextResponse.json({ data });
  } catch (error) {
    log.error("GET /api/admin/ai-usage failed", { error });
    return errorResponse(error);
  }
}
