/**
 * Per-user Coomander settings + recipient resolution (#151).
 *
 * Simpler than geology's settings.ts: there is no separate agents/channels/
 * link-code machinery. The Telegram destination lives directly on the user row
 * (`user.telegramChatId`) and the opt-in flag is `user.coomanderEnabled`.
 * Agent config (nag preset, persona mode) lives in `coomander_settings`, with
 * sensible defaults when no row exists.
 *
 * The pure pickers (pickNagFrequency / pickPersonaMode) are split out so they
 * are unit-testable without a DB.
 */

import crypto from "crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user as userT, coomanderSettings as settingsT } from "@/lib/schema";

export type NagFrequency = "tight" | "moderate" | "light";
export type PersonaMode = "light_companion" | "full_companion" | "operational";

export const NAG_FREQUENCIES: NagFrequency[] = ["tight", "moderate", "light"];
export const PERSONA_MODES: PersonaMode[] = ["light_companion", "full_companion", "operational"];

export const DEFAULT_NAG_FREQUENCY: NagFrequency = "tight";
export const DEFAULT_PERSONA_MODE: PersonaMode = "light_companion";

export interface CoomanderSettingsResolved {
  userId: string;
  nagFrequency: NagFrequency;
  personaMode: PersonaMode;
  pingTimesJson: string | null;
  companionConsentAt: number | null;
}

// ── Pure pickers (no DB) ─────────────────────────────────────────────────────

type SettingsRow =
  | {
      nag_frequency?: string | null;
      persona_mode?: string | null;
      ping_times_json?: string | null;
      companion_consent_at?: number | null;
    }
  | undefined;

export function pickNagFrequency(row: SettingsRow): NagFrequency {
  const v = (row?.nag_frequency ?? "").trim() as NagFrequency;
  return NAG_FREQUENCIES.includes(v) ? v : DEFAULT_NAG_FREQUENCY;
}

export function pickPersonaMode(row: SettingsRow): PersonaMode {
  const v = (row?.persona_mode ?? "").trim() as PersonaMode;
  return PERSONA_MODES.includes(v) ? v : DEFAULT_PERSONA_MODE;
}

export function isValidNagFrequency(v: unknown): v is NagFrequency {
  return typeof v === "string" && NAG_FREQUENCIES.includes(v as NagFrequency);
}

export function isValidPersonaMode(v: unknown): v is PersonaMode {
  return typeof v === "string" && PERSONA_MODES.includes(v as PersonaMode);
}

// ── DB-backed resolution ─────────────────────────────────────────────────────

async function settingsRow(userId: string): Promise<SettingsRow> {
  const db = getDb();
  const rows = await db.select().from(settingsT).where(eq(settingsT.user_id, userId)).limit(1);
  return rows[0] as SettingsRow;
}

/** A user's resolved Coomander settings, falling back to defaults when unset. */
export async function getCoomanderSettings(userId: string): Promise<CoomanderSettingsResolved> {
  const row = await settingsRow(userId);
  return {
    userId,
    nagFrequency: pickNagFrequency(row),
    personaMode: pickPersonaMode(row),
    pingTimesJson: row?.ping_times_json ?? null,
    companionConsentAt: row?.companion_consent_at ?? null,
  };
}

/** Each user the scheduled ping fans out to: opted-in AND with a Telegram chat. */
export async function usersToPing(): Promise<Array<{ userId: string; chatId: string }>> {
  const db = getDb();
  const rows = (await db
    .select({ userId: userT.id, chatId: userT.telegramChatId })
    .from(userT)
    .where(and(eq(userT.coomanderEnabled, 1), isNotNull(userT.telegramChatId)))) as Array<{
    userId: string;
    chatId: string | null;
  }>;
  return rows.filter((r): r is { userId: string; chatId: string } => !!r.chatId);
}

/** Map an inbound Telegram chat id to its user, or null if none matches. */
export async function resolveUserByChatId(chatId: string): Promise<string | null> {
  const db = getDb();
  const rows = (await db
    .select({ id: userT.id })
    .from(userT)
    .where(eq(userT.telegramChatId, chatId))
    .limit(1)) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

// ── Mutations (Settings API) ─────────────────────────────────────────────────

export interface SettingsPatch {
  nagFrequency?: NagFrequency;
  personaMode?: PersonaMode;
  pingTimesJson?: string | null;
}

/** Upsert a user's Coomander settings. Only provided fields change. */
export async function updateCoomanderSettings(
  userId: string,
  patch: SettingsPatch,
): Promise<CoomanderSettingsResolved> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const existing = await settingsRow(userId);

  if (existing) {
    const set: Record<string, unknown> = { updated_at: now };
    if (patch.nagFrequency !== undefined) set.nag_frequency = patch.nagFrequency;
    if (patch.personaMode !== undefined) set.persona_mode = patch.personaMode;
    if (patch.pingTimesJson !== undefined) set.ping_times_json = patch.pingTimesJson;
    await db.update(settingsT).set(set).where(eq(settingsT.user_id, userId));
  } else {
    await db.insert(settingsT).values({
      user_id: userId,
      nag_frequency: patch.nagFrequency ?? DEFAULT_NAG_FREQUENCY,
      persona_mode: patch.personaMode ?? DEFAULT_PERSONA_MODE,
      ping_times_json: patch.pingTimesJson ?? null,
      created_at: now,
      updated_at: now,
    });
  }
  return getCoomanderSettings(userId);
}

/** Generate a UUID (kept here so call sites don't each import crypto). */
export function newId(): string {
  return crypto.randomUUID();
}
