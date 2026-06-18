import type { Env } from "./index";

/**
 * The agent runtime never touches the app DB directly — it reads/writes through
 * the existing web API (epic #388 / #192 data-boundary decision). Two auth modes:
 *
 *  - **User cookie** (`callAsUser`): during a live chat turn the agent has the
 *    requesting connection's cookie, so it acts AS the user against normal
 *    routes (e.g. POST /api/coomander/messages). Better Auth scopes the write
 *    to that user.
 *
 *  - **Internal secret** (`callInternal`): a scheduled wake fires from a DO
 *    alarm with no connection and no cookie. For those server-to-server writes
 *    the agent asserts the user id and proves itself with a shared secret to a
 *    dedicated `/api/internal/*` route. Never exposed to the client.
 *
 * Transport: `env.WEB` service binding in prod, `env.WEB_ORIGIN` URL on the
 * shared dev netns otherwise — same split as session validation.
 */

function webOrigin(env: Env): string {
  return env.WEB_ORIGIN ?? "http://127.0.0.1:3000";
}

function doFetch(env: Env, url: string, init: RequestInit): Promise<Response> {
  return env.WEB ? env.WEB.fetch(url, init) : fetch(url, init);
}

/** Call a normal web API route as the user, forwarding their session cookie. */
export async function callAsUser(
  env: Env,
  cookie: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return doFetch(env, `${webOrigin(env)}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      cookie,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/**
 * Call an `/api/internal/*` route server-to-server (no user cookie). The route
 * authenticates the shared secret and trusts the asserted `userId`. Used for
 * writes that happen outside a request context — i.e. scheduled wakes.
 */
export async function callInternal(
  env: Env,
  path: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const secret = env.AGENTS_INTERNAL_SECRET;
  if (!secret) {
    throw new Error(
      "AGENTS_INTERNAL_SECRET is not set — cannot make server-to-server agent calls",
    );
  }
  return doFetch(env, `${webOrigin(env)}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-agents-internal-secret": secret,
    },
    body: JSON.stringify(body),
  });
}

/**
 * Deliver a proactive message over Coomander's native channel — Telegram — via
 * the internal route (the default outbound fallback when no socket is
 * connected). Coomander divergence from the AppSeed template (which persists an
 * in-app notification): Coomander's users live on Telegram, so an undelivered
 * proactive nudge is sent there. Returns true on success.
 */
export async function deliverTelegramFallback(
  env: Env,
  userId: string,
  message: string,
): Promise<boolean> {
  const res = await callInternal(env, "/api/internal/telegram-deliver", {
    userId,
    message,
  });
  if (!res.ok) {
    console.error(
      `[agents.web-api] internal telegram-deliver failed: ${res.status}`,
    );
  }
  return res.ok;
}
