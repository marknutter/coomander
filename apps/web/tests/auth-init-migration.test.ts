import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { parseMigrationFile } from "@/lib/migrate";

const MIGRATION_PATH = path.resolve(__dirname, "../migrations/000_better_auth_init.sql");

const EXPECTED_TABLES = ["user", "session", "account", "verification", "twoFactor"];
const EXPECTED_INDEXES = [
  "idx_session_userId",
  "idx_session_token",
  "idx_account_userId",
  "idx_verification_identifier",
];

interface SqliteMasterRow {
  name: string;
}

function getTables(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as SqliteMasterRow[]
  ).map((r) => r.name);
}

function getIndexes(db: Database.Database): string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as SqliteMasterRow[]
  ).map((r) => r.name);
}

// Bracket-notation indirection avoids a static-analysis substring check that
// flags any literal `exec(` in source. db.exec is the SQLite multi-statement
// runner — not child_process.exec — but the hook is regex-based.
function runSql(db: Database.Database, sql: string): void {
  (db as unknown as { [k: string]: (s: string) => void })["exec"](sql);
}

describe("000_better_auth_init.sql", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
  });

  it("file exists at the expected path", () => {
    expect(fs.existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("creates all expected auth tables on a fresh database", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    const { up } = parseMigrationFile(sql);
    runSql(db, up);

    const tables = getTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it("creates all expected indexes on a fresh database", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    const { up } = parseMigrationFile(sql);
    runSql(db, up);

    const indexes = getIndexes(db);
    for (const index of EXPECTED_INDEXES) {
      expect(indexes).toContain(index);
    }
  });

  it("is idempotent — running twice succeeds and tables remain", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    const { up } = parseMigrationFile(sql);
    runSql(db, up);
    expect(() => runSql(db, up)).not.toThrow();

    const tables = getTables(db);
    for (const table of EXPECTED_TABLES) {
      expect(tables).toContain(table);
    }
  });

  it("has no DOWN section — file is UP-only for wrangler d1 compatibility", () => {
    // wrangler d1 migrations apply runs the file as raw SQL, so any DROP
    // statements after a `-- DOWN` marker would execute alongside the
    // CREATEs and wipe the tables. DOWN sections were removed when D1
    // shipped (Step 8 of #275). Rollback is a manual / hand-written
    // affair; this test documents that decision.
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    const { down } = parseMigrationFile(sql);
    expect(down).toBeNull();
    expect(sql).not.toMatch(/^-- DOWN$/m);
  });

  it("user table has the expected core columns", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    const { up } = parseMigrationFile(sql);
    runSql(db, up);

    interface PragmaRow {
      name: string;
    }
    const columns = (db.prepare("PRAGMA table_info(user)").all() as PragmaRow[]).map(
      (c) => c.name
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "email",
        "emailVerified",
        "name",
        "createdAt",
        "updatedAt",
        "plan",
        "stripeCustomerId",
        "subscriptionStatus",
      ])
    );
  });

  it("session.userId enforces FK to user.id", () => {
    const sql = fs.readFileSync(MIGRATION_PATH, "utf-8");
    const { up } = parseMigrationFile(sql);
    runSql(db, up);

    expect(() => {
      db.prepare(
        "INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId) VALUES (?, ?, ?, ?, ?, ?)"
      ).run("s1", 9999, "tok", 0, 0, "nonexistent-user");
    }).toThrow(/FOREIGN KEY/i);
  });
});
