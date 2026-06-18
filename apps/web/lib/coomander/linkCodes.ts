/**
 * In-app Telegram link flow (#185).
 *
 * A logged-in creator mints a one-time code; they send it (or tap a
 * `t.me/<bot>?start=<code>` deep link → `/start <code>`) to @coomander_bot; the
 * webhook calls consumeLinkCode, which binds their chat to their account by
 * setting `user.telegramChatId`. No DB access required to onboard a creator's
 * comms channel. Ported from geology's channel_link_codes flow (#55).
 */

import crypto from "crypto";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { coomanderLinkCodes as codeT, user as userT } from "@/lib/schema";

export const LINK_CODE_TTL_SECONDS = 15 * 60; // 15 minutes
export const COOMANDER_BOT_USERNAME = process.env.COOMANDER_BOT_USERNAME || "coomander_bot";

// Unambiguous alphabet (no 0/O/1/I) so a creator can read/type the code.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(len = 7): string {
  const bytes = crypto.randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export interface LinkCode {
  code: string;
  expiresAt: number;
}

/** Mint a fresh one-time link code for a user (replacing any prior code). */
export async function createLinkCode(userId: string): Promise<LinkCode> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + LINK_CODE_TTL_SECONDS;
  await db.delete(codeT).where(eq(codeT.user_id, userId));
  const code = randomCode();
  await db.insert(codeT).values({ code, user_id: userId, expires_at: expiresAt, created_at: now });
  return { code, expiresAt };
}

/** Normalize inbound text to a candidate code: strips a `/start ` prefix (the
 *  deep-link payload) and uppercases. Returns "" when there's no plausible code. */
function extractCode(text: string): string {
  let raw = text.trim();
  if (raw.toLowerCase().startsWith("/start")) raw = raw.slice("/start".length).trim();
  // A code is a single token of our alphabet; reject anything with spaces.
  if (/\s/.test(raw)) return "";
  return raw.toUpperCase();
}

/**
 * If `text` is a valid, unexpired link code, bind `chatId` to that user
 * (`user.telegramChatId`), delete the code, and return the userId. Otherwise a
 * no-op returning null (so normal inbound messages fall through). Single-use.
 */
export async function consumeLinkCode(text: string, chatId: string): Promise<string | null> {
  const code = extractCode(text);
  if (!code) return null;
  const db = getDb();
  const rows = (await db
    .select({ user_id: codeT.user_id, expires_at: codeT.expires_at })
    .from(codeT)
    .where(eq(codeT.code, code))
    .limit(1)) as Array<{ user_id: string; expires_at: number }>;
  const row = rows[0];
  if (!row) return null;
  // Always delete the matched code (single-use), even if expired.
  await db.delete(codeT).where(eq(codeT.code, code));
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  await db.update(userT).set({ telegramChatId: chatId }).where(eq(userT.id, row.user_id));
  return row.user_id;
}

/** Disconnect a user's Telegram (clears the chat id + any pending code). */
export async function unlinkTelegram(userId: string): Promise<void> {
  const db = getDb();
  await db.update(userT).set({ telegramChatId: null }).where(eq(userT.id, userId));
  await db.delete(codeT).where(eq(codeT.user_id, userId));
}

/** The t.me deep link that pre-fills `/start <code>` when tapped. */
export function deepLink(code: string): string {
  return `https://t.me/${COOMANDER_BOT_USERNAME}?start=${code}`;
}
