export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import crypto from "crypto";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRawDb } from "@/lib/db";
import { UnauthorizedError, errorResponse } from "@/lib/errors";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const db = getRawDb();
    const conversations = db
      .prepare(
        "SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC"
      )
      .all(session.user.id);

    return NextResponse.json({ conversations });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const body = await request.json().catch(() => ({}));
    const title = body.title || "New chat";
    const id = crypto.randomUUID();

    const db = getRawDb();
    db.prepare(
      "INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)"
    ).run(id, session.user.id, title);

    const conversation = db
      .prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ?")
      .get(id);

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
