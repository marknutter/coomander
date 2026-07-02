// Pure channel-routing helpers for the generic RealtimeChannel.
//
// IMPORTANT: this module is intentionally dependency-free — no Durable Object,
// no `env`, no network, no `cloudflare:workers` imports. Everything here is a
// pure synchronous function so it can be unit-tested in isolation and so the
// authorization policy is a single, obvious, reviewable seam.
//
// Ported from the AppSeed realtime epic (template #525/#527) into Coomander's
// existing `apps/agents` worker (#222) — Coomander does not rename its worker,
// so this module lives alongside the AppAgent chat code rather than in a
// separate `apps/realtime` package.

/** A parsed `"<type>:<id>"` channel address. */
export type ParsedChannel = {
  /** The channel type (segment before the first colon), e.g. `user`, `doc`. */
  type: string;
  /** The channel id (segment after the first colon), e.g. a user id. */
  id: string;
  /** The original, normalized `"<type>:<id>"` string used as the DO name. */
  raw: string;
};

/**
 * Parse a channel address of the form `"<type>:<id>"`.
 *
 * Splits on the FIRST colon: everything before is the type, everything after
 * is the id. This keeps ids that themselves contain colons intact (e.g.
 * `doc:project:42` → type `doc`, id `project:42`). Both halves must be
 * non-empty.
 *
 * Returns `null` for anything malformed (no colon, empty type, or empty id) so
 * callers can map a bad address to a 400 without throwing.
 */
export function parseChannel(channel: string): ParsedChannel | null {
  if (typeof channel !== "string") return null;
  const colon = channel.indexOf(":");
  if (colon <= 0) return null; // no colon, or empty type ("":...)
  const type = channel.slice(0, colon);
  const id = channel.slice(colon + 1);
  if (type.length === 0 || id.length === 0) return null;
  // `raw` is rebuilt from the parsed parts so it's a normalized canonical form
  // (== the input here, but explicit so the DO name is derived from the parse).
  return { type, id, raw: `${type}:${id}` };
}

/**
 * Authorization policy for a channel subscription — THE single pluggable point.
 *
 * Coomander policy (deliberately conservative — deny by default):
 *   • `user:<id>`          → allowed only when `<id> === user.id`. A user may
 *                            only subscribe to their OWN user channel (agent
 *                            proactive delivery, the ping demo).
 *   • `notifications:<id>` → treated identically to `user:<id>` (id must equal
 *                            the session user id). This is BACKWARD COMPAT for
 *                            the existing notification bell, whose legacy SSE
 *                            stream used the `notifications:{userId}` channel
 *                            name. Same ownership rule, different prefix.
 *   • `campaign:<id>`      → ADMIN-ONLY. Any admin may watch any campaign's live
 *                            send/open progress (campaigns are a global admin
 *                            surface, not user-owned — the id is the campaign
 *                            id, not a membership key). Gated on `role ===
 *                            "admin"` surfaced on the session user. Fail-closed:
 *                            no role / non-admin → denied, so recipient data is
 *                            never fanned out to a non-admin socket. NOTE: the
 *                            `role` field only appears on the session once the
 *                            hardening slice (#222) wires the Better Auth admin
 *                            role/backfill — until then this is undefined and
 *                            the check safely denies everyone.
 *   • anything else        → DENIED. Unknown types (`doc`, `room`, …) return
 *                            false. Coomander ships no membership model for
 *                            them, so the safe default is to refuse.
 *
 * EXTEND THIS to add shared channels (a `doc` a user can edit, a `room` they've
 * joined, …) — replace/extend this function with the project's own membership
 * lookup. The signature is kept pure & synchronous; it can be swapped for an
 * ASYNC authorizer hook (e.g. `(parsed, user, env) => Promise<boolean>`) that
 * queries the web API — the worker gate awaits it before forwarding to the DO.
 * Keep this the ONLY place that decides who may subscribe to what.
 */
export function authorizeChannel(
  parsed: ParsedChannel,
  user: { id: string; role?: string },
): boolean {
  switch (parsed.type) {
    case "user":
    case "notifications":
      // Own-channel only: the id must be the requesting user's id.
      return parsed.id === user.id;
    case "campaign":
      // Admin-only: any admin may watch any campaign's live progress.
      // Fail-closed when role is absent/non-admin.
      return user.role === "admin";
    default:
      // Unknown channel type — deny. Add cases (with real membership checks)
      // here for shared channels.
      return false;
  }
}
