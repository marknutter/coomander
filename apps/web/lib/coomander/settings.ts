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
import { DEFAULT_TIMEZONE, todayLocal } from "./consistency";
import { user as userT, coomanderSettings as settingsT } from "@/lib/schema";

// "off" fully silences scheduled pings (no slot fires); see PRESET_SLOTS /
// planPing in agent.ts. It is opt-in — DEFAULT_NAG_FREQUENCY stays "tight".
export type NagFrequency = "off" | "light" | "moderate" | "tight";
export type PersonaMode = "light_companion" | "full_companion" | "operational";

// Ordered least → most frequent (the cadence-pings UI renders them in this order).
export const NAG_FREQUENCIES: NagFrequency[] = ["off", "light", "moderate", "tight"];
export const PERSONA_MODES: PersonaMode[] = ["light_companion", "full_companion", "operational"];

export const DEFAULT_NAG_FREQUENCY: NagFrequency = "tight";
export const DEFAULT_PERSONA_MODE: PersonaMode = "light_companion";

export interface CoomanderSettingsResolved {
  userId: string;
  nagFrequency: NagFrequency;
  personaMode: PersonaMode;
  /** IANA timezone for the creator's local day boundary (#183). */
  timezone: string;
  pingTimesJson: string | null;
  companionConsentAt: number | null;
  opsSeededAt: number | null;
  defaultsBannerDismissedAt: number | null;
}

// ── Pure pickers (no DB) ─────────────────────────────────────────────────────

type SettingsRow =
  | {
      nag_frequency?: string | null;
      persona_mode?: string | null;
      timezone?: string | null;
      ping_times_json?: string | null;
      companion_consent_at?: number | null;
      ops_seeded_at?: number | null;
      defaults_banner_dismissed_at?: number | null;
    }
  | undefined;

export function pickTimezone(row: SettingsRow): string {
  const v = (row?.timezone ?? "").trim();
  return v.length > 0 ? v : DEFAULT_TIMEZONE;
}

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
    timezone: pickTimezone(row),
    pingTimesJson: row?.ping_times_json ?? null,
    companionConsentAt: row?.companion_consent_at ?? null,
    opsSeededAt: row?.ops_seeded_at ?? null,
    defaultsBannerDismissedAt: row?.defaults_banner_dismissed_at ?? null,
  };
}

/** A user's resolved IANA timezone (falls back to DEFAULT_TIMEZONE). */
export async function getTimezone(userId: string): Promise<string> {
  return pickTimezone(await settingsRow(userId));
}

/** The creator's "today" (YYYY-MM-DD) in their local timezone (#183). */
export async function userToday(userId: string): Promise<string> {
  return todayLocal(await getTimezone(userId));
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
  timezone?: string;
  pingTimesJson?: string | null;
  /** When true, stamp defaults_banner_dismissed_at = now. */
  dismissBanner?: boolean;
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
    if (patch.timezone !== undefined) set.timezone = patch.timezone;
    if (patch.pingTimesJson !== undefined) set.ping_times_json = patch.pingTimesJson;
    if (patch.dismissBanner) set.defaults_banner_dismissed_at = now;
    await db.update(settingsT).set(set).where(eq(settingsT.user_id, userId));
  } else {
    await db.insert(settingsT).values({
      user_id: userId,
      nag_frequency: patch.nagFrequency ?? DEFAULT_NAG_FREQUENCY,
      persona_mode: patch.personaMode ?? DEFAULT_PERSONA_MODE,
      timezone: patch.timezone ?? null,
      ping_times_json: patch.pingTimesJson ?? null,
      defaults_banner_dismissed_at: patch.dismissBanner ? now : null,
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
