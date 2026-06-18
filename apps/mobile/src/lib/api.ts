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
 * Send one chat turn (JSON request/response). Coomander either converses or
 * takes a domain action, then persists both sides. Retained for callers that
 * don't want token streaming; the chat screen uses `streamMessage` instead.
 */
export function sendMessage(message: string): Promise<CoomanderReply> {
  return apiFetch<CoomanderReply>("/api/coomander/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

/** Incremental callbacks for an SSE-streamed chat turn. */
export interface StreamCallbacks {
  /** Called with the running accumulated reply text on each delta. */
  onText: (accumulated: string) => void;
  /** Called once when the stream finishes, with the final reply + acted flag. */
  onDone: (fullText: string, acted: boolean) => void;
  /** Called on a stream-level error (server `{error}` or transport failure). */
  onError: (message: string) => void;
}

/**
 * Stream one chat turn over SSE via XHR (React Native lacks a streaming
 * `fetch`/`ReadableStream`, so we use `XMLHttpRequest` + `onreadystatechange`
 * progressive parsing, mirroring geology's chat screen). Sends
 * `Accept: text/event-stream` so the server returns the SSE branch; the auth
 * cookie + Origin match `apiFetch`. Parses `data: {...}` frames incrementally,
 * accumulating `text` deltas and finalizing on `{done}` (or `{error}`).
 *
 * Returns the accumulated full reply text on success.
 */
export function streamMessage(message: string, cb: StreamCallbacks): Promise<string> {
  const cookie = authClient.getCookie();

  return new Promise<string>((resolve, reject) => {
    let accumulated = "";
    let acted = false;
    let processed = 0; // how far we've parsed into the XHR responseText
    let erred = false;

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_URL}/api/coomander/chat`);
    xhr.setRequestHeader("Accept", "text/event-stream");
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Origin", API_URL);
    if (cookie) xhr.setRequestHeader("Cookie", cookie);

    xhr.onreadystatechange = () => {
      // readyState 3 = LOADING (progressive data available), 4 = DONE.
      if (xhr.readyState >= 3 && xhr.responseText) {
        const fresh = xhr.responseText.slice(processed);
        processed = xhr.responseText.length;

        // SSE frames are separated by a blank line; process complete `data:`
        // lines. Partial trailing chunks are picked up on the next event since
        // `processed` only advances past what we've consumed via responseText.
        const lines = fresh.split("\n");
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            if (typeof event.text === "string") {
              accumulated += event.text;
              cb.onText(accumulated);
            }
            if (event.done) {
              if (typeof event.fullText === "string") accumulated = event.fullText;
              if (typeof event.acted === "boolean") acted = event.acted;
            }
            if (event.error) {
              erred = true;
              cb.onError(String(event.error));
            }
          } catch {
            // Skip malformed/partial JSON lines.
          }
        }
      }

      if (xhr.readyState === 4) {
        if (erred) {
          // Error already surfaced via onError; resolve with what we have.
          resolve(accumulated);
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          cb.onDone(accumulated, acted);
          resolve(accumulated);
        } else {
          const msg = `Request failed with status ${xhr.status}`;
          cb.onError(msg);
          reject(new ApiError(msg, xhr.status));
        }
      }
    };

    xhr.onerror = () => {
      cb.onError("Network error");
      reject(new ApiError("Network error", 0));
    };

    xhr.send(JSON.stringify({ message }));
  });
}
