import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getFlag } from "@/lib/flags";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/flags — Evaluate feature flags for the current user.
 *
 * Returns all registered flags evaluated with the user's context (userId, plan).
 * Unauthenticated requests get flags evaluated with no context (global defaults).
 *
 * Response shape:
 * ```json
 * { "flags": { "coomander-agents-chat": true } }
 * ```
 */
export async function GET(request: Request) {
  try {
    // Build evaluation context from session (optional — works without auth too).
    const session = await auth.api.getSession({ headers: request.headers }).catch(() => null);
    const context = session
      ? {
          userId: session.user.id,
          // `plan` is a Better Auth additionalField; the inferred session type
          // doesn't carry it, so read it through a narrow cast.
          plan: (session.user as { plan?: string }).plan || "free",
          email: session.user.email,
        }
      : undefined;

    // ── Register flags here ────────────────────────────────────────────
    // Each entry: [key, type, defaultValue]. Override locally with FLAG_*
    // env vars (FLAG_COOMANDER_AGENTS_CHAT=false) or a flags.json at the repo
    // root.
    const flags: Record<string, boolean | string | number> = {};

    // WebSocket Coomander chat via the Agents SDK sidecar (#192). ON → a live
    // WebSocket to the user's AppAgent (streaming, tools, proactive frames);
    // OFF → the existing POST /api/coomander/chat path. Defaults OFF until the
    // agents Worker is operator-deployed — the prod agents Worker route is
    // operator-gated, so the WS connect would fail and the chat page falls back
    // to the POST path automatically. Set FLAG_COOMANDER_AGENTS_CHAT=true to
    // turn it on in dev.
    flags["coomander-agents-chat"] = await getFlag("coomander-agents-chat", false, context);

    return NextResponse.json({ flags });
  } catch (error) {
    log.error("GET /api/flags failed", { error });
    return NextResponse.json({ flags: {} }, { status: 500 });
  }
}
