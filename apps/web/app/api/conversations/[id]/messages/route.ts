export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getRawDb } from "@/lib/db";
import { UnauthorizedError, NotFoundError, BadRequestError, errorResponse } from "@/lib/errors";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { id } = await params;
    const db = getRawDb();

    // Verify conversation belongs to user
    const conversation = db
      .prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?")
      .get(id, session.user.id);
    if (!conversation) throw new NotFoundError("Conversation not found");

    const messages = db
      .prepare(
        "SELECT id, role, content, attachments_meta, created_at FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC"
      )
      .all(id);

    return NextResponse.json({ messages });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const { id } = await params;
    const db = getRawDb();

    // Verify conversation belongs to user
    const conversation = db
      .prepare("SELECT id, title FROM conversations WHERE id = ? AND user_id = ?")
      .get(id, session.user.id) as { id: string; title: string } | undefined;
    if (!conversation) throw new NotFoundError("Conversation not found");

    const body = await request.json();
    if (!body.role || !["user", "assistant"].includes(body.role)) {
      throw new BadRequestError("Invalid role");
    }

    const messageId = crypto.randomUUID();
    const attachmentsMeta = body.attachments_meta
      ? JSON.stringify(body.attachments_meta)
      : null;

    db.prepare(
      "INSERT INTO chat_messages (id, conversation_id, role, content, attachments_meta) VALUES (?, ?, ?, ?, ?)"
    ).run(messageId, id, body.role, body.content || "", attachmentsMeta);

    // Update conversation timestamp
    db.prepare(
      "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
    ).run(id);

    // Auto-rename conversation from first user message
    if (body.role === "user" && conversation.title === "New chat" && body.content) {
      const title = body.content.slice(0, 60) + (body.content.length > 60 ? "..." : "");
      db.prepare("UPDATE conversations SET title = ? WHERE id = ?").run(title, id);
    }

    const message = db
      .prepare("SELECT id, role, content, attachments_meta, created_at FROM chat_messages WHERE id = ?")
      .get(messageId);

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
