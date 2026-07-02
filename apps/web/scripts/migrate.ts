#!/usr/bin/env npx tsx
/**
 * Run pending database migrations.
 * Usage: npx tsx scripts/migrate.ts
 *
 * Dialect-aware: matches lib/db-dialect.ts detection.
 *   - DATABASE_URL=postgres://…  → PostgreSQL (migrations-pg/*.sql)
 *   - otherwise                  → local better-sqlite3 (migrations/*.sql)
 *
 * (Cloudflare D1 is migrated separately via `wrangler d1 migrations apply`,
 * not through this script.)
 */

import { isPg } from "../lib/db-dialect";
import type { RawDbAdapter } from "../lib/db-raw";

async function migrateSqlite(): Promise<void> {
  // Dynamic imports so the better-sqlite3 native binding is only loaded on the
  // SQLite path (never on a Postgres deploy that may not have it installed).
  const { default: Database } = await import("better-sqlite3");
  const path = await import("path");
  const fs = await import("fs");
  const { runMigrations, getMigrationStatus } = await import("../lib/migrate");
  const { bootstrapAuthSchema } = await import("../lib/auth-schema");

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
}

// Minimal pg query function shape (subset of node-postgres Pool/Client).
type PgQuery = (sql: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number | null }>;

interface PgPoolLike {
  query: PgQuery;
  connect(): Promise<PgClientLike>;
  end(): Promise<void>;
}

interface PgClientLike {
  query: PgQuery;
  release(): void;
}

// `?`-placeholder → `$1, $2, …` conversion, matching lib/db-raw-pg.ts.
function pgify(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

/**
 * Build a RawDbAdapter over a pg query function. runMigrationsPg only uses
 * run(), queryAll(), and transaction() (whose tx exposes run()); the rest of
 * the RawDbAdapter surface is stubbed so the script doesn't depend on
 * getDb()/getPgPool() (which would also boot crons + job registration).
 */
function makePgAdapter(pool: PgPoolLike): RawDbAdapter {
  const fromQuery = (q: PgQuery): RawDbAdapter => ({
    async run(sql: string, ...params: unknown[]) {
      const result = await q(pgify(sql), params);
      return { changes: result.rowCount ?? 0 };
    },
    async queryAll<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      const result = await q(pgify(sql), params);
      return result.rows as T[];
    },
    async queryFirst<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const result = await q(pgify(sql), params);
      return result.rows[0] as T | undefined;
    },
    async transaction<T>(fn: (a: RawDbAdapter) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const out = await fn(fromQuery((sql, params) => client.query(sql, params)));
        await client.query("COMMIT");
        return out;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
    // Unused-by-migrations members — present to satisfy the RawDbAdapter shape.
    healthCheck: async () => true,
    tableExists: async () => false,
    listTables: async () => [],
    getTableColumns: async () => [],
    getTableNames: async () => new Set<string>(),
    searchItems: async () => [],
    rebuildSearchIndex: async () => {},
  });

  return fromQuery((sql, params) => pool.query(sql, params));
}

async function migratePg(): Promise<void> {
  // Dynamic imports — `pg` is an optional dependency for SQLite-only installs.
  const { Pool } = await import("pg");
  const { runMigrationsPg } = await import("../lib/migrate");
  const { bootstrapAuthSchemaPg } = await import("../lib/auth-schema");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL }) as unknown as PgPoolLike;

  try {
    // Bootstrap Better Auth schema (idempotent) before app migrations that FK
    // to the user table. bootstrapAuthSchemaPg expects something with .query().
    await bootstrapAuthSchemaPg(pool);

    const adapter = makePgAdapter(pool);
    const applied = await runMigrationsPg(adapter);

    if (applied.length === 0) {
      console.log("✓ No pending migrations.");
    } else {
      console.log(`Running ${applied.length} pending migration(s)...`);
      for (const name of applied) {
        console.log(`  ✓ ${name}`);
      }
      console.log(`\n✓ ${applied.length} migration(s) applied successfully.`);
    }
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (isPg()) {
    console.log("Dialect: PostgreSQL (migrations-pg/)");
    await migratePg();
  } else {
    console.log("Dialect: SQLite (migrations/)");
    await migrateSqlite();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  }
);
