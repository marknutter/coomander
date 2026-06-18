import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const TEST_DB = "./data/test-db-unit.db";

function cleanupDb() {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB + ext);
    } catch {
      // ignore
    }
  }
}

// Generic per-user fixture. Lets us exercise SQLite primitives (WAL mode,
// FK constraints, CRUD round-trip, user_id isolation) without coupling to
// any specific app table.
const FIXTURE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS user (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS widgets (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES user(id)
  );
`;

describe("Database", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    cleanupDb();
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(TEST_DB);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
  });

  afterEach(() => {
    db.close();
    cleanupDb();
  });

  it("should create user-scoped tables", () => {
    db.exec(FIXTURE_SCHEMA);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("widgets");
    expect(tableNames).toContain("user");
  });

  it("should CRUD rows correctly", () => {
    db.exec(FIXTURE_SCHEMA);
    db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u1", "test@test.com");

    db.prepare("INSERT INTO widgets (id, user_id, name, description) VALUES (?, ?, ?, ?)").run(
      "w1",
      "u1",
      "Test Widget",
      "A description"
    );

    const row = db.prepare("SELECT * FROM widgets WHERE id = ?").get("w1") as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.name).toBe("Test Widget");
    expect(row.description).toBe("A description");
    expect(row.user_id).toBe("u1");

    db.prepare("UPDATE widgets SET name = ? WHERE id = ? AND user_id = ?").run("Updated", "w1", "u1");
    const updated = db.prepare("SELECT * FROM widgets WHERE id = ?").get("w1") as Record<string, unknown>;
    expect(updated.name).toBe("Updated");

    const result = db.prepare("DELETE FROM widgets WHERE id = ? AND user_id = ?").run("w1", "u1");
    expect(result.changes).toBe(1);

    const deleted = db.prepare("SELECT * FROM widgets WHERE id = ?").get("w1");
    expect(deleted).toBeUndefined();
  });

  it("should enforce foreign key constraints", () => {
    db.exec(FIXTURE_SCHEMA);

    expect(() => {
      db.prepare("INSERT INTO widgets (id, user_id, name) VALUES (?, ?, ?)").run(
        "w1",
        "nonexistent",
        "Bad row"
      );
    }).toThrow();
  });

  it("should isolate rows by user_id", () => {
    db.exec(FIXTURE_SCHEMA);

    db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u1", "a@test.com");
    db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u2", "b@test.com");

    db.prepare("INSERT INTO widgets (id, user_id, name) VALUES (?, ?, ?)").run("w1", "u1", "User 1");
    db.prepare("INSERT INTO widgets (id, user_id, name) VALUES (?, ?, ?)").run("w2", "u2", "User 2");

    const u1Rows = db.prepare("SELECT * FROM widgets WHERE user_id = ?").all("u1") as Record<string, unknown>[];
    expect(u1Rows).toHaveLength(1);
    expect(u1Rows[0].name).toBe("User 1");

    const u2Rows = db.prepare("SELECT * FROM widgets WHERE user_id = ?").all("u2") as Record<string, unknown>[];
    expect(u2Rows).toHaveLength(1);
    expect(u2Rows[0].name).toBe("User 2");
  });

  it("should handle WAL mode correctly", () => {
    const mode = db.pragma("journal_mode") as { journal_mode: string }[];
    expect(mode[0].journal_mode).toBe("wal");
  });
});
