import { NextResponse } from "next/server";
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
 * { "flags": {} }
 * ```
 *
 * The `coomander-agents-chat` flag was REMOVED in Phase D (#203). It once gated
 * the WS-vs-SSE chat transport, but BOTH surfaces (web + mobile) are now
 * WebSocket-only with the POST/SSE chat path deleted, so it gated nothing and
 * had no remaining consumer. The endpoint is kept (returning `{ flags: {} }`) so
 * register-a-new-flag here stays a one-line change and any caller of `/api/flags`
 * still gets a valid shape.
 */
export async function GET() {
  try {
    // ── Register flags here ────────────────────────────────────────────
    // Add new flags via `getFlag(key, default, context)` (build `context` from
    // the session as before). None are registered after #203.
    const flags: Record<string, boolean | string | number> = {};

    return NextResponse.json({ flags });
  } catch (error) {
    log.error("GET /api/flags failed", { error });
    return NextResponse.json({ flags: {} }, { status: 500 });
  }
}
