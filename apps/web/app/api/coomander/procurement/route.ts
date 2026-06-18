/**
 * /api/coomander/procurement — procurement CRUD (#152).
 * GET (list, optional ?category=), POST (create), PATCH (update by body.id),
 * DELETE (?id=). Respects the shoot_prep | business_admin split.
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createProcurement, listProcurement, updateProcurement, deleteProcurement,
  type ProcurementCategory, type ProcurementStatus,
} from "@/lib/coomander/procurement";
import { UnauthorizedError, BadRequestError, NotFoundError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CATEGORIES: ProcurementCategory[] = ["shoot_prep", "business_admin"];
const STATUSES: ProcurementStatus[] = ["needed", "ordered", "received", "canceled"];

async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();
  return session.user.id;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUser(request);
    const cat = new URL(request.url).searchParams.get("category");
    if (cat && !CATEGORIES.includes(cat as ProcurementCategory)) throw new BadRequestError("invalid category");
    return NextResponse.json({ items: await listProcurement(userId, (cat as ProcurementCategory) || undefined) });
  } catch (error) {
    log.error("GET /api/coomander/procurement failed", { error });
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUser(request);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (!CATEGORIES.includes(b.category as ProcurementCategory)) throw new BadRequestError(`category must be one of: ${CATEGORIES.join(", ")}`);
    if (typeof b.label !== "string" || !b.label.trim()) throw new BadRequestError("label is required");
    if (b.status != null && !STATUSES.includes(b.status as ProcurementStatus)) throw new BadRequestError("invalid status");
    const item = await createProcurement(userId, {
      category: b.category as ProcurementCategory,
      label: b.label.trim(),
      beatId: typeof b.beatId === "string" ? b.beatId : null,
      status: b.status as ProcurementStatus | undefined,
      neededBy: typeof b.neededBy === "string" ? b.neededBy : null,
      estimatedCostCents: typeof b.estimatedCostCents === "number" ? b.estimatedCostCents : null,
      notes: typeof b.notes === "string" ? b.notes : null,
    });
    return NextResponse.json({ item }, { status: 201 });
  } catch (error) {
    log.error("POST /api/coomander/procurement failed", { error });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUser(request);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof b.id !== "string") throw new BadRequestError("id is required");
    if (b.category != null && !CATEGORIES.includes(b.category as ProcurementCategory)) throw new BadRequestError("invalid category");
    if (b.status != null && !STATUSES.includes(b.status as ProcurementStatus)) throw new BadRequestError("invalid status");
    const item = await updateProcurement(userId, b.id, {
      category: b.category as ProcurementCategory | undefined,
      label: typeof b.label === "string" ? b.label : undefined,
      beatId: b.beatId === undefined ? undefined : (typeof b.beatId === "string" ? b.beatId : null),
      status: b.status as ProcurementStatus | undefined,
      neededBy: b.neededBy === undefined ? undefined : (typeof b.neededBy === "string" ? b.neededBy : null),
      estimatedCostCents: b.estimatedCostCents === undefined ? undefined : (typeof b.estimatedCostCents === "number" ? b.estimatedCostCents : null),
      actualCostCents: b.actualCostCents === undefined ? undefined : (typeof b.actualCostCents === "number" ? b.actualCostCents : null),
      notes: b.notes === undefined ? undefined : (typeof b.notes === "string" ? b.notes : null),
    });
    if (!item) throw new NotFoundError("procurement item not found");
    return NextResponse.json({ item });
  } catch (error) {
    log.error("PATCH /api/coomander/procurement failed", { error });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUser(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new BadRequestError("id query param is required");
    await deleteProcurement(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("DELETE /api/coomander/procurement failed", { error });
    return errorResponse(error);
  }
}
