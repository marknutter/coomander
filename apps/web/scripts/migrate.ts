#!/usr/bin/env npx tsx
/**
 * Run pending database migrations.
 * Usage: npx tsx scripts/migrate.ts
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { runMigrations, getMigrationStatus } from "../lib/migrate";
import { bootstrapAuthSchema } from "../lib/auth-schema";

const dbPath = process.env.DATABASE_PATH || "./data/coomander.db";
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000");
db.pragma("foreign_keys = ON");

// Bootstrap Better Auth schema (idempotent) — must exist before app migrations
// that reference the user table via foreign keys.
bootstrapAuthSchema(db);

const { pending } = getMigrationStatus(db);

if (pending.length === 0) {
  console.log("✓ No pending migrations.");
} else {
  console.log(`Running ${pending.length} pending migration(s)...`);
  const applied = runMigrations(db);
  for (const name of applied) {
    console.log(`  ✓ ${name}`);
  }
  console.log(`\n✓ ${applied.length} migration(s) applied successfully.`);
}

db.close();
