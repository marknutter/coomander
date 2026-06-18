import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { chatTools, runCoomanderTool } from "@/lib/coomander/coomanderChat";
import { errorResponse, UnauthorizedError } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

/**
 * POST /api/coomander/agent-tool — execute one Coomander tool call for the
 * agents Worker (#192).
 *
 * During a WebSocket chat turn the model may call a Coomander domain tool
 * (log_drop, advance_content_state, …). The Worker never runs product logic
 * itself: it forwards {name, input} here (cookie-authed, acting as the user),
 * and this route executes it through runCoomanderTool — the exact
 * resolveToolUse + executeAction path the POST /api/coomander/chat turn uses —
 * returning { action, note }. The note is what the model sees as the
 * tool_result; the action lands in the assistant turn's meta.
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();
    const userId = session.user.id;

    const db = getDb();
    const rows = (await db
      .select({ enabled: userT.coomanderEnabled })
      .from(userT)
      .where(eq(userT.id, userId))
      .limit(1)) as Array<{ enabled: number }>;
    if ((rows[0]?.enabled ?? 0) !== 1) {
      return NextResponse.json({ error: "Coomander is not enabled.", upgrade: true }, { status: 402 });
    }

    const body = await request.json().catch(() => ({}));
    const name: unknown = body.name;
    const input: unknown = body.input;
    const known = new Set(chatTools().map((t) => t.name));
    if (typeof name !== "string" || !known.has(name)) {
      return NextResponse.json({ error: "unknown tool" }, { status: 400 });
    }
    if (typeof input !== "object" || input === null) {
      return NextResponse.json({ error: "input must be an object" }, { status: 400 });
    }

    const outcome = await runCoomanderTool(userId, name, input as Record<string, unknown>);
    return NextResponse.json(outcome);
  } catch (error) {
    log.error("POST /api/coomander/agent-tool failed", { error });
    return errorResponse(error);
  }
}
