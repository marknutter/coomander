/**
 * /api/coomander/drops — append-only drop log (#152).
 * GET (list, optional ?beatId=&limit=), POST (create). No PATCH/DELETE in V1.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { logDrop, listDrops, type DropKind } from "@/lib/coomander/drops";
import type { Platform } from "@/lib/coomander/beats";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS: DropKind[] = ["shipped", "purchased", "completed", "captured"];
const PLATFORMS: Platform[] = ["ig", "tiktok", "fb", "snap", "of"];

async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();
  return session.user.id;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUser(request);
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    return NextResponse.json({
      drops: await listDrops(userId, {
        beatId: url.searchParams.get("beatId") ?? undefined,
        limit: limit ? parseInt(limit, 10) : undefined,
      }),
    });
  } catch (error) {
    log.error("GET /api/coomander/drops failed", { error });
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUser(request);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof b.beatId !== "string") throw new BadRequestError("beatId is required");
    if (!KINDS.includes(b.kind as DropKind)) throw new BadRequestError(`kind must be one of: ${KINDS.join(", ")}`);
    if (b.platform != null && !PLATFORMS.includes(b.platform as Platform)) throw new BadRequestError("invalid platform");
    const drop = await logDrop(userId, {
      beatId: b.beatId,
      kind: b.kind as DropKind,
      source: "manual_ui",
      platform: (b.platform as Platform | null | undefined) ?? null,
      contentStateId: typeof b.contentStateId === "string" ? b.contentStateId : null,
      payload: typeof b.payload === "object" && b.payload ? (b.payload as Record<string, unknown>) : undefined,
    });
    return NextResponse.json({ drop }, { status: 201 });
  } catch (error) {
    log.error("POST /api/coomander/drops failed", { error });
    return errorResponse(error);
  }
}
