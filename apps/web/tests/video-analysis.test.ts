import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import fs from "fs";
import path from "path";
import { createRequire } from "module";

const TEST_DB = path.resolve(__dirname, "../data/test-video-analysis.db");

// ─── Mock @opennextjs/cloudflare ───────────────────────────────────────────
// The implementation calls `require("@opennextjs/cloudflare")` (CJS dynamic
// require so non-Workers targets don't try to resolve it at module load).
// vi.mock can't always intercept that require call in Vitest 4, so we patch
// Node's CommonJS module cache directly with our mocked exports object.

const cf = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  // Controls whether VIDEO_PROCESSOR binding is present on env.
  hasBinding: { value: true },
}));

function installRequireMock() {
  const req = createRequire(__filename);
  const resolved = req.resolve("@opennextjs/cloudflare");
  // Build a CJS module record and shove it into Node's require cache so that
  // any subsequent require("@opennextjs/cloudflare") in this process returns
  // our test double instead of the real package.
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const Module = require("module");
  const mockExports = {
    getCloudflareContext: () => ({
      env: cf.hasBinding.value
        ? { VIDEO_PROCESSOR: { fetch: cf.fetchMock } }
        : {},
    }),
  };
  const mod = new Module(resolved);
  mod.filename = resolved;
  mod.loaded = true;
  mod.exports = mockExports;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (require.cache as any)[resolved] = mod;
}
installRequireMock();

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
  for (const table of ["post_analysis", "posts", "user"]) {
    try {
      rawDb.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // ignore
    }
  }
}

function seedUsers(rawDb: import("better-sqlite3").Database, ids: string[]) {
  const now = Math.floor(Date.now() / 1000);
  const stmt = rawDb.prepare(
    "INSERT OR IGNORE INTO user (id, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, 0, ?, ?)",
  );
  for (const id of ids) stmt.run(id, `${id}@test.com`, now, now);
}

function seedVideoPost(
  rawDb: import("better-sqlite3").Database,
  userId: string,
  platformPostId: string,
  opts: { mediaUrl?: string | null } = {},
): number {
  const r = rawDb
    .prepare(
      `INSERT INTO posts (user_id, platform_post_id, platform, caption, media_type, media_url)
       VALUES (?, ?, 'instagram', ?, 'VIDEO', ?)`,
    )
    .run(userId, platformPostId, "video caption", opts.mediaUrl ?? "https://cdn.example/video.mp4");
  return r.lastInsertRowid as number;
}

function seedPostAnalysisRow(
  rawDb: import("better-sqlite3").Database,
  postId: number,
  userId: string,
) {
  rawDb
    .prepare(
      `INSERT INTO post_analysis
        (post_id, user_id, hook_type, cta_present, caption_tone, emoji_count, hashtag_count, caption_length, raw_analysis)
       VALUES (?, ?, 'statement', 0, 'informational', 0, 0, 0, ?)`,
    )
    .run(postId, userId, JSON.stringify({}));
}

// Build a Response-shaped object that mirrors what a fetch() returns to the
// implementation. The worker is expected to return JSON.
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("processVideoPosts", () => {
  let rawDb: import("better-sqlite3").Database;
  let processVideoPosts: typeof import("@/lib/ai/video-analysis").processVideoPosts;

  beforeAll(async () => {
    cleanupDb();
    process.env.DATABASE_PATH = TEST_DB;
    process.env.VIDEO_PROCESSOR_SECRET = "test-secret";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    delete process.env.DATABASE_DRIVER;
    delete process.env.DATABASE_URL;

    const dbMod = await import("@/lib/db");
    rawDb = dbMod.getRawDb();

    const mod = await import("@/lib/ai/video-analysis");
    processVideoPosts = mod.processVideoPosts;
  });

  beforeEach(() => {
    cf.fetchMock.mockReset();
    cf.hasBinding.value = true;
    process.env.VIDEO_PROCESSOR_SECRET = "test-secret";
    process.env.OPENAI_API_KEY = "test-openai";
    process.env.ANTHROPIC_API_KEY = "test-anthropic";
    truncateAll(rawDb);
  });

  afterAll(() => {
    cleanupDb();
  });

  it("throws when VIDEO_PROCESSOR binding is missing", async () => {
    cf.hasBinding.value = false;
    seedUsers(rawDb, ["userA"]);
    const pid = seedVideoPost(rawDb, "userA", "v-1");
    seedPostAnalysisRow(rawDb, pid, "userA");

    await expect(processVideoPosts("userA")).rejects.toThrow();
  });

  it("throws when VIDEO_PROCESSOR_SECRET env var is missing", async () => {
    delete process.env.VIDEO_PROCESSOR_SECRET;
    seedUsers(rawDb, ["userA"]);
    const pid = seedVideoPost(rawDb, "userA", "v-1");
    seedPostAnalysisRow(rawDb, pid, "userA");
    await expect(processVideoPosts("userA")).rejects.toThrow(/VIDEO_PROCESSOR_SECRET/);
  });

  it("throws when OPENAI_API_KEY env var is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    seedUsers(rawDb, ["userA"]);
    const pid = seedVideoPost(rawDb, "userA", "v-1");
    seedPostAnalysisRow(rawDb, pid, "userA");
    await expect(processVideoPosts("userA")).rejects.toThrow(/OPENAI_API_KEY/);
  });

  it("throws when ANTHROPIC_API_KEY env var is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    seedUsers(rawDb, ["userA"]);
    const pid = seedVideoPost(rawDb, "userA", "v-1");
    seedPostAnalysisRow(rawDb, pid, "userA");
    await expect(processVideoPosts("userA")).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });

  it("happy path: posts to /process-video with right body+header and updates DB", async () => {
    seedUsers(rawDb, ["userA"]);
    const pid = seedVideoPost(rawDb, "userA", "v-1", {
      mediaUrl: "https://cdn.example/clip.mp4",
    });
    seedPostAnalysisRow(rawDb, pid, "userA");

    cf.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        transcript: "Hello there, welcome to the video.",
        spoken_hook: "Hello there",
        key_frame_analysis_json: JSON.stringify({ frame_1: "person speaking" }),
      }),
    );

    const result = await processVideoPosts("userA");

    expect(cf.fetchMock).toHaveBeenCalledTimes(1);
    const [reqArg, initArg] = cf.fetchMock.mock.calls[0];
    // The fetch is `POST /process-video`. The first arg may be a Request or a
    // URL string — handle both shapes.
    let urlStr: string;
    let method: string | undefined;
    let headers: Headers;
    let bodyText: string;
    if (reqArg instanceof Request) {
      urlStr = reqArg.url;
      method = reqArg.method;
      headers = reqArg.headers;
      bodyText = await reqArg.clone().text();
    } else {
      urlStr = String(reqArg);
      method = (initArg?.method as string | undefined) ?? "GET";
      headers = new Headers(initArg?.headers as HeadersInit);
      bodyText =
        typeof initArg?.body === "string"
          ? (initArg.body as string)
          : initArg?.body
            ? String(initArg.body)
            : "";
    }
    expect(urlStr).toMatch(/\/process-video$/);
    expect(method).toBe("POST");
    expect(headers.get("x-internal-secret")).toBe("test-secret");

    const parsed = JSON.parse(bodyText) as {
      video_url: string;
      openai_api_key: string;
      anthropic_api_key: string;
    };
    expect(parsed.video_url).toBe("https://cdn.example/clip.mp4");
    expect(parsed.openai_api_key).toBe("test-openai");
    expect(parsed.anthropic_api_key).toBe("test-anthropic");

    // Counts
    expect(result.transcribed).toBe(1);
    expect(result.framesAnalyzed).toBe(1);
    expect(result.errors).toBe(0);
    expect(result.skipped).toBe(0);

    // DB row updated
    const row = rawDb
      .prepare("SELECT transcript, spoken_hook, key_frame_analysis FROM post_analysis WHERE post_id = ?")
      .get(pid) as {
      transcript: string | null;
      spoken_hook: string | null;
      key_frame_analysis: string | null;
    };
    expect(row.transcript).toBe("Hello there, welcome to the video.");
    expect(row.spoken_hook).toBe("Hello there");
    expect(row.key_frame_analysis).toContain("person speaking");
  });

  it("skipped count when mediaUrl is null", async () => {
    seedUsers(rawDb, ["userA"]);
    // Insert a video post with null media_url — should not even satisfy the
    // query (which filters media_url IS NOT NULL), but in case the impl
    // returns rows differently, ensure we don't blow up. The "skipped"
    // semantic per spec is "missing mediaUrl".
    const r = rawDb
      .prepare(
        `INSERT INTO posts (user_id, platform_post_id, platform, caption, media_type, media_url)
         VALUES (?, ?, 'instagram', ?, 'VIDEO', NULL)`,
      )
      .run("userA", "v-null", "no url");
    const pid = r.lastInsertRowid as number;
    seedPostAnalysisRow(rawDb, pid, "userA");

    // Also include one valid post so something can flow through.
    const pid2 = seedVideoPost(rawDb, "userA", "v-2", {
      mediaUrl: "https://cdn.example/ok.mp4",
    });
    seedPostAnalysisRow(rawDb, pid2, "userA");

    cf.fetchMock.mockResolvedValueOnce(
      jsonResponse({
        transcript: "ok",
        spoken_hook: "ok",
        key_frame_analysis_json: "{}",
      }),
    );

    const result = await processVideoPosts("userA");
    // The null-url row either gets filtered out at the query or counted as
    // skipped. Both behaviours are acceptable per spec; what matters is
    // that fetch was only ever called for the valid row.
    expect(cf.fetchMock).toHaveBeenCalledTimes(1);
    expect(result.errors).toBe(0);
    expect(typeof result.skipped).toBe("number");
  });

  it("error count when fetch returns 500", async () => {
    seedUsers(rawDb, ["userA"]);
    const pid = seedVideoPost(rawDb, "userA", "v-1");
    seedPostAnalysisRow(rawDb, pid, "userA");

    cf.fetchMock.mockResolvedValueOnce(jsonResponse({ error: "boom" }, 500));

    const result = await processVideoPosts("userA");
    expect(result.errors).toBeGreaterThanOrEqual(1);
    expect(result.transcribed).toBe(0);
    expect(result.framesAnalyzed).toBe(0);

    // DB row should NOT have been updated.
    const row = rawDb
      .prepare("SELECT transcript, spoken_hook, key_frame_analysis FROM post_analysis WHERE post_id = ?")
      .get(pid) as {
      transcript: string | null;
      spoken_hook: string | null;
      key_frame_analysis: string | null;
    };
    expect(row.transcript).toBeNull();
    expect(row.spoken_hook).toBeNull();
    expect(row.key_frame_analysis).toBeNull();
  });

  it("user isolation: only userA's video posts are processed", async () => {
    seedUsers(rawDb, ["userA", "userB"]);

    // userA: 2 video posts (both need transcription)
    const a1 = seedVideoPost(rawDb, "userA", "a-1", {
      mediaUrl: "https://cdn.example/a1.mp4",
    });
    seedPostAnalysisRow(rawDb, a1, "userA");
    const a2 = seedVideoPost(rawDb, "userA", "a-2", {
      mediaUrl: "https://cdn.example/a2.mp4",
    });
    seedPostAnalysisRow(rawDb, a2, "userA");

    // userB: 1 video post that should NEVER be touched.
    const b1 = seedVideoPost(rawDb, "userB", "b-1", {
      mediaUrl: "https://cdn.example/b1.mp4",
    });
    seedPostAnalysisRow(rawDb, b1, "userB");

    cf.fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          transcript: "speech",
          spoken_hook: "hook",
          key_frame_analysis_json: JSON.stringify({ k: "v" }),
        }),
      ),
    );

    const result = await processVideoPosts("userA");

    expect(cf.fetchMock).toHaveBeenCalledTimes(2);
    expect(result.transcribed).toBe(2);

    // Verify the URLs we POSTed are A's, not B's.
    const sentUrls: string[] = [];
    for (const call of cf.fetchMock.mock.calls) {
      const [reqArg, initArg] = call;
      let bodyText: string;
      if (reqArg instanceof Request) {
        bodyText = await reqArg.clone().text();
      } else {
        bodyText =
          typeof initArg?.body === "string"
            ? (initArg.body as string)
            : String(initArg?.body ?? "");
      }
      const parsed = JSON.parse(bodyText) as { video_url: string };
      sentUrls.push(parsed.video_url);
    }
    expect(sentUrls.sort()).toEqual([
      "https://cdn.example/a1.mp4",
      "https://cdn.example/a2.mp4",
    ]);
    expect(sentUrls).not.toContain("https://cdn.example/b1.mp4");

    // DB writes scoped to userA: B's row must still have null transcript.
    const bRow = rawDb
      .prepare("SELECT transcript FROM post_analysis WHERE post_id = ?")
      .get(b1) as { transcript: string | null };
    expect(bRow.transcript).toBeNull();

    const aRows = rawDb
      .prepare(
        "SELECT post_id, transcript FROM post_analysis WHERE user_id = 'userA' ORDER BY post_id",
      )
      .all() as { post_id: number; transcript: string | null }[];
    expect(aRows).toHaveLength(2);
    for (const r of aRows) {
      expect(r.transcript).toBe("speech");
    }
  });

  it("emits progress events with phase='video' and current/total fields", async () => {
    seedUsers(rawDb, ["userA"]);
    const p1 = seedVideoPost(rawDb, "userA", "v-1", {
      mediaUrl: "https://cdn.example/1.mp4",
    });
    seedPostAnalysisRow(rawDb, p1, "userA");
    const p2 = seedVideoPost(rawDb, "userA", "v-2", {
      mediaUrl: "https://cdn.example/2.mp4",
    });
    seedPostAnalysisRow(rawDb, p2, "userA");

    cf.fetchMock.mockImplementation(() =>
      Promise.resolve(
        jsonResponse({
          transcript: "txt",
          spoken_hook: "hook",
          key_frame_analysis_json: "{}",
        }),
      ),
    );

    const events: Array<{ phase: string; step: string; current: number; total: number }> = [];
    await processVideoPosts("userA", undefined, (e) => events.push(e));

    const videoEvents = events.filter((e) => e.phase === "video");
    expect(videoEvents.length).toBeGreaterThan(0);
    for (const e of videoEvents) {
      expect(typeof e.current).toBe("number");
      expect(typeof e.total).toBe("number");
      expect(e.total).toBeGreaterThanOrEqual(e.current);
    }
  });
});
