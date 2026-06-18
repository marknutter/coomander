import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { appendMessage } from "@/lib/coomander/coomanderMessages";
import { getCoomanderSettings } from "@/lib/coomander/settings";
import { COOMANDER_CHAT_MODEL } from "@/lib/coomander/coomanderChat";
import { logCoomanderUsage } from "@/lib/coomander/usage";
import { errorResponse, UnauthorizedError } from "@/lib/errors";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/coomander/messages — append one turn to the user's Coomander thread
 * (#192).
 *
 * Used by the agents Worker's WebSocket chat path, which persists through the
 * web API rather than touching the DB (the same data-boundary rule the template
 * agent follows). Session-scoped; the Worker forwards the user's cookie, so the
 * write is authorized exactly like a browser call.
 *
 * Body: { role: "user" | "assistant", content, meta?, usage?, model? }
 * - role "user" turns are gated on Coomander being enabled (402) — that gate is
 *   what meters WS turns, since the model call happens in the Worker, not here.
 * - role "assistant" turns may carry tool-action meta and summed token usage;
 *   usage is logged via logCoomanderUsage for cost-tracking parity.
 *
 * The unified thread stores `direction` (inbound/outbound); user→inbound,
 * assistant→outbound, matching the POST /api/coomander/chat path so web,
 * Telegram, and the agent are one continuous conversation.
 */
export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();
    const userId = session.user.id;

    const body = await request.json().catch(() => ({}));
    const role: unknown = body.role;
    const content: unknown = body.content;
    if (role !== "user" && role !== "assistant") {
      return NextResponse.json({ error: "invalid role" }, { status: 400 });
    }
    if (typeof content !== "string" || !content.trim()) {
      return NextResponse.json({ error: "content required" }, { status: 400 });
    }

    if (role === "user") {
      // A user turn initiates a model call in the agents Worker — apply the same
      // ops-enabled gate as the POST chat path.
      const db = getDb();
      const rows = (await db
        .select({ enabled: userT.coomanderEnabled })
        .from(userT)
        .where(eq(userT.id, userId))
        .limit(1)) as Array<{ enabled: number }>;
      if ((rows[0]?.enabled ?? 0) !== 1) {
        return NextResponse.json({ error: "Coomander is not enabled.", upgrade: true }, { status: 402 });
      }
    }

    const settings = await getCoomanderSettings(userId);
    const direction = role === "user" ? "inbound" : "outbound";
    const meta =
      typeof body.meta === "object" && body.meta !== null
        ? (body.meta as Record<string, unknown>)
        : undefined;
    await appendMessage(userId, direction, content, {
      personaMode: settings.personaMode,
      toolCall: meta ?? undefined,
    });

    if (role === "assistant" && typeof body.usage === "object" && body.usage !== null) {
      const usage = body.usage as { input_tokens?: number; output_tokens?: number };
      const model = typeof body.model === "string" && body.model ? body.model : COOMANDER_CHAT_MODEL;
      // Best-effort cost logging; never fails the append.
      await logCoomanderUsage(userId, "inbound", model, usage.input_tokens, usage.output_tokens);
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    log.error("POST /api/coomander/messages failed", { error });
    return errorResponse(error);
  }
}
