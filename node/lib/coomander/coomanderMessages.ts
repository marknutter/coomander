/**
 * Coomander conversation log (#151).
 *
 * Every outbound Coomander message AND inbound creator reply is appended to
 * `coomander_message_log`. This is the INDEFINITE-RETENTION companion-memory
 * substrate: there is no TTL, no cleanup sweep, ever (see migration 016 /
 * schema comment). Each row also records the persona mode in effect and, for
 * inbound, the classifier's tool-call JSON.
 *
 * Ported from ~/Code/geology/web/node/lib/geology/geoMessages.ts.
 */

import crypto from "crypto";
import { and, eq, gt, asc, desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { coomanderMessageLog as logT } from "@/lib/schema";
import type { PersonaMode } from "./settings";

export type Direction = "inbound" | "outbound";

export interface CoomanderMessage {
  id: string;
  direction: Direction;
  text: string;
  telegramUpdateId: number | null;
  toolCall: Record<string, unknown> | null;
  personaMode: string;
  createdAt: number;
}

export interface AppendOptions {
  personaMode?: PersonaMode;
  telegramUpdateId?: number | null;
  /** Any JSON-serializable classifier output (e.g. the forced tool call). */
  toolCall?: unknown;
}

/**
 * Append one message to a user's Coomander log. Returns the new row id.
 * Callers on a hot path (a ping that must still succeed if logging hiccups)
 * should wrap this in a try/catch — it does not swallow its own errors.
 */
export async function appendMessage(
  userId: string,
  direction: Direction,
  text: string,
  opts: AppendOptions = {},
): Promise<string | null> {
  const body = (text ?? "").trim();
  if (!body) return null;
  const db = getDb();
  const id = crypto.randomUUID();
  await db.insert(logT).values({
    id,
    user_id: userId,
    direction,
    telegram_update_id: opts.telegramUpdateId ?? null,
    text: body,
    tool_call_json: opts.toolCall != null ? JSON.stringify(opts.toolCall) : null,
    persona_mode: opts.personaMode ?? "light_companion",
    created_at: Math.floor(Date.now() / 1000),
  });
  return id;
}

function hydrate(
  rows: Array<{
    id: string;
    direction: string;
    text: string;
    telegram_update_id: number | null;
    tool_call_json: string | null;
    persona_mode: string;
    created_at: number;
  }>,
): CoomanderMessage[] {
  return rows.map((r) => ({
    id: r.id,
    direction: r.direction as Direction,
    text: r.text,
    telegramUpdateId: r.telegram_update_id,
    toolCall: r.tool_call_json ? (JSON.parse(r.tool_call_json) as Record<string, unknown>) : null,
    personaMode: r.persona_mode,
    createdAt: r.created_at,
  }));
}

/** The most recent `limit` messages, oldest-first for rendering. */
export async function listMessages(userId: string, limit = 100): Promise<CoomanderMessage[]> {
  const db = getDb();
  const rows = (await db
    .select()
    .from(logT)
    .where(eq(logT.user_id, userId))
    .orderBy(desc(logT.created_at))
    .limit(limit)) as unknown as Parameters<typeof hydrate>[0];
  return hydrate(rows).reverse();
}

/** Messages created after a unix-seconds cursor (for polling), oldest-first. */
export async function messagesSince(userId: string, sinceSeconds: number): Promise<CoomanderMessage[]> {
  const db = getDb();
  const rows = (await db
    .select()
    .from(logT)
    .where(and(eq(logT.user_id, userId), gt(logT.created_at, sinceSeconds)))
    .orderBy(asc(logT.created_at))) as unknown as Parameters<typeof hydrate>[0];
  return hydrate(rows);
}
