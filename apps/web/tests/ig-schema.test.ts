import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { runMigrations } from "@/lib/migrate";
import {
  platforms,
  posts,
  postAnalysis,
  postInsights,
  accountSnapshots,
  demographics,
  contentInsights,
  type NewPlatform,
  type NewPost,
  type NewPostInsight,
} from "@/lib/schema";

const TEST_DB = "./data/test-ig-schema.db";

function cleanupDb() {
  for (const ext of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB + ext);
    } catch {
      // ignore
    }
  }
}

describe("Instagram Analysis Schema (#114)", () => {
  let db: InstanceType<typeof Database>;

  beforeEach(() => {
    cleanupDb();
    const dir = path.dirname(TEST_DB);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    db = new Database(TEST_DB);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    db.exec(`
      CREATE TABLE IF NOT EXISTS user (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL
      );
    `);
  });

  afterEach(() => {
    db.close();
    cleanupDb();
  });

  describe("Migration applies cleanly", () => {
    it("creates all 7 IG analysis tables on a fresh DB", () => {
      const applied = runMigrations(db);
      expect(applied).toContain("015_create_ig_analysis.sql");

      const expectedTables = [
        "platforms",
        "posts",
        "post_analysis",
        "post_insights",
        "account_snapshots",
        "demographics",
        "content_insights",
      ];

      for (const table of expectedTables) {
        const row = db
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(table);
        expect(row, `expected table ${table} to exist`).toBeDefined();
      }
    });
  });

  describe("Schema barrel exports", () => {
    it("exports all 7 drizzle table objects", () => {
      expect(platforms).toBeDefined();
      expect(posts).toBeDefined();
      expect(postAnalysis).toBeDefined();
      expect(postInsights).toBeDefined();
      expect(accountSnapshots).toBeDefined();
      expect(demographics).toBeDefined();
      expect(contentInsights).toBeDefined();
    });
  });

  describe("Type exports compile", () => {
    it("NewPlatform / NewPost / NewPostInsight types accept required fields", () => {
      const _p: NewPlatform = {
        user_id: "u1",
        platform: "instagram",
        account_id: "ig-account-1",
      };
      const _post: NewPost = {
        user_id: "u1",
        platform_post_id: "ig-post-123",
        platform: "instagram",
      };
      const _insight: NewPostInsight = {
        post_id: 1,
        user_id: "u1",
        snapshot_date: "2026-05-10",
      };
      void _p;
      void _post;
      void _insight;
      expect(true).toBe(true);
    });
  });

  describe("FK CASCADE on user delete", () => {
    it("removes platform, post, post_insight, post_analysis, account_snapshot rows when user is deleted", () => {
      runMigrations(db);

      db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u1", "u1@test.com");

      db.prepare(
        "INSERT INTO platforms (user_id, platform, account_id) VALUES (?, ?, ?)"
      ).run("u1", "instagram", "ig-1");

      const postResult = db
        .prepare(
          "INSERT INTO posts (user_id, platform_post_id, platform) VALUES (?, ?, ?)"
        )
        .run("u1", "ig-post-1", "instagram");
      const postId = postResult.lastInsertRowid as number;

      db.prepare(
        "INSERT INTO post_insights (post_id, user_id, snapshot_date) VALUES (?, ?, ?)"
      ).run(postId, "u1", "2026-05-10");

      db.prepare(
        "INSERT INTO post_analysis (post_id, user_id) VALUES (?, ?)"
      ).run(postId, "u1");

      db.prepare(
        "INSERT INTO account_snapshots (user_id, platform, snapshot_date) VALUES (?, ?, ?)"
      ).run("u1", "instagram", "2026-05-10");

      expect(
        (db.prepare("SELECT COUNT(*) as c FROM platforms WHERE user_id=?").get("u1") as { c: number }).c
      ).toBe(1);

      db.prepare("DELETE FROM user WHERE id = ?").run("u1");

      const tablesToCheck = [
        "platforms",
        "posts",
        "post_insights",
        "post_analysis",
        "account_snapshots",
      ];
      for (const table of tablesToCheck) {
        const { c } = db
          .prepare(`SELECT COUNT(*) as c FROM ${table} WHERE user_id = ?`)
          .get("u1") as { c: number };
        expect(c, `expected ${table} to be empty after user delete`).toBe(0);
      }
    });
  });

  describe("Post -> post_analysis CASCADE", () => {
    it("deletes post_analysis when its post is deleted", () => {
      runMigrations(db);

      db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u1", "u1@test.com");

      const postResult = db
        .prepare(
          "INSERT INTO posts (user_id, platform_post_id, platform) VALUES (?, ?, ?)"
        )
        .run("u1", "ig-post-1", "instagram");
      const postId = postResult.lastInsertRowid as number;

      db.prepare("INSERT INTO post_analysis (post_id, user_id) VALUES (?, ?)").run(
        postId,
        "u1"
      );

      const before = db
        .prepare("SELECT COUNT(*) as c FROM post_analysis WHERE post_id = ?")
        .get(postId) as { c: number };
      expect(before.c).toBe(1);

      db.prepare("DELETE FROM posts WHERE id = ?").run(postId);

      const after = db
        .prepare("SELECT COUNT(*) as c FROM post_analysis WHERE post_id = ?")
        .get(postId) as { c: number };
      expect(after.c).toBe(0);
    });
  });

  describe("User-scoped uniqueness on platforms", () => {
    it("allows two different users to each have a platform='instagram' row", () => {
      runMigrations(db);

      db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u1", "u1@test.com");
      db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u2", "u2@test.com");

      expect(() => {
        db.prepare(
          "INSERT INTO platforms (user_id, platform, account_id) VALUES (?, ?, ?)"
        ).run("u1", "instagram", "ig-1");
      }).not.toThrow();

      expect(() => {
        db.prepare(
          "INSERT INTO platforms (user_id, platform, account_id) VALUES (?, ?, ?)"
        ).run("u2", "instagram", "ig-2");
      }).not.toThrow();

      const rows = db
        .prepare("SELECT user_id FROM platforms WHERE platform = ? ORDER BY user_id")
        .all("instagram") as { user_id: string }[];
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.user_id)).toEqual(["u1", "u2"]);
    });
  });

  describe("Same-user duplicate platform fails", () => {
    it("throws when inserting two platforms rows with the same (user_id, platform)", () => {
      runMigrations(db);

      db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u1", "u1@test.com");

      db.prepare(
        "INSERT INTO platforms (user_id, platform, account_id) VALUES (?, ?, ?)"
      ).run("u1", "instagram", "ig-1");

      expect(() => {
        db.prepare(
          "INSERT INTO platforms (user_id, platform, account_id) VALUES (?, ?, ?)"
        ).run("u1", "instagram", "ig-2");
      }).toThrow();
    });
  });

  describe("Posts uniqueness across users", () => {
    it("allows the same platform_post_id for different users", () => {
      runMigrations(db);

      db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u1", "u1@test.com");
      db.prepare("INSERT INTO user (id, email) VALUES (?, ?)").run("u2", "u2@test.com");

      expect(() => {
        db.prepare(
          "INSERT INTO posts (user_id, platform_post_id, platform) VALUES (?, ?, ?)"
        ).run("u1", "shared-post-id", "instagram");
      }).not.toThrow();

      expect(() => {
        db.prepare(
          "INSERT INTO posts (user_id, platform_post_id, platform) VALUES (?, ?, ?)"
        ).run("u2", "shared-post-id", "instagram");
      }).not.toThrow();

      const rows = db
        .prepare(
          "SELECT user_id FROM posts WHERE platform_post_id = ? AND platform = ? ORDER BY user_id"
        )
        .all("shared-post-id", "instagram") as { user_id: string }[];
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.user_id)).toEqual(["u1", "u2"]);
    });
  });

  // Reference unused exports to keep them in scope.
  it("imports demographics and contentInsights without error", () => {
    expect(demographics).toBeDefined();
    expect(contentInsights).toBeDefined();
  });
});
