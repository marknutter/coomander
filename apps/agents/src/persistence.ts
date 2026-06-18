/**
 * Coomander-thread persistence for the agents Worker.
 *
 * The agent never touches the app DB directly — the web app is the data
 * boundary (AppSeed epic #388 decision, kept in the Coomander port #192).
 *
 * ⚠️ ADAPTED from the template: Coomander's chat is the unified per-user thread
 * (coomander_message_log — one thread spanning Telegram + app), NOT the
 * template's conversations/chat_messages model. There are no conversation ids;
 * the WebSocket protocol's conversationId is the sentinel "coomander".
 *
 *   GET  {WEB}/api/coomander/chat        → hydrate recent turns (cookie)
 *   POST {WEB}/api/coomander/messages    → append a turn (cookie; the web route
 *                                          enforces the ops-enabled gate + rate
 *                                          limit on user turns, and logs token
 *                                          usage passed with assistant turns)
 *   POST {WEB}/api/internal/conversation-message
 *                                        → append WITHOUT a cookie (scheduled
 *                                          wakes; AGENTS_INTERNAL_SECRET)
 *
 * Transport mirrors auth.ts: `env.WEB` service binding in prod, a plain
 * `env.WEB_ORIGIN` URL in dev (next dev on the shared container netns).
 */

import type { Env } from "./index";
import { callAsUser, callInternal } from "./web-api";

export type PersistedRole = "user" | "assistant";

export interface PersistedMessage {
  id: string;
  role: PersistedRole;
  content: string;
}

interface RawMessage {
  id?: unknown;
  role?: unknown;
  content?: unknown;
}

/** Token usage to attach to an assistant append (web logs it via logUsage). */
export interface TurnUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
}

/** Web app failed to answer (unreachable / 5xx) — distinct from "rejected". */
export class PersistenceUnavailableError extends Error {
  /** HTTP status when the web app answered with a rejection (e.g. 402). */
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PersistenceUnavailableError";
    this.status = status;
  }
}

/**
 * Append a turn to the user's Coomander thread, acting as the user. Assistant
 * turns may carry `meta` (e.g. tool actions) and token `usage` for cost logging.
 */
export async function appendMessage(
  env: Env,
  cookie: string,
  role: PersistedRole,
  content: string,
  extras?: { meta?: Record<string, unknown> | null; usage?: TurnUsage; model?: string }
): Promise<PersistedMessage> {
  let res: Response;
  try {
    res = await callAsUser(env, cookie, "/api/coomander/messages", {
      method: "POST",
      body: JSON.stringify({
        role,
        content,
        meta: extras?.meta ?? undefined,
        usage: extras?.usage ?? undefined,
        model: extras?.model ?? undefined,
      }),
    });
  } catch (err) {
    throw new PersistenceUnavailableError(
      `append message unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    throw new PersistenceUnavailableError(`append message rejected: ${res.status}`, res.status);
  }
  const data = (await res.json().catch(() => null)) as { message?: RawMessage } | null;
  const m = data?.message;
  return {
    id: typeof m?.id === "string" ? m.id : crypto.randomUUID(),
    role,
    content,
  };
}

/**
 * Append a turn to the user's Coomander thread WITHOUT a user cookie — used by
 * scheduled wakes (e.g. a `schedule_followup` reminder) that fire outside any
 * live request. Goes through the internal-secret route, which verifies the
 * asserted user before writing. `conversationId` is carried for protocol parity
 * with the template (Coomander's thread is single — the web route ignores it).
 */
export async function appendMessageInternal(
  env: Env,
  userId: string,
  conversationId: string,
  role: PersistedRole,
  content: string
): Promise<PersistedMessage> {
  let res: Response;
  try {
    res = await callInternal(env, "/api/internal/conversation-message", {
      userId,
      conversationId,
      role,
      content,
    });
  } catch (err) {
    throw new PersistenceUnavailableError(
      `internal append unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!res.ok) {
    throw new PersistenceUnavailableError(`internal append rejected: ${res.status}`, res.status);
  }
  const data = (await res.json().catch(() => null)) as { message?: RawMessage } | null;
  const m = data?.message;
  return {
    id: typeof m?.id === "string" ? m.id : crypto.randomUUID(),
    role,
    content,
  };
}

/**
 * Hydrate the user's recent Coomander thread into a working buffer (oldest-
 * first). Used on cold start so the model sees prior context even after the DO
 * was evicted. Includes BOTH channels (telegram + app), matching the in-app
 * chat's recentTurns — Coomander remembers what it said over Telegram.
 */
export async function hydrateMessages(
  env: Env,
  cookie: string,
  limit: number
): Promise<PersistedMessage[]> {
  let res: Response;
  try {
    res = await callAsUser(env, cookie, "/api/coomander/chat", { method: "GET" });
  } catch (err) {
    throw new PersistenceUnavailableError(
      `hydrate unreachable: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (res.status >= 500) {
    throw new PersistenceUnavailableError(`hydrate failed: ${res.status}`);
  }
  if (!res.ok) {
    // 401/4xx is not a server failure — treat as an empty buffer; the turn's
    // own auth/entitlement checks decide whether to proceed.
    return [];
  }
  const data = (await res.json().catch(() => null)) as { messages?: RawMessage[] } | null;
  const rows = Array.isArray(data?.messages) ? data!.messages : [];
  const mapped: PersistedMessage[] = [];
  for (const row of rows) {
    const role = row?.role;
    if (role !== "user" && role !== "assistant") continue;
    mapped.push({
      id: typeof row.id === "string" ? row.id : crypto.randomUUID(),
      role,
      content: typeof row.content === "string" ? row.content : "",
    });
  }
  return limit > 0 ? mapped.slice(-limit) : mapped;
}
