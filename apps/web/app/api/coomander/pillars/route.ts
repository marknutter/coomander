/**
 * /api/coomander/pillars — cadence pillar CRUD (#152).
 * GET (list), POST (create), PATCH (update by body.id), DELETE (?id=).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createPillar, listPillars, updatePillar, deletePillar, type PillarKind } from "@/lib/coomander/pillars";
import { UnauthorizedError, BadRequestError, NotFoundError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const KINDS: PillarKind[] = ["content", "wall", "procurement", "engagement", "admin"];

async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();
  return session.user.id;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUser(request);
    const includeArchived = new URL(request.url).searchParams.get("archived") === "1";
    return NextResponse.json({ pillars: await listPillars(userId, includeArchived) });
  } catch (error) {
    log.error("GET /api/coomander/pillars failed", { error });
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.name !== "string" || !body.name.trim()) throw new BadRequestError("name is required");
    if (!KINDS.includes(body.kind as PillarKind)) throw new BadRequestError(`kind must be one of: ${KINDS.join(", ")}`);
    const pillar = await createPillar(userId, {
      name: body.name.trim(),
      kind: body.kind as PillarKind,
      displayOrder: typeof body.displayOrder === "number" ? body.displayOrder : undefined,
    });
    return NextResponse.json({ pillar }, { status: 201 });
  } catch (error) {
    log.error("POST /api/coomander/pillars failed", { error });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUser(request);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof body.id !== "string") throw new BadRequestError("id is required");
    if (body.kind !== undefined && !KINDS.includes(body.kind as PillarKind)) throw new BadRequestError("invalid kind");
    const pillar = await updatePillar(userId, body.id, {
      name: typeof body.name === "string" ? body.name : undefined,
      kind: body.kind as PillarKind | undefined,
      displayOrder: typeof body.displayOrder === "number" ? body.displayOrder : undefined,
      archived: typeof body.archived === "boolean" ? body.archived : undefined,
    });
    if (!pillar) throw new NotFoundError("pillar not found");
    return NextResponse.json({ pillar });
  } catch (error) {
    log.error("PATCH /api/coomander/pillars failed", { error });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUser(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new BadRequestError("id query param is required");
    await deletePillar(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("DELETE /api/coomander/pillars failed", { error });
    return errorResponse(error);
  }
}
