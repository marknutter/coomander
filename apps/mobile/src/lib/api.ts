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
