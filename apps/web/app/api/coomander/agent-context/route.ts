import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { auth } from "@/lib/auth";
import { userToday } from "@/lib/coomander/settings";
import {
  COOMANDER_CHAT_MAX_TOKENS,
  COOMANDER_CHAT_MODEL,
  chatSystemPrompt,
  chatTools,
} from "@/lib/coomander/coomanderChat";
import { errorResponse, UnauthorizedError } from "@/lib/errors";
import { log } from "@/lib/logger";
import { resolveActiveModel } from "@/lib/active-model";
import { getModel } from "@/lib/model-catalog";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/coomander/agent-context — per-turn chat context for the agents
 * Worker (#192).
 *
 * The Coomander WebSocket chat runs in apps/agents (workerd), which cannot
 * import from apps/web. Instead of mirroring the prompt there, the Worker calls
 * this route (cookie-authed, acting as the user) at the start of every turn and
 * receives the FULLY RENDERED system prompt (live ops context baked in), the
 * model/token settings, the Coomander tool schemas, and the entitlement verdict
 * (Coomander ops enabled). lib/coomander/coomanderChat.ts stays the single
 * source of truth for Coomander's voice and tools across the POST and WebSocket
 * paths.
 */
export async function GET(request: Request) {
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
    const entitled = (rows[0]?.enabled ?? 0) === 1;

    const [today, systemPrompt] = await Promise.all([
      userToday(userId),
      chatSystemPrompt(userId),
    ]);

    // Resolve the active model from the catalog (admin default + per-user
    // override, #203 Phase B) so the switcher drives the live agent. The agent
    // tool-gates / multimodal-gates on the capability flags. If resolution
    // throws (DB hiccup, etc.) fall back to the static constant so the agent
    // never loses its model.
    let modelEntry = getModel(COOMANDER_CHAT_MODEL);
    try {
      modelEntry = await resolveActiveModel({ userId });
    } catch (resolveErr) {
      log.warn("[agent-context] active-model resolution failed; using static fallback", {
        userId,
        fallback: COOMANDER_CHAT_MODEL,
        error: resolveErr instanceof Error ? resolveErr.message : String(resolveErr),
      });
    }

    // chatTools() returns Anthropic.Tool[]; the Worker consumes the same
    // {name, description, input_schema} shape.
    return NextResponse.json({
      entitled,
      today,
      model: modelEntry?.id ?? COOMANDER_CHAT_MODEL,
      maxTokens: COOMANDER_CHAT_MAX_TOKENS,
      systemPrompt,
      tools: chatTools(),
      // Capability flags so the agent can gate tools / multimodal per model.
      supportsTools: modelEntry?.supportsTools ?? true,
      supportsImages: modelEntry?.supportsImages ?? true,
      tier: modelEntry?.tier,
      provider: modelEntry?.provider,
    });
  } catch (error) {
    log.error("GET /api/coomander/agent-context failed", { error });
    return errorResponse(error);
  }
}
