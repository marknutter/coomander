import { describe, it, expect } from "vitest";
import {
  buildDeterministicReview,
  weeklyExpected,
  weekStartFor,
  longestStreakInWeek,
  renderReviewMessage,
} from "@/lib/coomander/weeklyReview";
import type {
  CadencePillar,
  CadenceBeat,
  ContentState,
  ProcurementItem,
} from "@/lib/schema";

const WEEK_ENDING = "2026-06-14"; // Sunday
const WEEK_START = "2026-06-08"; // Monday, 6 days before
// A drop dated mid-week (Wed 2026-06-10).
const inWeekTs = Math.floor(Date.parse("2026-06-10T12:00:00Z") / 1000);

type Drop = {
  id: string;
  user_id: string;
  beat_id: string | null;
  kind: string;
  source: string;
  platform: string | null;
  external_ref: string | null;
  content_state_id: string | null;
  payload_json: string;
  dropped_at: number;
  created_at: number;
};

function pillar(over: Partial<CadencePillar> = {}): CadencePillar {
  return {
    id: "p1",
    user_id: "u1",
    name: "Content",
    kind: "content",
    display_order: 0,
    archived_at: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  } as unknown as CadencePillar;
}

function beat(over: Partial<CadenceBeat> = {}): CadenceBeat {
  return {
    id: "b1",
    user_id: "u1",
    pillar_id: "p1",
    name: "Reels",
    cadence_kind: "daily",
    target_count: 1,
    buffer_goal_days: null,
    window_start: null,
    window_end: null,
    priority: "med",
    platform_specific: null,
    subtype: null,
    active: 1,
    archived_at: null,
    notes: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  } as unknown as CadenceBeat;
}

function drop(over: Partial<Drop> = {}): Drop {
  return {
    id: "d1",
    user_id: "u1",
    beat_id: "b1",
    kind: "shipped",
    source: "manual_ui",
    platform: null,
    external_ref: null,
    content_state_id: null,
    payload_json: "{}",
    dropped_at: inWeekTs,
    created_at: 0,
    ...over,
  };
}

function content(over: Partial<ContentState> = {}): ContentState {
  return {
    id: "c1",
    user_id: "u1",
    beat_id: "b1",
    title: "Clip",
    current_state: "approved",
    created_at: 0,
    updated_at: 0,
    ...over,
  } as unknown as ContentState;
}

function procurement(over: Partial<ProcurementItem> = {}): ProcurementItem {
  return {
    id: "pr1",
    user_id: "u1",
    beat_id: "b1",
    category: "shoot_prep",
    label: "Lights",
    status: "needed",
    needed_by: WEEK_ENDING,
    updated_at: 0,
    created_at: 0,
    ...over,
  } as unknown as ProcurementItem;
}

type ReviewInputs = Parameters<typeof buildDeterministicReview>[0];

function buildInputs(over: Partial<ReviewInputs> = {}): ReviewInputs {
  return {
    userId: "u1",
    weekEnding: WEEK_ENDING,
    pillars: [pillar()],
    beats: [beat()],
    weekDrops: [],
    allShippedDropDates: [],
    content: [],
    procurement: [],
    badDayCount: 0,
    ...over,
  } as unknown as ReviewInputs;
}

// The deterministic builder wraps the source pillar under a `pillar` key and
// hangs expected_total / actual_total / on_pace / platform_breakdown beside it.
function findPillar(
  review: ReturnType<typeof buildDeterministicReview>,
  id: string,
) {
  return review.pillars.find(
    (p: { pillar: { id: string } }) => p.pillar.id === id,
  );
}

// ── weeklyExpected ───────────────────────────────────────────────────────────

describe("weeklyExpected", () => {
  it("daily beat → target * 7", () => {
    expect(
      weeklyExpected({ cadence_kind: "daily", target_count: 3 } as unknown as CadenceBeat),
    ).toBe(21);
  });

  it("weekly beat → target as-is", () => {
    expect(
      weeklyExpected({ cadence_kind: "weekly", target_count: 21 } as unknown as CadenceBeat),
    ).toBe(21);
  });

  it("window beat → target as-is", () => {
    expect(
      weeklyExpected({ cadence_kind: "window", target_count: 4 } as unknown as CadenceBeat),
    ).toBe(4);
  });

  it("daily_vlog_buffer → 0", () => {
    expect(
      weeklyExpected({
        cadence_kind: "daily_vlog_buffer",
        target_count: 5,
      } as unknown as CadenceBeat),
    ).toBe(0);
  });
});

// ── weekStartFor ─────────────────────────────────────────────────────────────

describe("weekStartFor", () => {
  it("returns the date 6 days before the week ending", () => {
    expect(weekStartFor("2026-06-14")).toBe("2026-06-08");
  });
});

// ── longestStreakInWeek ──────────────────────────────────────────────────────

describe("longestStreakInWeek", () => {
  it("finds the longest run of consecutive active days in the window", () => {
    const active = new Set(["2026-06-08", "2026-06-09", "2026-06-11"]);
    expect(longestStreakInWeek(active, WEEK_START, WEEK_ENDING)).toBe(2);
  });

  it("empty set → 0", () => {
    expect(longestStreakInWeek(new Set<string>(), WEEK_START, WEEK_ENDING)).toBe(0);
  });

  it("all 7 days present → 7", () => {
    const active = new Set([
      "2026-06-08",
      "2026-06-09",
      "2026-06-10",
      "2026-06-11",
      "2026-06-12",
      "2026-06-13",
      "2026-06-14",
    ]);
    expect(longestStreakInWeek(active, WEEK_START, WEEK_ENDING)).toBe(7);
  });
});

// ── buildDeterministicReview ─────────────────────────────────────────────────

describe("buildDeterministicReview — pillar pacing", () => {
  it("weekly beat target 21, 21 attributed drops → expected 21, actual 21, on_pace true", () => {
    const weekDrops = Array.from({ length: 21 }, (_, i) =>
      drop({ id: `d${i}`, beat_id: "b1", platform: "ig" }),
    );
    const review = buildDeterministicReview(
      buildInputs({
        beats: [beat({ id: "b1", cadence_kind: "weekly", target_count: 21 })],
        weekDrops: weekDrops as unknown as never,
      }),
    );
    const p = findPillar(review, "p1")!;
    expect(p.expected_total).toBe(21);
    expect(p.actual_total).toBe(21);
    expect(p.on_pace).toBe(true);
  });

  it("weekly beat target 21 with fewer drops → on_pace false", () => {
    const weekDrops = Array.from({ length: 5 }, (_, i) =>
      drop({ id: `d${i}`, beat_id: "b1", platform: "ig" }),
    );
    const review = buildDeterministicReview(
      buildInputs({
        beats: [beat({ id: "b1", cadence_kind: "weekly", target_count: 21 })],
        weekDrops: weekDrops as unknown as never,
      }),
    );
    const p = findPillar(review, "p1")!;
    expect(p.expected_total).toBe(21);
    expect(p.actual_total).toBe(5);
    expect(p.on_pace).toBe(false);
  });
});

describe("buildDeterministicReview — platform_breakdown", () => {
  it("counts weekDrops by platform, null bucketed under 'none'", () => {
    const weekDrops = [
      drop({ id: "d1", platform: "ig" }),
      drop({ id: "d2", platform: "ig" }),
      drop({ id: "d3", platform: "tiktok" }),
      drop({ id: "d4", platform: null }),
    ];
    const review = buildDeterministicReview(
      buildInputs({
        beats: [beat({ id: "b1", cadence_kind: "weekly", target_count: 4 })],
        weekDrops: weekDrops as unknown as never,
      }),
    );
    const p = findPillar(review, "p1")!;
    expect(p.platform_breakdown.ig).toBe(2);
    expect(p.platform_breakdown.tiktok).toBe(1);
    expect(p.platform_breakdown.none).toBe(1);
  });
});

describe("buildDeterministicReview — procurement", () => {
  it("classifies overdue / received_this_week / upcoming_next_2_weeks", () => {
    const weekStartTs = Math.floor(Date.parse(WEEK_START + "T00:00:00Z") / 1000);
    const receivedTs = Math.floor(Date.parse("2026-06-10T00:00:00Z") / 1000);
    const review = buildDeterministicReview(
      buildInputs({
        procurement: [
          // overdue: open + needed_by before week ending
          procurement({
            id: "ov1",
            status: "needed",
            needed_by: "2026-06-01",
          }),
          procurement({
            id: "ov2",
            status: "ordered",
            needed_by: "2026-06-05",
          }),
          // received this week
          procurement({
            id: "rc1",
            status: "received",
            needed_by: "2026-06-09",
            updated_at: receivedTs,
          }),
          // received before this week — should NOT count
          procurement({
            id: "rc2",
            status: "received",
            needed_by: "2026-05-01",
            updated_at: weekStartTs - 86400 * 3,
          }),
          // upcoming next 2 weeks: open + needed_by within [weekEnding, +14d]
          procurement({
            id: "up1",
            status: "needed",
            needed_by: "2026-06-20",
          }),
          // beyond 2 weeks — should NOT be upcoming
          procurement({
            id: "up2",
            status: "needed",
            needed_by: "2026-07-30",
          }),
        ] as unknown as never,
      }),
    );
    // The deterministic builder returns the matching item arrays.
    expect(review.procurement.overdue.length).toBe(2);
    expect(review.procurement.received_this_week.length).toBe(1);
    expect(review.procurement.upcoming_next_2_weeks.length).toBe(1);
  });
});

describe("buildDeterministicReview — consistency", () => {
  it("days_with_zero_drops = 7 minus distinct in-week drop days; bad_days = badDayCount", () => {
    // Drops on two distinct in-week days (Mon + Wed).
    const monTs = Math.floor(Date.parse("2026-06-08T12:00:00Z") / 1000);
    const wedTs = Math.floor(Date.parse("2026-06-10T12:00:00Z") / 1000);
    const review = buildDeterministicReview(
      buildInputs({
        weekDrops: [
          drop({ id: "d1", dropped_at: monTs, platform: "ig" }),
          drop({ id: "d2", dropped_at: monTs, platform: "ig" }),
          drop({ id: "d3", dropped_at: wedTs, platform: "ig" }),
        ] as unknown as never,
        badDayCount: 2,
      }),
    );
    expect(review.consistency.days_with_zero_drops).toBe(5);
    expect(review.consistency.bad_days).toBe(2);
  });
});

describe("buildDeterministicReview — content cushion trend", () => {
  it("start_of_week and end_of_week are numbers >= 0", () => {
    const review = buildDeterministicReview(
      buildInputs({
        beats: [beat({ id: "b1", cadence_kind: "daily", target_count: 3 })],
        content: [
          content({ id: "c1", current_state: "approved" }),
          content({ id: "c2", current_state: "scheduled" }),
          content({ id: "c3", current_state: "drafted" }),
        ] as unknown as never,
        allShippedDropDates: ["2026-06-09"],
      }),
    );
    const trend = review.content_cushion_days_trend;
    expect(typeof trend.start_of_week).toBe("number");
    expect(typeof trend.end_of_week).toBe("number");
    expect(trend.start_of_week).toBeGreaterThanOrEqual(0);
    expect(trend.end_of_week).toBeGreaterThanOrEqual(0);
  });
});

describe("buildDeterministicReview — graceful empty inputs", () => {
  it("empty pillars/beats/drops → empty pillars, zeroed consistency, no throw", () => {
    const review = buildDeterministicReview(
      buildInputs({
        pillars: [],
        beats: [],
        weekDrops: [],
        allShippedDropDates: [],
        content: [],
        procurement: [],
        badDayCount: 0,
      }),
    );
    expect(review.pillars).toEqual([]);
    expect(review.consistency.longest_streak_days).toBe(0);
    expect(review.consistency.bad_days).toBe(0);
    expect(review.consistency.days_with_zero_drops).toBe(7);
    expect(review.procurement.overdue.length).toBe(0);
    expect(review.procurement.received_this_week.length).toBe(0);
    expect(review.procurement.upcoming_next_2_weeks.length).toBe(0);
  });
});

// ── renderReviewMessage ──────────────────────────────────────────────────────

describe("renderReviewMessage", () => {
  it("includes 'cushion', the week_ending, and the appUrl review link", () => {
    const appUrl = "https://example.test";
    const review = {
      week_ending: WEEK_ENDING,
      user_id: "u1",
      pillars: [],
      // Builder emits item arrays for these; the renderer reads them, so mirror
      // that shape here.
      procurement: {
        received_this_week: [],
        overdue: [],
        upcoming_next_2_weeks: [],
      },
      consistency: {
        longest_streak_days: 0,
        days_with_zero_drops: 7,
        bad_days: 0,
      },
      content_cushion_days_trend: { start_of_week: 0, end_of_week: 0 },
      highlights: [],
      drift: [],
      next_week_focus: "",
      drift_questions: [],
    };
    const msg = renderReviewMessage(
      review as unknown as Parameters<typeof renderReviewMessage>[0],
      appUrl,
    );
    expect(typeof msg).toBe("string");
    expect(msg).toContain("cushion");
    expect(msg).toContain(WEEK_ENDING);
    expect(msg).toContain(appUrl);
    expect(msg).toContain(`${appUrl}/app/coomander/review/${WEEK_ENDING}`);
  });
});
