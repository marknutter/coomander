#!/usr/bin/env npx tsx
/**
 * Rollback the most recent database migration.
 * Usage: npx tsx scripts/rollback.ts
 */

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { rollbackMigration } from "../lib/migrate";

const dbPath = process.env.DATABASE_PATH || "./data/coomander.db";
const dir = path.dirname(dbPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

try {
  const rolled = rollbackMigration(db);
  if (rolled) {
    console.log(`✓ Rolled back: ${rolled}`);
  } else {
    console.log("Nothing to rollback.");
  }
} catch (error) {
  console.error("Rollback failed:", error instanceof Error ? error.message : error);
  process.exit(1);
}

db.close();
