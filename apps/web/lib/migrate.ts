/**
 * Database migration system for app-specific tables.
 *
 * Better Auth manages its own tables (user, session, account, etc.)
 * via its CLI. This system handles app tables like items, notifications, etc.
 *
 * Migrations live in the `migrations/` directory (SQLite) or `migrations-pg/`
 * directory (PostgreSQL) as timestamped SQL files:
 *   migrations/001_create_items.sql
 *   migrations/002_add_item_tags.sql
 *
 * Each file contains an UP section and optional DOWN section separated by
 * a `-- DOWN` comment marker.
 *
 * Usage:
 *   import { runMigrations, rollbackMigration } from "@/lib/migrate";
 *
 *   // Run all pending migrations (SQLite — synchronous):
 *   runMigrations(db);
 *
 *   // Run all pending migrations (PG — async):
 *   await runMigrationsPg(adapter);
 */

// Type-only import — better-sqlite3's native binding is not loaded just by
// importing this module. The migration runner is only invoked from the
// SQLite branch of lib/db.ts (initSqliteDb), which the D1/PG paths skip.
import type Database from "better-sqlite3";
import fs from "fs";
import path from "path";

export interface MigrationRecord {
  id: number;
  name: string;
  applied_at: string;
}

export interface MigrationFile {
  name: string;
  up: string;
  down: string | null;
}

/**
 * Get the migrations directory for the current dialect.
 */
function getMigrationsDir(dialect: "sqlite" | "pg" = "sqlite"): string {
  const dirName = dialect === "pg" ? "migrations-pg" : "migrations";
  return path.resolve(process.cwd(), dirName);
}

/**
 * Ensure the migrations tracking table exists.
 */
export function ensureMigrationsTable(db: InstanceType<typeof Database>): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

/**
 * Parse a migration file into UP and DOWN sections.
 * The DOWN section is optional and delimited by a line starting with "-- DOWN".
 */
export function parseMigrationFile(content: string): { up: string; down: string | null } {
  const downMarker = /^-- DOWN$/m;
  const match = content.match(downMarker);

  if (match && match.index !== undefined) {
    const up = content.slice(0, match.index).trim();
    const down = content.slice(match.index + match[0].length).trim();
    return { up, down: down || null };
  }

  return { up: content.trim(), down: null };
}

/**
 * Load all migration files from the migrations directory, sorted by name.
 */
export function loadMigrationFiles(dialect: "sqlite" | "pg" = "sqlite"): MigrationFile[] {
  const migrationsDir = getMigrationsDir(dialect);

  if (!fs.existsSync(migrationsDir)) {
    return [];
  }

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  return files.map((filename) => {
    const content = fs.readFileSync(path.join(migrationsDir, filename), "utf-8");
    const { up, down } = parseMigrationFile(content);
    return { name: filename, up, down };
  });
}

/**
 * Get list of already-applied migrations from the database (SQLite).
 */
export function getAppliedMigrations(db: InstanceType<typeof Database>): MigrationRecord[] {
  ensureMigrationsTable(db);
  return db.prepare("SELECT * FROM _migrations ORDER BY id ASC").all() as MigrationRecord[];
}

/**
 * Run all pending migrations (those not yet applied) — SQLite.
 * Returns the list of newly applied migration names.
 */
export function runMigrations(db: InstanceType<typeof Database>): string[] {
  ensureMigrationsTable(db);

  const applied = new Set(getAppliedMigrations(db).map((m) => m.name));
  const allFiles = loadMigrationFiles("sqlite");
  const pending = allFiles.filter((f) => !applied.has(f.name));

  if (pending.length === 0) {
    return [];
  }

  const appliedNames: string[] = [];

  for (const migration of pending) {
    db.transaction(() => {
      db.exec(migration.up);
      db.prepare("INSERT INTO _migrations (name) VALUES (?)").run(migration.name);
    })();
    appliedNames.push(migration.name);
  }

  return appliedNames;
}

/**
 * Rollback the most recently applied migration — SQLite.
 * Returns the name of the rolled-back migration, or null if nothing to rollback.
 */
export function rollbackMigration(db: InstanceType<typeof Database>): string | null {
  ensureMigrationsTable(db);

  const latest = db
    .prepare("SELECT * FROM _migrations ORDER BY id DESC LIMIT 1")
    .get() as MigrationRecord | undefined;

  if (!latest) {
    return null;
  }

  // Find the corresponding migration file
  const allFiles = loadMigrationFiles("sqlite");
  const migrationFile = allFiles.find((f) => f.name === latest.name);

  if (!migrationFile || !migrationFile.down) {
    throw new Error(
      `Cannot rollback migration "${latest.name}": no DOWN section found in migration file`
    );
  }

  db.transaction(() => {
    db.exec(migrationFile.down!);
    db.prepare("DELETE FROM _migrations WHERE id = ?").run(latest.id);
  })();

  return latest.name;
}

/**
 * Get migration status: which are applied, which are pending — SQLite.
 */
export function getMigrationStatus(db: InstanceType<typeof Database>): {
  applied: MigrationRecord[];
  pending: string[];
} {
  ensureMigrationsTable(db);

  const applied = getAppliedMigrations(db);
  const appliedNames = new Set(applied.map((m) => m.name));
  const allFiles = loadMigrationFiles("sqlite");
  const pending = allFiles.filter((f) => !appliedNames.has(f.name)).map((f) => f.name);

  return { applied, pending };
}

// ─── PostgreSQL migration support ───────────────────────────────────────────

import type { RawDbAdapter } from "./db-raw";

/**
 * Run all pending PG migrations using the raw adapter.
 */
export async function runMigrationsPg(adapter: RawDbAdapter): Promise<string[]> {
  // Ensure _migrations table exists
  await adapter.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT DEFAULT now()::text
    )
  `);

  const applied = await adapter.queryAll<MigrationRecord>(
    "SELECT * FROM _migrations ORDER BY id ASC"
  );
  const appliedNames = new Set(applied.map((m) => m.name));

  const allFiles = loadMigrationFiles("pg");
  const pending = allFiles.filter((f) => !appliedNames.has(f.name));

  if (pending.length === 0) {
    return [];
  }

  const result: string[] = [];

  for (const migration of pending) {
    await adapter.transaction(async (tx) => {
      // PG migrations may contain multiple statements
      await tx.run(migration.up);
      await tx.run("INSERT INTO _migrations (name) VALUES (?)", migration.name);
    });
    result.push(migration.name);
  }

  return result;
}
