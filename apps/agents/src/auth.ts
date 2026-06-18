import type { Env } from "./index";

export type SessionUser = {
  id: string;
  email?: string;
  name?: string;
};

/** Session endpoint failed (unreachable / 5xx) — distinct from "no session". */
export class SessionCheckUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionCheckUnavailableError";
  }
}

const SESSION_PATH = "/api/auth/get-session";

/**
 * Validates a Better Auth session by forwarding the Cookie header to the web
 * app — the agent worker never reads the auth DB itself; the web API is the
 * data boundary (epic #388 / #192 decision).
 *
 * Transport: `env.WEB` service binding in prod, plain URL via `env.WEB_ORIGIN`
 * in dev (next dev on the shared container netns).
 *
 * Returns the user for a valid session, null for missing/invalid/expired
 * sessions, and throws SessionCheckUnavailableError when the web app can't
 * answer — callers map that to 503, never to an unauthenticated pass-through.
 */
export async function validateSessionCookie(
  cookie: string | null,
  env: Env
): Promise<SessionUser | null> {
  if (!cookie) return null;

  const origin = env.WEB_ORIGIN ?? "http://127.0.0.1:3000";
  const url = `${origin}${SESSION_PATH}`;
  // Operational visibility: which transport reached the app worker. In prod the
  // `WEB` service binding is present (internal, no public hop); in dev it's a
  // plain fetch to WEB_ORIGIN.
  console.log(
    `[agents.auth] validating session via ${env.WEB ? "WEB service binding" : `public fetch (${origin})`}`
  );

  let res: Response;
  try {
    res = env.WEB
      ? await env.WEB.fetch(url, { headers: { cookie, accept: "application/json" } })
      : await fetch(url, { headers: { cookie, accept: "application/json" } });
  } catch (err) {
    console.error(`[agents.auth] session endpoint unreachable: ${url}`, err);
    throw new SessionCheckUnavailableError("session validation unavailable");
  }

  if (res.status >= 500) {
    console.error(`[agents.auth] session endpoint ${res.status} from ${url}`);
    throw new SessionCheckUnavailableError("session validation failed upstream");
  }
  if (!res.ok) {
    console.warn(`[agents.auth] session endpoint rejected request: ${res.status}`);
    return null;
  }

  // Better Auth returns JSON `null` (200) when there is no session, and
  // { session, user } when there is one.
  const data = (await res.json().catch(() => null)) as {
    user?: { id?: unknown; email?: string; name?: string };
  } | null;

  const userId = data?.user?.id;
  if (typeof userId !== "string" || userId.length === 0) return null;

  return { id: userId, email: data?.user?.email, name: data?.user?.name };
}
