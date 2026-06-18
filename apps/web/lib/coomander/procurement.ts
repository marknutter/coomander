/**
 * Procurement items — CRUD + urgency (#152).
 *
 * Split by category: shoot_prep (costumes, props, lights, locations — tied to
 * upcoming themed content) vs business_admin (invoices, gear, tax docs). The
 * pure urgency helpers (isUrgent / splitUrgent) take no DB and are testable.
 */

import crypto from "crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { procurementItems, type ProcurementItem } from "@/lib/schema";

export type ProcurementCategory = "shoot_prep" | "business_admin";
export type ProcurementStatus = "needed" | "ordered" | "received" | "canceled";

/** Open statuses still need action; received/canceled are done. */
export function isOpen(status: ProcurementStatus): boolean {
  return status === "needed" || status === "ordered";
}

/**
 * An item is urgent when it is still open AND either has no needed_by (treated as
 * always-pending) ... no: only date-bound open items within `withinDays` (or
 * already overdue) count as urgent. Open items with no date are pending but not
 * urgent.
 */
export function isUrgent(item: Pick<ProcurementItem, "status" | "needed_by">, today: string, withinDays = 7): boolean {
  if (!isOpen(item.status as ProcurementStatus)) return false;
  if (!item.needed_by) return false;
  const due = Date.parse(item.needed_by + "T00:00:00Z");
  const now = Date.parse(today + "T00:00:00Z");
  if (Number.isNaN(due) || Number.isNaN(now)) return false;
  const daysUntil = Math.round((due - now) / 86400000);
  return daysUntil <= withinDays; // includes overdue (negative)
}

export interface UrgentSplit {
  shoot_prep: ProcurementItem[];
  business_admin: ProcurementItem[];
}

/** Split urgent open items by category, soonest-due first. */
export function splitUrgent(items: ProcurementItem[], today: string, withinDays = 7): UrgentSplit {
  const urgent = items
    .filter((i) => isUrgent(i, today, withinDays))
    .sort((a, b) => (a.needed_by ?? "").localeCompare(b.needed_by ?? ""));
  return {
    shoot_prep: urgent.filter((i) => i.category === "shoot_prep"),
    business_admin: urgent.filter((i) => i.category === "business_admin"),
  };
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export interface CreateProcurementInput {
  category: ProcurementCategory;
  label: string;
  beatId?: string | null;
  status?: ProcurementStatus;
  neededBy?: string | null;
  estimatedCostCents?: number | null;
  notes?: string | null;
}

export async function createProcurement(userId: string, input: CreateProcurementInput): Promise<ProcurementItem> {
  const db = getDb();
  const id = crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await db.insert(procurementItems).values({
    id,
    user_id: userId,
    beat_id: input.beatId ?? null,
    category: input.category,
    label: input.label,
    status: input.status ?? "needed",
    needed_by: input.neededBy ?? null,
    estimated_cost_cents: input.estimatedCostCents ?? null,
    notes: input.notes ?? null,
    created_at: now,
    updated_at: now,
  });
  return (await getProcurement(userId, id))!;
}

export async function getProcurement(userId: string, id: string): Promise<ProcurementItem | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(procurementItems)
    .where(and(eq(procurementItems.user_id, userId), eq(procurementItems.id, id)))
    .limit(1);
  return (rows[0] as ProcurementItem) ?? null;
}

export async function listProcurement(userId: string, category?: ProcurementCategory): Promise<ProcurementItem[]> {
  const db = getDb();
  const where = category
    ? and(eq(procurementItems.user_id, userId), eq(procurementItems.category, category))
    : eq(procurementItems.user_id, userId);
  return (await db.select().from(procurementItems).where(where)) as ProcurementItem[];
}

export interface UpdateProcurementInput {
  category?: ProcurementCategory;
  label?: string;
  beatId?: string | null;
  status?: ProcurementStatus;
  neededBy?: string | null;
  estimatedCostCents?: number | null;
  actualCostCents?: number | null;
  notes?: string | null;
}

export async function updateProcurement(userId: string, id: string, input: UpdateProcurementInput): Promise<ProcurementItem | null> {
  const db = getDb();
  const set: Record<string, unknown> = { updated_at: Math.floor(Date.now() / 1000) };
  if (input.category !== undefined) set.category = input.category;
  if (input.label !== undefined) set.label = input.label;
  if (input.beatId !== undefined) set.beat_id = input.beatId;
  if (input.status !== undefined) set.status = input.status;
  if (input.neededBy !== undefined) set.needed_by = input.neededBy;
  if (input.estimatedCostCents !== undefined) set.estimated_cost_cents = input.estimatedCostCents;
  if (input.actualCostCents !== undefined) set.actual_cost_cents = input.actualCostCents;
  if (input.notes !== undefined) set.notes = input.notes;
  await db.update(procurementItems).set(set).where(and(eq(procurementItems.user_id, userId), eq(procurementItems.id, id)));
  return getProcurement(userId, id);
}

export async function deleteProcurement(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  await db.delete(procurementItems).where(and(eq(procurementItems.user_id, userId), eq(procurementItems.id, id)));
  return true;
}
