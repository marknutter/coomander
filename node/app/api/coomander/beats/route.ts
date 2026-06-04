/**
 * /api/coomander/beats — cadence beat CRUD (#152).
 * Respects platform_specific + subtype. GET (list, optional ?pillarId=),
 * POST (create), PATCH (update by body.id), DELETE (?id=).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createBeat, listBeats, updateBeat, deleteBeat,
  type CadenceKind, type Platform, type BeatPriority,
} from "@/lib/coomander/beats";
import { UnauthorizedError, BadRequestError, NotFoundError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS: CadenceKind[] = ["daily", "weekly", "window", "daily_vlog_buffer"];
const PLATFORMS: Platform[] = ["ig", "tiktok", "fb", "snap", "of"];
const PRIORITIES: BeatPriority[] = ["low", "med", "high"];

async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();
  return session.user.id;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUser(request);
    const url = new URL(request.url);
    return NextResponse.json({
      beats: await listBeats(userId, {
        pillarId: url.searchParams.get("pillarId") ?? undefined,
        includeInactive: url.searchParams.get("inactive") === "1",
      }),
    });
  } catch (error) {
    log.error("GET /api/coomander/beats failed", { error });
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUser(request);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof b.pillarId !== "string") throw new BadRequestError("pillarId is required");
    if (typeof b.name !== "string" || !b.name.trim()) throw new BadRequestError("name is required");
    if (!KINDS.includes(b.cadenceKind as CadenceKind)) throw new BadRequestError(`cadenceKind must be one of: ${KINDS.join(", ")}`);
    if (b.platformSpecific != null && !PLATFORMS.includes(b.platformSpecific as Platform)) throw new BadRequestError("invalid platformSpecific");
    if (b.priority != null && !PRIORITIES.includes(b.priority as BeatPriority)) throw new BadRequestError("invalid priority");
    const beat = await createBeat(userId, {
      pillarId: b.pillarId,
      name: b.name.trim(),
      cadenceKind: b.cadenceKind as CadenceKind,
      targetCount: typeof b.targetCount === "number" ? b.targetCount : undefined,
      bufferGoalDays: typeof b.bufferGoalDays === "number" ? b.bufferGoalDays : (b.bufferGoalDays === null ? null : undefined),
      windowStart: typeof b.windowStart === "string" ? b.windowStart : undefined,
      windowEnd: typeof b.windowEnd === "string" ? b.windowEnd : undefined,
      priority: b.priority as BeatPriority | undefined,
      platformSpecific: (b.platformSpecific as Platform | null | undefined),
      subtype: typeof b.subtype === "string" ? b.subtype : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    });
    return NextResponse.json({ beat }, { status: 201 });
  } catch (error) {
    log.error("POST /api/coomander/beats failed", { error });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUser(request);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof b.id !== "string") throw new BadRequestError("id is required");
    if (b.cadenceKind !== undefined && !KINDS.includes(b.cadenceKind as CadenceKind)) throw new BadRequestError("invalid cadenceKind");
    if (b.platformSpecific != null && b.platformSpecific !== undefined && !PLATFORMS.includes(b.platformSpecific as Platform)) throw new BadRequestError("invalid platformSpecific");
    if (b.priority != null && b.priority !== undefined && !PRIORITIES.includes(b.priority as BeatPriority)) throw new BadRequestError("invalid priority");
    const beat = await updateBeat(userId, b.id, {
      name: typeof b.name === "string" ? b.name : undefined,
      cadenceKind: b.cadenceKind as CadenceKind | undefined,
      targetCount: typeof b.targetCount === "number" ? b.targetCount : undefined,
      bufferGoalDays: b.bufferGoalDays === undefined ? undefined : (typeof b.bufferGoalDays === "number" ? b.bufferGoalDays : null),
      windowStart: b.windowStart === undefined ? undefined : (typeof b.windowStart === "string" ? b.windowStart : null),
      windowEnd: b.windowEnd === undefined ? undefined : (typeof b.windowEnd === "string" ? b.windowEnd : null),
      priority: b.priority as BeatPriority | undefined,
      platformSpecific: b.platformSpecific === undefined ? undefined : (b.platformSpecific as Platform | null),
      subtype: b.subtype === undefined ? undefined : (typeof b.subtype === "string" ? b.subtype : null),
      notes: b.notes === undefined ? undefined : (typeof b.notes === "string" ? b.notes : null),
      active: typeof b.active === "boolean" ? b.active : undefined,
      archived: typeof b.archived === "boolean" ? b.archived : undefined,
    });
    if (!beat) throw new NotFoundError("beat not found");
    return NextResponse.json({ beat });
  } catch (error) {
    log.error("PATCH /api/coomander/beats failed", { error });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUser(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new BadRequestError("id query param is required");
    await deleteBeat(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("DELETE /api/coomander/beats failed", { error });
    return errorResponse(error);
  }
}
