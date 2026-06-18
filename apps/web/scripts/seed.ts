#!/usr/bin/env npx tsx
/**
 * Seed development data.
 * Usage: npx tsx scripts/seed.ts   (or: npm run db:seed)
 *
 * Milestone 1 (#151): enable Coomander for the dev admin user so the cron /
 * `POST /api/coomander/run` end-to-end test has a recipient.
 *
 * Prereq: a user must exist. The dev admin (admin@example.com) is auto-created
 * on first app boot (lib/db.ts seedDefaultAdmin). If you see "No users found",
 * boot the app once (docker compose up) then re-run this script.
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

const dbPath = process.env.DATABASE_PATH || "./data/coomander.db";
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Prefer the dev admin; fall back to the first user.
const user =
  (db.prepare("SELECT id, email FROM user WHERE email = 'admin@example.com'").get() as
    | { id: string; email: string }
    | undefined) ??
  (db.prepare("SELECT id, email FROM user LIMIT 1").get() as
    | { id: string; email: string }
    | undefined);

if (!user) {
  console.error("No users found. Boot the app once (docker compose up) to create admin@example.com, then re-run.");
  process.exit(1);
}

console.log(`Seeding Coomander dev data for: ${user.email} (${user.id})`);

// Mark's Telegram chat_id (docs/strategy/next-session-brief.md §3.3) + opt-in.
const MADDIE_TELEGRAM_CHAT_ID = "5393209237";

db.prepare(
  "UPDATE user SET telegramChatId = ?, coomanderEnabled = 1 WHERE id = ?"
).run(MADDIE_TELEGRAM_CHAT_ID, user.id);

// Default settings row (tight nag, light-companion persona) — idempotent.
const now = Math.floor(Date.now() / 1000);
db.prepare(
  `INSERT OR IGNORE INTO coomander_settings
     (user_id, nag_frequency, persona_mode, created_at, updated_at)
   VALUES (?, 'tight', 'light_companion', ?, ?)`
).run(user.id, now, now);

console.log(`✓ Coomander enabled (telegramChatId=${MADDIE_TELEGRAM_CHAT_ID}, nag=tight, persona=light_companion).`);

db.close();
