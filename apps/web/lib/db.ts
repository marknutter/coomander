// Type-only imports — erased at compile time, so neither better-sqlite3's
// native binding nor drizzle-orm's better-sqlite3 driver is loaded at
// module init. The runtime equivalents are dynamically `require`'d inside
// the SQLite-only init paths below, which the D1/PG paths never reach.
import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import crypto from "crypto";
import path from "path";
import fs from "fs";
import { bootstrapAuthSchema } from "./auth-schema";
import { runMigrations } from "./migrate";
import { isPg, isD1 } from "./db-dialect";
import * as sqliteSchema from "./schema.sqlite";
// Static import — ES module cycle is safe here because jobs/index.ts only
// calls getDb() inside function bodies (at job execution time), not at
// module load. Vitest can resolve this; require("@/jobs/index") cannot.
import { registerBuiltinJobs, startBuiltinCrons } from "@/jobs/index";

/**
 * The consumer-facing DB type. SQLite is the canonical type.
 * When running PG or D1, the instance is cast to this type — at runtime,
 * Drizzle generates correct dialect SQL regardless of the schema object types.
 */
export type AppDatabase = BetterSQLite3Database<typeof sqliteSchema>;

/**
 * Minimal shape of a Cloudflare D1 binding, matching `@cloudflare/workers-types`.
 * Typed loosely here so this file does not need a hard workers-types dep
 * for non-Workers builds. The real binding is supplied by the Workers
 * runtime via setD1Binding() — Step 7 wires that from @opennextjs/cloudflare.
 */
export interface D1Binding {
  prepare: (query: string) => unknown;
  exec: (query: string) => unknown;
  batch: (...args: unknown[]) => unknown;
}

let rawDb: InstanceType<typeof Database> | null = null;
let drizzleDb: AppDatabase | null = null;
let pgPool: unknown = null;
let d1Binding: D1Binding | null = null;

/**
 * Get the raw better-sqlite3 instance.
 * Use this for FTS5, PRAGMA, sqlite_master, and other SQLite-specific queries
 * that Drizzle cannot express.
 *
 * Throws if running against PostgreSQL or D1 — those drivers don't expose
 * the better-sqlite3 sync API.
 */
export function getRawDb(): InstanceType<typeof Database> {
  if (isPg()) {
    throw new Error("getRawDb() is not available when using PostgreSQL. Use getRawAdapter() instead.");
  }
  if (isD1()) {
    throw new Error("getRawDb() is not available when using D1. D1 prepared statements are async — use the D1 binding directly via getD1Binding().");
  }
  return initSqliteDb();
}

/**
 * Get the Drizzle ORM database instance.
 * Works for SQLite (better-sqlite3), PostgreSQL, and Cloudflare D1.
 */
export function getDb(): AppDatabase {
  if (drizzleDb) return drizzleDb;

  if (isD1()) {
    return initD1Db();
  }
  if (isPg()) {
    return initPgDb();
  }
  // Dynamic require so the better-sqlite3 native binding is not loaded on
  // the D1/PG paths. drizzle-orm/better-sqlite3 transitively requires
  // better-sqlite3 itself.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: drizzleSqlite } = require("drizzle-orm/better-sqlite3");
  const raw = initSqliteDb();
  drizzleDb = drizzleSqlite(raw, { schema: sqliteSchema });
  return drizzleDb!;
}

/**
 * Get the PG pool instance (for raw PG queries in Phase 4).
 * Returns null if not using PostgreSQL.
 */
export function getPgPool(): unknown {
  return pgPool;
}

/**
 * Provide the D1 binding for the current request/process.
 *
 * On Cloudflare Workers the binding is request-scoped (lives on `env.DB`),
 * not a process-level pool — so a runtime adapter must call this before
 * the first getDb() of each request. Step 7 of #275 wires this from
 * `@opennextjs/cloudflare`'s getCloudflareContext().
 *
 * Calling with `null` clears the cached Drizzle instance, which is useful
 * for tests and for Workers contexts that need to swap bindings between
 * requests on the same isolate.
 */
export function setD1Binding(binding: D1Binding | null): void {
  d1Binding = binding;
  if (drizzleDb) {
    // Drop the cached Drizzle instance so the next getDb() rebuilds against the new binding.
    drizzleDb = null;
  }
}

/** Returns the currently set D1 binding, or null if none has been provided. */
export function getD1Binding(): D1Binding | null {
  return d1Binding;
}

// ─── SQLite initialization ──────────────────────────────────────────────────

function initSqliteDb(): InstanceType<typeof Database> {
  if (rawDb) return rawDb;

  const dbPath = process.env.DATABASE_PATH || "./data/coomander.db";
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  // Dynamic require keeps the native better-sqlite3 binding out of the
  // Workers bundle. lib/migrate.ts is type-only for better-sqlite3, so it
  // can be imported statically (above) without triggering the native load.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DatabaseCtor = require("better-sqlite3");

  const db: InstanceType<typeof Database> = new DatabaseCtor(dbPath);
  // WAL mode doesn't work reliably through Docker bind mounts on macOS.
  // Use DELETE journal mode in dev, WAL in prod (which uses a Docker volume).
  db.pragma(process.env.NODE_ENV === "production" ? "journal_mode = WAL" : "journal_mode = DELETE");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  // Initialize Better Auth schema (idempotent — safe on every startup).
  bootstrapAuthSchema(db);

  // Run any pending app-specific migrations (migrations/*.sql).
  runMigrations(db);

  // Register built-in job handlers (always — so processJobs works from any entry point).
  registerBuiltinJobs();

  // Start in-process cron scheduler only when explicitly enabled
  // (avoids running during build or in serverless environments).
  if (process.env.ENABLE_CRON === "true") {
    startBuiltinCrons();
  }

  // Bootstrap admin users from ADMIN_EMAILS env var
  bootstrapAdminUsers(db);

  // Seed default admin user
  seedDefaultAdmin(db);

  rawDb = db;
  return db;
}


function bootstrapAdminUsers(db: InstanceType<typeof Database>): void {
  const adminEmails = process.env.ADMIN_EMAILS;
  if (adminEmails) {
    const emails = adminEmails.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
    // Sync the Better Auth admin-plugin `role` alongside isAdmin: the plugin's
    // ban gate (session.create.before hook) keys off user.role ∈ adminRoles,
    // our app keys off isAdmin, so they must stay in lockstep wherever an
    // admin is granted.
    const stmt = db.prepare("UPDATE user SET isAdmin = 1, role = 'admin' WHERE LOWER(email) = ? AND isAdmin = 0");
    for (const email of emails) {
      stmt.run(email);
    }
  }
}

function seedDefaultAdmin(db: InstanceType<typeof Database>): void {
  // Only seed default admin in development — never in production.
  if (process.env.NODE_ENV === "production") return;

  const existingAdmin = db.prepare("SELECT id FROM user WHERE email = 'admin@example.com'").get();
  if (!existingAdmin) {
    const userId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const salt = crypto.randomBytes(16).toString("hex");
    const key = crypto.scryptSync("password", salt, 64, { N: 16384, r: 16, p: 1, maxmem: 128 * 16384 * 16 * 2 });
    const passwordHash = `${salt}:${key.toString("hex")}`;

    db.prepare(
      `INSERT INTO user (id, email, emailVerified, name, createdAt, updatedAt, isAdmin, role, plan, subscriptionStatus)
       VALUES (?, 'admin@example.com', 1, 'Admin', ?, ?, 1, 'admin', 'free', 'inactive')`
    ).run(userId, now, now);

    db.prepare(
      `INSERT INTO account (id, accountId, providerId, userId, password)
       VALUES (?, ?, 'credential', ?, ?)`
    ).run(accountId, userId, userId, passwordHash);
  }
}

// ─── PostgreSQL initialization ──────────────────────────────────────────────

function initPgDb(): AppDatabase {
  if (drizzleDb) return drizzleDb;

  // Dynamic imports for PG — these packages are optional for SQLite-only installs
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: drizzlePg } = require("drizzle-orm/node-postgres");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const pgSchema = require("./schema.pg");

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  pgPool = pool;

  drizzleDb = drizzlePg(pool, { schema: pgSchema }) as unknown as AppDatabase;

  // Register built-in job handlers
  const { registerBuiltinJobs, startBuiltinCrons } = require("@/jobs/index");
  registerBuiltinJobs();

  if (process.env.ENABLE_CRON === "true") {
    startBuiltinCrons();
  }

  return drizzleDb;
}

// ─── D1 initialization ──────────────────────────────────────────────────────

/**
 * Schema and admin seeding are NOT bootstrapped at runtime on the D1 path.
 *
 * D1 runs in Cloudflare Workers — cold-starts hundreds of times per second,
 * and its API is async-only. So:
 *
 * - Schema: `node/migrations/000_better_auth_init.sql` and the rest of
 *   `node/migrations/*.sql` are pre-applied via `wrangler d1 migrations apply`
 *   at deploy time. See Step 5 of #275.
 * - Admin seeding: a one-off wrangler-driven UPDATE post-deploy, not a
 *   per-request boot step.
 *
 * If a D1 deploy starts erroring with "no such table: user", the migrations
 * weren't applied — re-run wrangler against the target D1 database.
 */
/**
 * Resolve the D1 binding for this request.
 *
 * Resolution order:
 *   1. An explicit binding set via setD1Binding() (used by tests).
 *   2. The Cloudflare Workers runtime context, accessed via
 *      `getCloudflareContext().env.DB`. This is the production path —
 *      no external setup needed; @opennextjs/cloudflare populates the
 *      context on every Worker request.
 *
 * Returns null when neither source has a binding (e.g. running under
 * Vitest without a manual setD1Binding call). Caller should throw a
 * helpful error in that case.
 */
export function resolveD1Binding(): D1Binding | null {
  if (d1Binding) return d1Binding;
  try {
    // Dynamic require so non-Workers builds (Vercel target) don't try to
    // resolve @opennextjs/cloudflare at module load.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    return (ctx?.env?.DB as D1Binding | undefined) ?? null;
  } catch {
    // @opennextjs/cloudflare not available or not in a Workers request.
    return null;
  }
}

function initD1Db(): AppDatabase {
  if (drizzleDb) return drizzleDb;

  const binding = resolveD1Binding();
  if (!binding) {
    throw new Error(
      "D1 binding not available. On Cloudflare Workers, @opennextjs/cloudflare's " +
        "getCloudflareContext().env.DB should provide it automatically — " +
        "ensure DATABASE_DRIVER=d1 is set and the wrangler.toml D1 binding " +
        "is named 'DB'. For tests, pass a mock binding via setD1Binding()."
    );
  }

  // Dynamic imports for D1 — Drizzle's D1 driver is included in `drizzle-orm`
  // but we keep the import dynamic so non-Workers builds don't pull workers-types
  // into their resolution graph.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { drizzle: drizzleD1 } = require("drizzle-orm/d1");
  // D1's schema is structurally identical to schema.sqlite — re-exported via schema.d1.ts.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const d1Schema = require("./schema.d1");

  drizzleDb = drizzleD1(binding, { schema: d1Schema }) as unknown as AppDatabase;

  // Register built-in job handlers
  registerBuiltinJobs();

  if (process.env.ENABLE_CRON === "true") {
    startBuiltinCrons();
  }

  return drizzleDb;
}
