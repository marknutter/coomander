import { ApiError, type RequestInitLike } from "@coomander/core";
import { authClient, API_URL } from "./auth-client";

/**
 * Minimal typed API helper for the mobile app. Wraps `fetch` against the
 * Coomander backend, injects the Better Auth session cookie that
 * `@better-auth/expo` stored in secure-store, and throws the shared
 * `ApiError` (from @coomander/core) on non-2xx responses so error handling
 * stays consistent across platforms.
 *
 * When @coomander/core grows a full `createApiClient` (extracted from
 * apps/web), swap this for that shared client. For the initial scaffold this
 * thin wrapper is enough and keeps the dependency on @coomander/core real.
 */
export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInitLike = {},
): Promise<T> {
  const cookie = authClient.getCookie();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Origin: API_URL,
    ...(init.headers ?? {}),
  };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${API_URL}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body,
  });

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // Non-JSON body — leave data null.
  }

  if (!res.ok) {
    const message =
      (data && typeof data === "object" && "message" in data
        ? String((data as { message: unknown }).message)
        : null) ?? `Request failed with status ${res.status}`;
    throw new ApiError(message, res.status);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Coomander agent chat
// ---------------------------------------------------------------------------

/** A single message in the unified Coomander thread (web + Telegram + phone). */
export interface CoomanderMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
}

/** Shape of `GET /api/coomander/chat`. */
export interface CoomanderThread {
  /** Whether Coomander ops is enabled for the signed-in user. */
  enabled: boolean;
  messages: CoomanderMessage[];
}

/** Shape of `POST /api/coomander/chat`. */
export interface CoomanderReply {
  reply: string;
  /** True when Coomander took a domain action (tool-use) this turn. */
  acted: boolean;
}

/**
 * Load the unified Coomander thread on mount. This is the SAME
 * `coomander_message_log` the web app and Telegram use, so web + phone are one
 * conversation. Auth (the Better Auth session cookie) is attached by
 * `apiFetch`.
 */
export function getThread(): Promise<CoomanderThread> {
  return apiFetch<CoomanderThread>("/api/coomander/chat");
}

/**
 * Send one chat turn. Coomander either converses or takes a domain action,
 * then persists both sides. Unlike geology's `/api/chat` SSE stream, this is a
 * plain request/response JSON call — there is no token-level streaming yet, so
 * callers show a "thinking…" indicator while the POST is in flight and append
 * the returned `reply` (or re-`getThread()`) when it resolves.
 */
export function sendMessage(message: string): Promise<CoomanderReply> {
  return apiFetch<CoomanderReply>("/api/coomander/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}
