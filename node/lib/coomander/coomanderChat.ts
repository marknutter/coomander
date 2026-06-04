/**
 * Coomander two-way conversation state (#151).
 *
 * A thin layer over `coomander_message_log` that exposes the running thread as
 * Anthropic-shaped turns, so future milestones can give the classifier and the
 * in-app chat conversational context (and so the full-companion layer has a
 * ready source of history). Outbound Coomander messages map to the "assistant"
 * role, inbound creator messages to "user".
 *
 * Ported/simplified from ~/Code/geology/web/node/lib/geology/geoChat.ts — the
 * geology version also drives an in-app chat endpoint; that surface is deferred
 * for Coomander, so this keeps only the history/context helpers.
 */

import { listMessages, type CoomanderMessage } from "./coomanderMessages";

export type ChatRole = "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
}

/** Map a stored message's direction to an Anthropic chat role. */
export function roleForDirection(direction: CoomanderMessage["direction"]): ChatRole {
  return direction === "inbound" ? "user" : "assistant";
}

/**
 * The recent thread as Anthropic-shaped turns, oldest-first, ready to prepend to
 * a `messages.create` call. Defaults to the last 20 turns.
 */
export async function recentTurns(userId: string, limit = 20): Promise<ChatTurn[]> {
  const messages = await listMessages(userId, limit);
  return messages.map((m) => ({ role: roleForDirection(m.direction), content: m.text }));
}
