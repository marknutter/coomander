import { describe, it, expect, beforeAll } from "vitest";
import { seedOpsDefaults, V1_PLAYBOOK } from "@/lib/coomander/seed-defaults";
import { getDb, getRawDb } from "@/lib/db";
import { cadencePillars, cadenceBeats } from "@/lib/schema";
import { eq } from "drizzle-orm";
// Importing the db helper bootstraps the Better Auth `user` table schema.
import "./helpers/db";

let userIdCounter = 0;
function seedUser(): string {
  const id = `coomander-seed-user-${Date.now()}-${userIdCounter++}`;
  const email = `${id}@test.com`;
  const now = Math.floor(Date.now() / 1000);
  getRawDb()
    .prepare(
      "INSERT INTO user (id, email, emailVerified, createdAt, updatedAt, isAdmin, disabled, coomanderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, email, 1, now, now, 0, 0, 1);
  return id;
}

describe("V1_PLAYBOOK structure", () => {
  it("is a non-empty array of pillars", () => {
    expect(Array.isArray(V1_PLAYBOOK)).toBe(true);
    expect(V1_PLAYBOOK.length).toBeGreaterThan(0);
  });

  it("each pillar has name, kind, and a beats array", () => {
    for (const pillar of V1_PLAYBOOK) {
      expect(typeof pillar.name).toBe("string");
      expect(typeof pillar.kind).toBe("string");
      expect(Array.isArray(pillar.beats)).toBe(true);
    }
  });

  it("contains a 'Reels' pillar with normal_reel and trial_reel beats", () => {
    const reels = V1_PLAYBOOK.find((p) => p.name === "Reels");
    expect(reels).toBeDefined();
    const subtypes = reels!.beats.map((b: { subtype?: string | null }) => b.subtype);
    expect(subtypes).toContain("normal_reel");
    expect(subtypes).toContain("trial_reel");
  });

  it("contains an 'OF Wall' pillar with a daily_vlog_buffer beat", () => {
    const wall = V1_PLAYBOOK.find((p) => p.name === "OF Wall");
    expect(wall).toBeDefined();
    // V1_PLAYBOOK beat definitions use camelCase `cadenceKind` (the snake_case
    // `cadence_kind` is the DB column name, mapped on insert in seedOpsDefaults).
    const kinds = wall!.beats.map((b: { cadenceKind: string }) => b.cadenceKind);
    expect(kinds).toContain("daily_vlog_buffer");
  });
});

describe("seedOpsDefaults — first seed", () => {
  let userId: string;
  let result: { seeded: boolean; pillars?: number; beats?: number };

  beforeAll(async () => {
    userId = seedUser();
    result = await seedOpsDefaults(userId);
  });

  it("returns { seeded: true, pillars: N, beats: M }", () => {
    expect(result.seeded).toBe(true);
    expect(result.pillars).toBeGreaterThan(0);
    expect(result.beats).toBeGreaterThan(0);
  });

  it("creates cadence_pillars rows for the user", () => {
    const rows = getDb()
      .select()
      .from(cadencePillars)
      .where(eq(cadencePillars.user_id, userId))
      .all();
    expect(rows.length).toBe(result.pillars);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("creates cadence_beats rows for the user", () => {
    const rows = getDb()
      .select()
      .from(cadenceBeats)
      .where(eq(cadenceBeats.user_id, userId))
      .all();
    expect(rows.length).toBe(result.beats);
    expect(rows.length).toBeGreaterThan(0);
  });

  it("seeded pillars have source === 'v1_default'", () => {
    const rows = getDb()
      .select()
      .from(cadencePillars)
      .where(eq(cadencePillars.user_id, userId))
      .all();
    for (const r of rows) {
      expect((r as { source: string }).source).toBe("v1_default");
    }
  });

  it("seeded beats have source === 'v1_default'", () => {
    const rows = getDb()
      .select()
      .from(cadenceBeats)
      .where(eq(cadenceBeats.user_id, userId))
      .all();
    for (const r of rows) {
      expect((r as { source: string }).source).toBe("v1_default");
    }
  });
});

describe("seedOpsDefaults — idempotent", () => {
  it("a second call returns { seeded: false } and creates no duplicate pillars", async () => {
    const userId = seedUser();

    const first = await seedOpsDefaults(userId);
    expect(first.seeded).toBe(true);

    const countAfterFirst = getDb()
      .select()
      .from(cadencePillars)
      .where(eq(cadencePillars.user_id, userId))
      .all().length;

    const second = await seedOpsDefaults(userId);
    expect(second.seeded).toBe(false);

    const countAfterSecond = getDb()
      .select()
      .from(cadencePillars)
      .where(eq(cadencePillars.user_id, userId))
      .all().length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });
});
