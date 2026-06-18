import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import {
  ensureMigrationsTable,
  parseMigrationFile,
  runMigrations,
  rollbackMigration,
  getMigrationStatus,
  getAppliedMigrations,
  loadMigrationFiles,
  type MigrationFile,
} from "@/lib/migrate";

const TEST_DB = "./data/test-migrate.db";

function cleanupDb() {
  for (const ext of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TEST_DB + ext); } catch { /* ignore */ }
  }
}

// Helper to temporarily mock loadMigrationFiles
function withMockMigrations(files: MigrationFile[], fn: () => void) {
  const original = loadMigrationFiles;
  // Replace the function on the module — we use vi.spyOn on the imported module
  const spy = vi.spyOn({ loadMigrationFiles }, "loadMigrationFiles").mockReturnValue(files);
  // Since we can't easily spy on named exports, we'll use a different approach:
  // Directly manipulate the migrations directory with temp files
  fn();
  spy.mockRestore();
}

describe("Migration System", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    cleanupDb();
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    db = new Database(TEST_DB);
    db.pragma("journal_mode = WAL");
  });

  afterEach(() => {
    db.close();
    cleanupDb();
  });

  describe("ensureMigrationsTable", () => {
    it("should create _migrations table", () => {
      ensureMigrationsTable(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
        .all();
      expect(tables).toHaveLength(1);
    });

    it("should be idempotent", () => {
      ensureMigrationsTable(db);
      ensureMigrationsTable(db);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
        .all();
      expect(tables).toHaveLength(1);
    });
  });

  describe("parseMigrationFile", () => {
    it("should parse UP-only migration", () => {
      const content = "CREATE TABLE foo (id TEXT PRIMARY KEY);";
      const { up, down } = parseMigrationFile(content);
      expect(up).toBe("CREATE TABLE foo (id TEXT PRIMARY KEY);");
      expect(down).toBeNull();
    });

    it("should parse UP and DOWN sections", () => {
      const content = `CREATE TABLE foo (id TEXT PRIMARY KEY);

-- DOWN

DROP TABLE foo;`;
      const { up, down } = parseMigrationFile(content);
      expect(up).toBe("CREATE TABLE foo (id TEXT PRIMARY KEY);");
      expect(down).toBe("DROP TABLE foo;");
    });

    it("should handle empty DOWN section", () => {
      const content = `CREATE TABLE foo (id TEXT PRIMARY KEY);

-- DOWN
`;
      const { up, down } = parseMigrationFile(content);
      expect(up).toBe("CREATE TABLE foo (id TEXT PRIMARY KEY);");
      expect(down).toBeNull();
    });
  });

  describe("runMigrations with real files", () => {
    it("should run the actual migration files from migrations/ dir", () => {
      // Better Auth creates the user table at runtime; tests need it up front
      // because some migrations reference user(id) via FK.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL
        );
      `);

      const applied = runMigrations(db);
      expect(applied).toContain("002_add_admin.sql");

      // Verify a table from one of the applied migrations was created
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='admin_logs'")
        .all();
      expect(tables).toHaveLength(1);

      // Verify migration was recorded
      const records = getAppliedMigrations(db);
      expect(records.length).toBeGreaterThanOrEqual(1);
      expect(records.some((r) => r.name === "002_add_admin.sql")).toBe(true);
    });

    it("should be idempotent — running twice applies nothing the second time", () => {
      db.exec("CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, email TEXT NOT NULL);");

      runMigrations(db);
      const secondRun = runMigrations(db);
      expect(secondRun).toEqual([]);
    });
  });

  describe("rollbackMigration", () => {
    it("should throw a clear error when the latest migration has no DOWN section", () => {
      // DOWN sections were stripped from all migration files when D1
      // shipped (Step 8 of #275): wrangler treats migration files as raw
      // SQL with no UP/DOWN parsing, so the DROP statements were running
      // alongside the CREATEs and wiping freshly-created tables. Rollback
      // is now a manual / hand-written affair.
      (db as unknown as { [k: string]: (s: string) => void })["exec"](
        "CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, email TEXT NOT NULL);"
      );
      runMigrations(db);

      const allFiles = loadMigrationFiles("sqlite");
      const latest = allFiles[allFiles.length - 1];
      expect(latest.down).toBeNull();

      const appliedBefore = getAppliedMigrations(db);
      expect(appliedBefore.some((r) => r.name === latest.name)).toBe(true);

      expect(() => rollbackMigration(db)).toThrow(/no DOWN section/);
    });

    it("should return null when nothing to rollback", () => {
      const rolled = rollbackMigration(db);
      expect(rolled).toBeNull();
    });
  });

  describe("getMigrationStatus", () => {
    it("should report applied and pending accurately", () => {
      db.exec("CREATE TABLE IF NOT EXISTS user (id TEXT PRIMARY KEY, email TEXT NOT NULL);");

      // Before running: all should be pending
      const before = getMigrationStatus(db);
      expect(before.applied).toHaveLength(0);
      expect(before.pending.length).toBeGreaterThanOrEqual(1);

      // After running: none should be pending
      runMigrations(db);
      const after = getMigrationStatus(db);
      expect(after.applied.length).toBeGreaterThanOrEqual(1);
      expect(after.pending).toHaveLength(0);
    });
  });
});

describe("loadMigrationFiles", () => {
  it("should load actual migration files from disk", () => {
    const files = loadMigrationFiles();
    expect(files.length).toBeGreaterThanOrEqual(1);
    expect(files[0].name).toBe("000_better_auth_init.sql");
    expect(files[0].up).toContain("CREATE TABLE");
    // DOWN sections were removed for wrangler d1 migrations apply
    // compatibility (Step 8 of #275); files are UP-only.
    expect(files[0].down).toBeNull();
  });

  it("should sort files alphabetically", () => {
    const files = loadMigrationFiles();
    for (let i = 1; i < files.length; i++) {
      expect(files[i].name > files[i - 1].name).toBe(true);
    }
  });
});
