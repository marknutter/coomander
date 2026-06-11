import { describe, it, expect, beforeAll } from "vitest";
import { buildWeeklyReview } from "@/lib/coomander/weeklyReview";
import { resolveToolUse, TOOLS } from "@/lib/coomander/inbound";
import { getRawDb } from "@/lib/db";
// Importing the db helper bootstraps the Better Auth `user` table schema.
import "./helpers/db";

const WEEK_ENDING = "2026-06-14"; // Sunday
// A drop dated mid-week (Wed 2026-06-10).
const inWeekTs = Math.floor(Date.parse("2026-06-10T12:00:00Z") / 1000);

let counter = 0;
function seedUser(): string {
  const id = `coomander-wr-user-${Date.now()}-${counter++}`;
  const email = `${id}@test.com`;
  const now = Math.floor(Date.now() / 1000);
  getRawDb()
    .prepare(
      "INSERT INTO user (id, email, emailVerified, createdAt, updatedAt, isAdmin, disabled, coomanderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, email, 1, now, now, 0, 0, 1);
  return id;
}

function seedDomain(userId: string) {
  const raw = getRawDb();
  const now = Math.floor(Date.now() / 1000);
  const pillarId = `${userId}-p1`;
  const beatId = `${userId}-b1`;
  raw
    .prepare(
      "INSERT INTO cadence_pillars (id, user_id, name, kind, display_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(pillarId, userId, "Content", "content", 0, now, now);
  raw
    .prepare(
      "INSERT INTO cadence_beats (id, user_id, pillar_id, name, cadence_kind, target_count, priority, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(beatId, userId, pillarId, "Reels", "weekly", 21, "med", 1, now, now);
  raw
    .prepare(
      "INSERT INTO drops (id, user_id, beat_id, kind, source, platform, payload_json, dropped_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(`${userId}-d1`, userId, beatId, "shipped", "manual_ui", "ig", "{}", inWeekTs, now);
  return { pillarId, beatId };
}

describe("buildWeeklyReview — deterministic + injected narrative", () => {
  let review: Awaited<ReturnType<typeof buildWeeklyReview>>;
  let stubCalled = false;

  beforeAll(async () => {
    const userId = seedUser();
    seedDomain(userId);

    const generate = async () => {
      stubCalled = true;
      return {
        highlights: ["win A"],
        drift: ["drift B"],
        next_week_focus: "focus C",
        drift_questions: [{ question: "why?" }],
      };
    };

    review = await buildWeeklyReview(userId, WEEK_ENDING, {
      generate: generate as unknown as never,
    });
  });

  it("calls the injected generate stub (Anthropic call is stubbable)", () => {
    expect(stubCalled).toBe(true);
  });

  it("merges deterministic fields (pillars present)", () => {
    expect(Array.isArray(review.pillars)).toBe(true);
    expect(review.pillars.length).toBeGreaterThan(0);
  });

  it("merges the stub's narrative — highlights", () => {
    expect(review.highlights).toEqual(["win A"]);
  });

  it("merges the stub's narrative — drift_questions flow through", () => {
    expect(review.drift_questions[0].question).toBe("why?");
  });

  it("merges the stub's narrative — next_week_focus", () => {
    expect(review.next_week_focus).toBe("focus C");
  });
});

describe("resolveToolUse — drift-question reply classification", () => {
  const emptyCtx = { beats: [], content: [], procurement: [] } as unknown as Parameters<
    typeof resolveToolUse
  >[2];

  it("MARK_BLOCKER with a reason → kind 'mark_blocker', reason carried through", () => {
    const res = resolveToolUse(
      TOOLS.MARK_BLOCKER,
      { reason: "sick this week" },
      emptyCtx,
    );
    expect(res.kind).toBe("mark_blocker");
    expect((res as { reason: string }).reason).toContain("sick");
  });

  it("ADJUST_BEAT with an unknown beat id → kind 'clarify'", () => {
    const res = resolveToolUse(
      TOOLS.ADJUST_BEAT,
      { beat_id: "nope", target_count: 3 },
      emptyCtx,
    );
    expect(res.kind).toBe("clarify");
  });
});
