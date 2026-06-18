import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";

const TEST_DB = path.resolve(__dirname, "../data/test-ig-sync.db");

const mocks = vi.hoisted(() => {
  return {
    getMedia: vi.fn(),
    getPostInsights: vi.fn(),
    getAccountInfo: vi.fn(),
    getAccountInsights: vi.fn(),
    getDemographics: vi.fn(),
    actualRef: {
      mod: null as null | typeof import("@/lib/platforms/instagram"),
    },
  };
});

vi.mock("@/lib/platforms/instagram", async () => {
  const actual =
    await vi.importActual<typeof import("@/lib/platforms/instagram")>(
      "@/lib/platforms/instagram",
    );
  mocks.actualRef.mod = actual;
  return {
    ...actual,
    getMedia: mocks.getMedia,
    getPostInsights: mocks.getPostInsights,
    getAccountInfo: mocks.getAccountInfo,
    getAccountInsights: mocks.getAccountInsights,
    getDemographics: mocks.getDemographics,
  };
});

function cleanupDb() {
  for (const ext of ["", "-wal", "-shm", "-journal"]) {
    try {
      fs.unlinkSync(TEST_DB + ext);
    } catch {
      // ignore
    }
  }
}

function truncateAll(rawDb: import("better-sqlite3").Database) {
  for (const table of [
    "demographics",
    "account_snapshots",
    "post_insights",
    "posts",
    "platforms",
    "user",
  ]) {
    rawDb.prepare(`DELETE FROM ${table}`).run();
  }
}

function seedUsers(rawDb: import("better-sqlite3").Database, ids: string[]) {
  const now = Math.floor(Date.now() / 1000);
  const stmt = rawDb.prepare(
    "INSERT OR IGNORE INTO user (id, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?)",
  );
  for (const id of ids) stmt.run(id, `${id}@test.com`, now, now);
}

function seedPlatform(
  rawDb: import("better-sqlite3").Database,
  userId: string,
  token: string,
) {
  rawDb
    .prepare(
      "INSERT INTO platforms (user_id, platform, account_id, username, access_token) VALUES (?, 'instagram', ?, ?, ?)",
    )
    .run(userId, `ig-${userId}`, `${userId}-handle`, token);
}

function mediaItem(id: string, ts = "2026-05-01T00:00:00+0000") {
  return {
    id,
    caption: null,
    timestamp: ts,
    likeCount: 0,
    commentsCount: 0,
    mediaType: "IMAGE",
    mediaUrl: null,
    thumbnailUrl: null,
    permalink: `https://example.com/${id}`,
  };
}

function emptyInsights() {
  return {
    views: 0,
    reach: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    saved: 0,
    totalInteractions: 0,
  };
}

function emptyAccountInfo(userId: string) {
  return {
    id: `ig-${userId}`,
    igUserId: `ig-${userId}`,
    username: `${userId}-handle`,
    accountType: "BUSINESS",
    mediaCount: 0,
  };
}

function emptyAccountInsights() {
  return { reach: 0, profileViews: 0 };
}

function emptyDemographics() {
  return { ageGender: [], countries: [], cities: [] };
}

// Replicate getToken's behavior using the test's rawDb directly. This keeps
// the auth-check gate active even though the helpers are mocked. Throws the
// same InstagramAuthError class the sync code sees, by pulling it from the
// `actualRef` reference captured inside the mock factory.
function checkToken(rawDb: import("better-sqlite3").Database, userId: string) {
  const row = rawDb
    .prepare(
      "SELECT access_token FROM platforms WHERE user_id=? AND platform='instagram' LIMIT 1",
    )
    .get(userId) as { access_token: string | null } | undefined;
  if (!row || !row.access_token) {
    throw new (mocks.actualRef.mod!.InstagramAuthError)(
      "No Instagram token found.",
    );
  }
}

function applyDefaultMocks(rawDb: import("better-sqlite3").Database) {
  mocks.getMedia.mockImplementation(async (uid: string) => {
    checkToken(rawDb, uid);
    return { data: [], nextCursor: null };
  });
  mocks.getPostInsights.mockImplementation(async (uid: string) => {
    checkToken(rawDb, uid);
    return emptyInsights();
  });
  mocks.getAccountInfo.mockImplementation(async (uid: string) => {
    checkToken(rawDb, uid);
    return emptyAccountInfo(uid);
  });
  mocks.getAccountInsights.mockImplementation(async (uid: string) => {
    checkToken(rawDb, uid);
    return emptyAccountInsights();
  });
  mocks.getDemographics.mockImplementation(async (uid: string) => {
    checkToken(rawDb, uid);
    return emptyDemographics();
  });
}

describe("syncAllInstagram user-scoping", () => {
  let rawDb: import("better-sqlite3").Database;
  let syncAllInstagram: (typeof import("@/lib/sync/instagram"))["syncAllInstagram"];
  let InstagramAuthError: typeof import("@/lib/platforms/instagram").InstagramAuthError;

  // Single shared DB + module graph. vi.importActual caches the actual
  // module's transitive imports across resetModules, so the lib/db
  // singleton observed by markTokenExpired is bound to whichever DB was
  // first opened. We avoid that pitfall by booting the modules once and
  // truncating tables between tests.
  beforeAll(async () => {
    cleanupDb();
    process.env.DATABASE_PATH = TEST_DB;
    delete process.env.DATABASE_DRIVER;
    delete process.env.DATABASE_URL;

    const dbMod = await import("@/lib/db");
    rawDb = dbMod.getRawDb();

    await import("@/lib/platforms/instagram");
    InstagramAuthError = mocks.actualRef.mod!.InstagramAuthError;

    const syncMod = await import("@/lib/sync/instagram");
    syncAllInstagram = syncMod.syncAllInstagram;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    truncateAll(rawDb);
    applyDefaultMocks(rawDb);
  });

  afterAll(() => {
    cleanupDb();
  });

  describe("token isolation", () => {
    it("uses TOKEN_A and userId 'userA' (never TOKEN_B) when syncing user A", async () => {
      seedUsers(rawDb, ["userA", "userB"]);
      seedPlatform(rawDb, "userA", "TOKEN_A");
      seedPlatform(rawDb, "userB", "TOKEN_B");

      await syncAllInstagram("userA");

      const allCalls = [
        ...mocks.getMedia.mock.calls,
        ...mocks.getPostInsights.mock.calls,
        ...mocks.getAccountInfo.mock.calls,
        ...mocks.getAccountInsights.mock.calls,
        ...mocks.getDemographics.mock.calls,
      ];
      expect(allCalls.length).toBeGreaterThan(0);
      for (const call of allCalls) {
        expect(call[0]).toBe("userA");
      }
    });
  });

  describe("insert scoping", () => {
    it("only writes user_id='userA' rows; user B's pre-existing rows untouched", async () => {
      seedUsers(rawDb, ["userA", "userB"]);
      seedPlatform(rawDb, "userA", "TOKEN_A");
      seedPlatform(rawDb, "userB", "TOKEN_B");

      rawDb
        .prepare(
          "INSERT INTO posts (user_id, platform_post_id, platform) VALUES (?, ?, 'instagram')",
        )
        .run("userB", "userB-existing-post");
      const userBPostId = (
        rawDb
          .prepare(
            "SELECT id FROM posts WHERE user_id=? AND platform_post_id=?",
          )
          .get("userB", "userB-existing-post") as { id: number }
      ).id;
      rawDb
        .prepare(
          "INSERT INTO post_insights (post_id, user_id, snapshot_date) VALUES (?, ?, '2026-04-01')",
        )
        .run(userBPostId, "userB");
      rawDb
        .prepare(
          "INSERT INTO account_snapshots (user_id, platform, snapshot_date, follower_count) VALUES (?, 'instagram', '2026-04-01', 999)",
        )
        .run("userB");
      rawDb
        .prepare(
          "INSERT INTO demographics (user_id, platform, snapshot_date, metric, key, value) VALUES (?, 'instagram', '2026-04-01', 'age_gender', 'M.25-34', 42)",
        )
        .run("userB");

      mocks.getMedia.mockImplementation(async () => ({
        data: [mediaItem("ig-postA-1"), mediaItem("ig-postA-2")],
        nextCursor: null,
      }));
      mocks.getPostInsights.mockImplementation(async () => ({
        ...emptyInsights(),
        likes: 5,
        reach: 100,
      }));
      mocks.getAccountInfo.mockImplementation(async () => ({
        ...emptyAccountInfo("userA"),
        mediaCount: 2,
      }));
      mocks.getAccountInsights.mockImplementation(async () => ({
        reach: 200,
        profileViews: 10,
      }));
      mocks.getDemographics.mockImplementation(async () => ({
        ageGender: [{ key: "F.25-34", value: 50 }],
        countries: [{ key: "US", value: 30 }],
        cities: [],
      }));

      const result = await syncAllInstagram("userA");
      expect(result.posts.postsUpserted).toBeGreaterThan(0);

      for (const table of [
        "posts",
        "post_insights",
        "account_snapshots",
        "demographics",
      ]) {
        const rows = rawDb
          .prepare(`SELECT DISTINCT user_id FROM ${table}`)
          .all() as { user_id: string }[];
        const userIds = rows.map((r) => r.user_id).sort();
        expect(userIds, `${table} had unexpected user_ids`).toEqual([
          "userA",
          "userB",
        ]);
      }

      const userBPosts = rawDb
        .prepare("SELECT platform_post_id FROM posts WHERE user_id='userB'")
        .all() as { platform_post_id: string }[];
      expect(userBPosts).toEqual([{ platform_post_id: "userB-existing-post" }]);

      const userBSnapshot = rawDb
        .prepare(
          "SELECT follower_count FROM account_snapshots WHERE user_id='userB'",
        )
        .get() as { follower_count: number };
      expect(userBSnapshot.follower_count).toBe(999);

      const userBDemo = rawDb
        .prepare(
          "SELECT key, value FROM demographics WHERE user_id='userB'",
        )
        .get() as { key: string; value: number };
      expect(userBDemo).toEqual({ key: "M.25-34", value: 42 });
    });
  });

  describe("no connection ⇒ auth error, no writes", () => {
    it("throws InstagramAuthError and writes nothing for an unconnected user", async () => {
      seedUsers(rawDb, ["userC"]);

      await expect(syncAllInstagram("userC")).rejects.toBeInstanceOf(
        InstagramAuthError,
      );

      for (const table of [
        "posts",
        "post_insights",
        "account_snapshots",
        "demographics",
      ]) {
        const { c } = rawDb
          .prepare(`SELECT COUNT(*) as c FROM ${table} WHERE user_id='userC'`)
          .get() as { c: number };
        expect(c, `${table} should be empty for userC`).toBe(0);
      }
    });
  });

  describe("per-post insight failure is non-fatal", () => {
    it("upserts all 3 posts but only 2 insights when getPostInsights rejects on item 2", async () => {
      seedUsers(rawDb, ["userA"]);
      seedPlatform(rawDb, "userA", "TOKEN_A");

      mocks.getMedia.mockImplementation(async () => ({
        data: [mediaItem("p1"), mediaItem("p2"), mediaItem("p3")],
        nextCursor: null,
      }));
      mocks.getPostInsights.mockImplementation(
        async (_uid: string, mediaId: string) => {
          if (mediaId === "p2") {
            throw new Error("transient insights failure for p2");
          }
          return { ...emptyInsights(), likes: 1 };
        },
      );

      const result = await syncAllInstagram("userA");
      expect(result.posts.postsUpserted).toBe(3);
      expect(result.posts.insightsUpserted).toBe(2);

      const posts = rawDb
        .prepare(
          "SELECT platform_post_id FROM posts WHERE user_id='userA' ORDER BY platform_post_id",
        )
        .all() as { platform_post_id: string }[];
      expect(posts.map((p) => p.platform_post_id)).toEqual(["p1", "p2", "p3"]);

      const insightPostIds = rawDb
        .prepare(
          `SELECT p.platform_post_id as pid
           FROM post_insights pi JOIN posts p ON p.id = pi.post_id
           WHERE pi.user_id='userA' ORDER BY p.platform_post_id`,
        )
        .all() as { pid: string }[];
      expect(insightPostIds.map((r) => r.pid)).toEqual(["p1", "p3"]);
    });
  });

  describe("auth-error during sync marks token expired", () => {
    it("clears access_token and sets token_expires_at when an IG helper throws InstagramAuthError", async () => {
      seedUsers(rawDb, ["userA"]);
      seedPlatform(rawDb, "userA", "TOKEN_A");

      const throwAuth = async () => {
        throw new (mocks.actualRef.mod!.InstagramAuthError)("token revoked");
      };
      mocks.getMedia.mockImplementation(throwAuth);
      mocks.getPostInsights.mockImplementation(throwAuth);
      mocks.getAccountInfo.mockImplementation(throwAuth);
      mocks.getAccountInsights.mockImplementation(throwAuth);
      mocks.getDemographics.mockImplementation(throwAuth);

      await expect(syncAllInstagram("userA")).rejects.toBeInstanceOf(
        InstagramAuthError,
      );

      const row = rawDb
        .prepare(
          "SELECT access_token, token_expires_at FROM platforms WHERE user_id='userA' AND platform='instagram'",
        )
        .get() as { access_token: string | null; token_expires_at: string | null };
      expect(row.access_token).toBeNull();
      expect(row.token_expires_at).not.toBeNull();
    });
  });
});
