/**
 * Cadence pillar CRUD (#152).
 *
 * Pillars are the high-level content/ops areas (Reels, OF Wall, Live, PPV,
 * Procurement, Admin). Per-user, soft-archivable.
 */

import crypto from "crypto";
import { and, eq, isNull, asc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { cadencePillars, type CadencePillar } from "@/lib/schema";

export type PillarKind = "content" | "wall" | "procurement" | "engagement" | "admin";

export interface CreatePillarInput {
  name: string;
  kind: PillarKind;
  displayOrder?: number;
}

export async function createPillar(userId: string, input: CreatePillarInput): Promise<CadencePillar> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(cadencePillars).values({
    id,
    user_id: userId,
    name: input.name,
    kind: input.kind,
    display_order: input.displayOrder ?? 0,
    created_at: now,
    updated_at: now,
  });
  return (await getPillar(userId, id))!;
}

export async function getPillar(userId: string, id: string): Promise<CadencePillar | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(cadencePillars)
    .where(and(eq(cadencePillars.user_id, userId), eq(cadencePillars.id, id)))
    .limit(1);
  return (rows[0] as CadencePillar) ?? null;
}

/** All non-archived pillars, ordered by display_order. */
export async function listPillars(userId: string, includeArchived = false): Promise<CadencePillar[]> {
  const db = getDb();
  const where = includeArchived
    ? eq(cadencePillars.user_id, userId)
    : and(eq(cadencePillars.user_id, userId), isNull(cadencePillars.archived_at));
  return (await db
    .select()
    .from(cadencePillars)
    .where(where)
    .orderBy(asc(cadencePillars.display_order))) as CadencePillar[];
}

export interface UpdatePillarInput {
  name?: string;
  kind?: PillarKind;
  displayOrder?: number;
  archived?: boolean;
}

export async function updatePillar(userId: string, id: string, input: UpdatePillarInput): Promise<CadencePillar | null> {
  const db = getDb();
  const set: Record<string, unknown> = { updated_at: Math.floor(Date.now() / 1000) };
  if (input.name !== undefined) set.name = input.name;
  if (input.kind !== undefined) set.kind = input.kind;
  if (input.displayOrder !== undefined) set.display_order = input.displayOrder;
  if (input.archived !== undefined) set.archived_at = input.archived ? Math.floor(Date.now() / 1000) : null;
  await db.update(cadencePillars).set(set).where(and(eq(cadencePillars.user_id, userId), eq(cadencePillars.id, id)));
  return getPillar(userId, id);
}

export async function deletePillar(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  await db.delete(cadencePillars).where(and(eq(cadencePillars.user_id, userId), eq(cadencePillars.id, id)));
  return true;
}
