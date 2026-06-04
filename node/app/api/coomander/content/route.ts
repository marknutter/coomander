/**
 * /api/coomander/content — content lifecycle CRUD + transitions (#152).
 * GET (list), POST (create), PATCH (transition via {id, transitionTo, reason}
 * OR field update), DELETE (?id=).
 */

import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  createContent, listContent, updateContent, deleteContent, transitionContent,
  CONTENT_STATES,
} from "@/lib/coomander/contentStates";
import type { ContentStateValue } from "@/lib/schema";
import { UnauthorizedError, BadRequestError, NotFoundError, errorResponse } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function requireUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new UnauthorizedError();
  return session.user.id;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUser(request);
    return NextResponse.json({ content: await listContent(userId) });
  } catch (error) {
    log.error("GET /api/coomander/content failed", { error });
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const userId = await requireUser(request);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof b.title !== "string" || !b.title.trim()) throw new BadRequestError("title is required");
    if (b.currentState !== undefined && !CONTENT_STATES.includes(b.currentState as ContentStateValue)) throw new BadRequestError("invalid currentState");
    const content = await createContent(userId, {
      title: b.title.trim(),
      beatId: typeof b.beatId === "string" ? b.beatId : null,
      currentState: b.currentState as ContentStateValue | undefined,
      driveUrl: typeof b.driveUrl === "string" ? b.driveUrl : null,
      editedUrl: typeof b.editedUrl === "string" ? b.editedUrl : null,
      notes: typeof b.notes === "string" ? b.notes : null,
    });
    return NextResponse.json({ content }, { status: 201 });
  } catch (error) {
    log.error("POST /api/coomander/content failed", { error });
    return errorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const userId = await requireUser(request);
    const b = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    if (typeof b.id !== "string") throw new BadRequestError("id is required");

    // Transition path.
    if (b.transitionTo !== undefined) {
      if (!CONTENT_STATES.includes(b.transitionTo as ContentStateValue)) throw new BadRequestError("invalid transitionTo");
      const res = await transitionContent(userId, b.id, b.transitionTo as ContentStateValue, typeof b.reason === "string" ? b.reason : null);
      if (!res.ok) {
        if (res.error === "content not found") throw new NotFoundError(res.error);
        throw new BadRequestError(res.error ?? "invalid transition");
      }
      return NextResponse.json({ content: res.content });
    }

    // Field update path.
    const content = await updateContent(userId, b.id, {
      title: typeof b.title === "string" ? b.title : undefined,
      beatId: b.beatId === undefined ? undefined : (typeof b.beatId === "string" ? b.beatId : null),
      driveUrl: b.driveUrl === undefined ? undefined : (typeof b.driveUrl === "string" ? b.driveUrl : null),
      editedUrl: b.editedUrl === undefined ? undefined : (typeof b.editedUrl === "string" ? b.editedUrl : null),
      notes: b.notes === undefined ? undefined : (typeof b.notes === "string" ? b.notes : null),
    });
    if (!content) throw new NotFoundError("content not found");
    return NextResponse.json({ content });
  } catch (error) {
    log.error("PATCH /api/coomander/content failed", { error });
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const userId = await requireUser(request);
    const id = new URL(request.url).searchParams.get("id");
    if (!id) throw new BadRequestError("id query param is required");
    await deleteContent(userId, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("DELETE /api/coomander/content failed", { error });
    return errorResponse(error);
  }
}
