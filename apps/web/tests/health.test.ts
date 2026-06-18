import { describe, it, expect } from "vitest";

// Test the health endpoint logic directly (without Next.js runtime)
// This validates the DB connectivity check pattern used in the health route

import Database from "better-sqlite3";
import fs from "fs";
import path from "path";

const TEST_DB = "./data/test-health.db";

function cleanupDb() {
  for (const ext of ["", "-wal", "-shm"]) {
    try { fs.unlinkSync(TEST_DB + ext); } catch { /* ignore */ }
  }
}

describe("Health Check Logic", () => {
  it("should return ok:true when database is accessible", () => {
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const db = new Database(TEST_DB);
    let dbOk = false;

    try {
      db.prepare("SELECT 1").get();
      dbOk = true;
    } catch {
      dbOk = false;
    }

    expect(dbOk).toBe(true);

    db.close();
    cleanupDb();
  });

  it("should return ok:false when database is corrupt", () => {
    // Write garbage to the DB path
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(TEST_DB, "this is not a valid sqlite database");

    let dbOk = false;

    try {
      const db = new Database(TEST_DB);
      db.prepare("SELECT 1").get();
      dbOk = true;
      db.close();
    } catch {
      dbOk = false;
    }

    expect(dbOk).toBe(false);

    cleanupDb();
  });

  it("should produce a valid health response shape", () => {
    const dbOk = true;
    const response = {
      ok: dbOk,
      db: dbOk,
      timestamp: new Date().toISOString(),
    };

    expect(response).toHaveProperty("ok");
    expect(response).toHaveProperty("db");
    expect(response).toHaveProperty("timestamp");
    expect(typeof response.timestamp).toBe("string");
    // Validate ISO 8601 format
    expect(new Date(response.timestamp).toISOString()).toBe(response.timestamp);
  });
});
