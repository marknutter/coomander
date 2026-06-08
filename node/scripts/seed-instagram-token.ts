#!/usr/bin/env npx tsx
/**
 * Seed a platforms row for Instagram using INSTAGRAM_INITIAL_TOKEN from env.
 * Usage:
 *   npx tsx scripts/seed-instagram-token.ts                    # first user in DB
 *   npx tsx scripts/seed-instagram-token.ts user@example.com   # specific user by email
 *
 * The token comes from the Meta dashboard's "Generate token" button (long-lived, 60d).
 * This is the legacy/single-tenant path — OAuth handles multi-user later.
 */

import Database from "better-sqlite3";
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

const dbPath = process.env.DATABASE_PATH || "./data/coomander.db";
const token = process.env.INSTAGRAM_INITIAL_TOKEN;
if (!token) {
  console.error("INSTAGRAM_INITIAL_TOKEN not set in .env.local");
  process.exit(1);
}

const emailArg = process.argv[2];

const db = new Database(dbPath);
db.pragma("foreign_keys = ON");

async function main() {
  const userRow = emailArg
    ? (db.prepare("SELECT id, email FROM user WHERE email = ?").get(emailArg) as { id: string; email: string } | undefined)
    : (db.prepare("SELECT id, email FROM user LIMIT 1").get() as { id: string; email: string } | undefined);

  if (!userRow) {
    console.error(emailArg ? `No user found with email ${emailArg}` : "No users in DB. Sign up first.");
    process.exit(1);
  }

  console.log(`Attaching IG token to user: ${userRow.email} (${userRow.id})`);

  const meRes = await fetch(
    `https://graph.instagram.com/v21.0/me?fields=user_id,username,account_type&access_token=${token}`
  );
  if (!meRes.ok) {
    console.error(`IG /me failed: HTTP ${meRes.status}`, await meRes.text());
    process.exit(1);
  }
  const me = (await meRes.json()) as { user_id: string; username: string; account_type: string };
  console.log(`IG account: @${me.username} (id=${me.user_id}, type=${me.account_type})`);

  const expiresAt = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();

  const existing = db
    .prepare("SELECT id FROM platforms WHERE user_id = ? AND platform = 'instagram'")
    .get(userRow.id) as { id: number } | undefined;

  if (existing) {
    db.prepare(
      `UPDATE platforms
       SET account_id = ?, username = ?, access_token = ?, token_expires_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(me.user_id, me.username, token, expiresAt, existing.id);
    console.log(`Updated existing platforms row (id=${existing.id})`);
  } else {
    const info = db
      .prepare(
        `INSERT INTO platforms (user_id, platform, account_id, username, access_token, token_expires_at)
         VALUES (?, 'instagram', ?, ?, ?, ?)`
      )
      .run(userRow.id, me.user_id, me.username, token, expiresAt);
    console.log(`Inserted platforms row (id=${info.lastInsertRowid})`);
  }

  console.log(`Done. Token good until ${expiresAt}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
