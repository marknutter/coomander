import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { appendMessage } from "@/lib/coomander/coomanderMessages";
import { getCoomanderSettings } from "@/lib/coomander/settings";
import { timingSafeEqualStr } from "@/lib/internal-auth";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SCOPE = "api/internal/conversation-message";

/**
 * Internal server-to-server endpoint for the agents Worker to append a message
 * to a user's Coomander thread WITHOUT a session cookie — used when a scheduled
 * agent wake fires (e.g. a `schedule_followup` reminder) and there's no live
 * request to ride. The agent proves itself with the shared
 * `AGENTS_INTERNAL_SECRET` and asserts the `userId`. NOT reachable by browsers.
 *
 * ADAPTED from the AppSeed template (#192): Coomander's chat is the unified
 * per-user thread (coomander_message_log), not conversations/chat_messages —
 * the route path is kept for template/Worker parity, the `conversationId` field
 * is accepted and ignored (the Worker sends the "coomander" sentinel), and the
 * ownership check reduces to "the asserted user exists". user→inbound,
 * assistant→outbound.
 *
 * Body: { userId, conversationId?, role: "user" | "assistant", content }
 */
export async function POST(request: NextRequest) {
  const secret = process.env.AGENTS_INTERNAL_SECRET;
  if (!secret) {
    log.error("AGENTS_INTERNAL_SECRET not configured — refusing internal call", { scope: SCOPE });
    return NextResponse.json({ error: "internal endpoint disabled" }, { status: 503 });
  }
  const presented = request.headers.get("x-agents-internal-secret");
  if (!presented || !timingSafeEqualStr(presented, secret)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: {
    userId?: string;
    conversationId?: string;
    role?: string;
    content?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const userId = body.userId?.trim();
  const role = body.role;
  const content = (body.content ?? "").trim();
  if (!userId || !content) {
    return NextResponse.json({ error: "userId and content are required" }, { status: 400 });
  }
  if (role !== "user" && role !== "assistant") {
    return NextResponse.json({ error: "invalid role" }, { status: 400 });
  }

  // The asserted user must exist — the secret alone can't write into limbo.
  const db = getDb();
  const rows = (await db
    .select({ id: userT.id })
    .from(userT)
    .where(eq(userT.id, userId))
    .limit(1)) as Array<{ id: string }>;
  if (!rows[0]) {
    return NextResponse.json({ error: "user not found" }, { status: 404 });
  }

  const settings = await getCoomanderSettings(userId);
  const direction = role === "user" ? "inbound" : "outbound";
  await appendMessage(userId, direction, content, { personaMode: settings.personaMode });
  log.info("Internal Coomander message appended", { scope: SCOPE, userId, role });
  return NextResponse.json({ ok: true }, { status: 201 });
}
