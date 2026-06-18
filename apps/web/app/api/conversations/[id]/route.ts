export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRawDb } from "@/lib/db";
import { UnauthorizedError, NotFoundError, errorResponse } from "@/lib/errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { id } = await params;
    const db = getRawDb();
    const conversation = db
      .prepare(
        "SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?"
      )
      .get(id, session.user.id);

    if (!conversation) throw new NotFoundError("Conversation not found");

    return NextResponse.json({ conversation });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { id } = await params;
    const db = getRawDb();
    const result = db
      .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
      .run(id, session.user.id);

    if (result.changes === 0) throw new NotFoundError("Conversation not found");

    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
