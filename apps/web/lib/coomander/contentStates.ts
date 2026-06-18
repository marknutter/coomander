/**
 * Content lifecycle state machine + CRUD (#152).
 *
 * The 7-step pipeline (drafted → shot → approved → uploaded_to_edit → edited →
 * scheduled → shipped) is a strict forward chain: you may only advance ONE step
 * at a time (no skipping), but you may move BACKWARD to any earlier state as long
 * as a reason is given (e.g. "re-shoot needed"). Every transition is appended to
 * state_history_json as an audit trail.
 *
 * The pure transition validator (isValidTransition) takes no DB and is
 * unit-tested directly.
 */

import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { contentStates, type ContentState, type ContentStateValue } from "@/lib/schema";

/** Ordered pipeline. Index = forward position. */
export const CONTENT_STATES: ContentStateValue[] = [
  "drafted",
  "shot",
  "approved",
  "uploaded_to_edit",
  "edited",
  "scheduled",
  "shipped",
];

export function stateIndex(state: ContentStateValue): number {
  return CONTENT_STATES.indexOf(state);
}

export interface TransitionCheck {
  valid: boolean;
  error?: string;
}

/**
 * Pure transition validation.
 *   - Forward: only the immediate next state (no skipping).
 *   - Backward: any earlier state, but a non-empty reason is required.
 *   - Same state: invalid.
 */
export function isValidTransition(
  from: ContentStateValue,
  to: ContentStateValue,
  reason?: string | null,
): TransitionCheck {
  const fi = stateIndex(from);
  const ti = stateIndex(to);
  if (fi < 0 || ti < 0) return { valid: false, error: "unknown state" };
  if (ti === fi) return { valid: false, error: `already in '${from}'` };
  if (ti > fi) {
    if (ti !== fi + 1) {
      return { valid: false, error: `cannot skip states: '${from}' can only advance to '${CONTENT_STATES[fi + 1]}'` };
    }
    return { valid: true };
  }
  // backward
  if (!reason || !reason.trim()) {
    return { valid: false, error: "moving backward requires a reason" };
  }
  return { valid: true };
}

interface HistoryEntry {
  from: ContentStateValue;
  to: ContentStateValue;
  at: number;
  reason?: string;
}

function parseHistory(json: string): HistoryEntry[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateContentInput {
  title: string;
  beatId?: string | null;
  currentState?: ContentStateValue;
  driveUrl?: string | null;
  editedUrl?: string | null;
  notes?: string | null;
}

export async function createContent(userId: string, input: CreateContentInput): Promise<ContentState> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(contentStates).values({
    id,
    user_id: userId,
    beat_id: input.beatId ?? null,
    title: input.title,
    current_state: input.currentState ?? "drafted",
    state_history_json: "[]",
    drive_url: input.driveUrl ?? null,
    edited_url: input.editedUrl ?? null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  });
  return (await getContent(userId, id))!;
}

export async function getContent(userId: string, id: string): Promise<ContentState | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(contentStates)
    .where(and(eq(contentStates.user_id, userId), eq(contentStates.id, id)))
    .limit(1);
  return (rows[0] as ContentState) ?? null;
}

export async function listContent(userId: string): Promise<ContentState[]> {
  const db = getDb();
  return (await db
    .select()
    .from(contentStates)
    .where(eq(contentStates.user_id, userId))) as ContentState[];
}

export interface TransitionResult {
  ok: boolean;
  error?: string;
  content?: ContentState;
}

/**
 * Advance/revert a content item's state. Validates the transition, appends to
 * the history, and persists. Returns {ok:false, error} on an invalid transition
 * (never throws for that case).
 */
export async function transitionContent(
  userId: string,
  id: string,
  to: ContentStateValue,
  reason?: string | null,
): Promise<TransitionResult> {
  const content = await getContent(userId, id);
  if (!content) return { ok: false, error: "content not found" };

  const from = content.current_state;
  const check = isValidTransition(from, to, reason);
  if (!check.valid) return { ok: false, error: check.error };

  const now = Math.floor(Date.now() / 1000);
  const history = parseHistory(content.state_history_json);
  history.push({ from, to, at: now, ...(reason ? { reason } : {}) });

  const db = getDb();
  await db
    .update(contentStates)
    .set({ current_state: to, state_history_json: JSON.stringify(history), updated_at: now })
    .where(and(eq(contentStates.user_id, userId), eq(contentStates.id, id)));
  return { ok: true, content: (await getContent(userId, id))! };
}

export interface UpdateContentInput {
  title?: string;
  beatId?: string | null;
  driveUrl?: string | null;
  editedUrl?: string | null;
  notes?: string | null;
}

/** Update non-state fields. State changes go through transitionContent. */
export async function updateContent(userId: string, id: string, input: UpdateContentInput): Promise<ContentState | null> {
  const db = getDb();
  const set: Record<string, unknown> = { updated_at: Math.floor(Date.now() / 1000) };
  if (input.title !== undefined) set.title = input.title;
  if (input.beatId !== undefined) set.beat_id = input.beatId;
  if (input.driveUrl !== undefined) set.drive_url = input.driveUrl;
  if (input.editedUrl !== undefined) set.edited_url = input.editedUrl;
  if (input.notes !== undefined) set.notes = input.notes;
  await db.update(contentStates).set(set).where(and(eq(contentStates.user_id, userId), eq(contentStates.id, id)));
  return getContent(userId, id);
}

export async function deleteContent(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  await db.delete(contentStates).where(and(eq(contentStates.user_id, userId), eq(contentStates.id, id)));
  return true;
}

/** Count content items grouped by state (for the TodayModel pipeline). */
export function pipelineCounts(items: ContentState[]): Record<ContentStateValue, number> {
  const counts = {
    drafted: 0, shot: 0, approved: 0, uploaded_to_edit: 0, edited: 0, scheduled: 0, shipped: 0,
  } as Record<ContentStateValue, number>;
  for (const it of items) counts[it.current_state] = (counts[it.current_state] ?? 0) + 1;
  return counts;
}
