/**
 * Structural drift-guard: every table declared in lib/schema.pg.ts MUST be
 * created by some PostgreSQL migration (migrations-pg/*.sql) or by the Better
 * Auth PG bootstrap (lib/auth-schema.ts → AUTH_SCHEMA_PG_SQL).
 *
 * This prevents the sync #222/#224 regression where 32 of 43 pgTable
 * definitions (admin_logs, plan_overrides, newsletter_subscribers,
 * blog_posts, jobs, files, notifications, webhooks, webhook_deliveries,
 * roles, user_roles, waitlist, invite_codes, platforms, posts,
 * post_analysis, post_insights, account_snapshots, demographics,
 * content_insights, and all the "coomander" ops-agent, "cadence", content
 * state, drops, procurement, and weekly-review tables) existed in the
 * schema but had no CREATE TABLE in migrations-pg/, so a PG deploy 500'd
 * on every query against them.
 *
 * If you add a `pgTable("foo", …)` to schema.pg.ts, you MUST also add a
 * `CREATE TABLE … foo` to a migrations-pg/*.sql file (or the auth bootstrap)
 * or this test fails.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const WEB_ROOT = path.resolve(__dirname, "..");
const SCHEMA_PG = path.join(WEB_ROOT, "lib", "schema.pg.ts");
const AUTH_SCHEMA = path.join(WEB_ROOT, "lib", "auth-schema.ts");
const MIGRATIONS_PG_DIR = path.join(WEB_ROOT, "migrations-pg");

// Tables the migration *runner itself* creates (not a schema or bootstrap
// concern). `_migrations` is the tracking table created by runMigrationsPg().
const RUNNER_CREATED = new Set<string>(["_migrations"]);

/** Extract every pgTable("name", …) name from schema.pg.ts. */
function parsePgTableNames(): Set<string> {
  const src = fs.readFileSync(SCHEMA_PG, "utf-8");
  const names = new Set<string>();
  const re = /pgTable\(\s*["'`]([a-zA-Z_][a-zA-Z0-9_]*)["'`]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/** Extract every CREATE TABLE name from a chunk of SQL (handles quoted +
 * unquoted identifiers and IF NOT EXISTS). */
function parseCreateTableNames(sql: string): Set<string> {
  const names = new Set<string>();
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["'`]?([a-zA-Z_][a-zA-Z0-9_]*)["'`]?/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    names.add(m[1]);
  }
  return names;
}

/** All table names created by any migrations-pg/*.sql file. */
function parseMigrationCreatedTables(): Set<string> {
  const created = new Set<string>();
  const files = fs
    .readdirSync(MIGRATIONS_PG_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_PG_DIR, f), "utf-8");
    for (const name of parseCreateTableNames(sql)) created.add(name);
  }
  return created;
}

/** Tables created by the Better Auth PG bootstrap (AUTH_SCHEMA_PG_SQL). */
function parseAuthBootstrapTables(): Set<string> {
  const src = fs.readFileSync(AUTH_SCHEMA, "utf-8");
  // Isolate the PG bootstrap block so we don't pick up the SQLite block.
  const pgBlockMatch = src.match(/AUTH_SCHEMA_PG_SQL\s*=\s*`([\s\S]*?)`/);
  const block = pgBlockMatch ? pgBlockMatch[1] : "";
  return parseCreateTableNames(block);
}

describe("PG schema ↔ migration parity", () => {
  it("parses a sane number of pgTable definitions", () => {
    const tables = parsePgTableNames();
    // 43 tables in schema.pg.ts at time of writing; guard against a regex break.
    expect(tables.size).toBeGreaterThanOrEqual(40);
  });

  it("every pgTable in schema.pg.ts is created by a PG migration or the auth bootstrap", () => {
    const schemaTables = parsePgTableNames();
    const migrationTables = parseMigrationCreatedTables();
    const authTables = parseAuthBootstrapTables();

    const createdSomewhere = new Set<string>([
      ...migrationTables,
      ...authTables,
      ...RUNNER_CREATED,
    ]);

    const missing = [...schemaTables].filter((t) => !createdSomewhere.has(t)).sort();

    expect(
      missing,
      `These tables are declared in lib/schema.pg.ts but no migrations-pg/*.sql ` +
        `(or auth bootstrap) creates them: ${missing.join(", ")}. ` +
        `Add a CREATE TABLE for each to migrations-pg/.`
    ).toEqual([]);
  });

  it("explicitly covers the 32 previously-missing tables (sync #222/#224)", () => {
    const migrationTables = parseMigrationCreatedTables();
    const previouslyMissing = [
      "admin_logs",
      "plan_overrides",
      "newsletter_subscribers",
      "blog_posts",
      "jobs",
      "files",
      "notifications",
      "webhooks",
      "webhook_deliveries",
      "roles",
      "user_roles",
      "waitlist",
      "invite_codes",
      "platforms",
      "posts",
      "post_analysis",
      "post_insights",
      "account_snapshots",
      "demographics",
      "content_insights",
      "coomander_settings",
      "coomander_link_codes",
      "coomander_message_log",
      "coomander_usage",
      "coomander_day_state",
      "coomander_dedup",
      "cadence_pillars",
      "cadence_beats",
      "content_states",
      "drops",
      "procurement_items",
      "weekly_reviews",
    ];
    for (const t of previouslyMissing) {
      expect(migrationTables.has(t), `migrations-pg/ must create "${t}"`).toBe(true);
    }
  });
});
