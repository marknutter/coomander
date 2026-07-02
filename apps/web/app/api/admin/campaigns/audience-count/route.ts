import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { parseAudienceFilter, countAudience, describeAudience } from "@/lib/audiences";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Resolve an audience filter to a live recipient count (#596/#222) so the
 * authoring UI can show "this campaign will send to N subscribers" before
 * sending. Accepts `audience_filter` as either a JSON object or a JSON string.
 */
export async function POST(req: NextRequest) {
  const { error } = await requirePermission(req, PERMISSIONS.ADMIN_CAMPAIGNS);
  if (error) return error;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.audience_filter;
  const asString =
    typeof raw === "string" ? raw : raw == null ? null : JSON.stringify(raw);
  const filter = parseAudienceFilter(asString);

  const count = await countAudience(filter);
  return NextResponse.json({
    data: { count, description: describeAudience(filter), filter },
  });
}
