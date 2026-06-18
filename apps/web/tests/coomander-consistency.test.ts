import { describe, it, expect } from "vitest";
import {
  streakDays,
  adherencePct,
  contentCushionDays,
  daysSinceLastDrop,
} from "@/lib/coomander/consistency";

describe("streakDays", () => {
  it("counts consecutive days back from today when today present", () => {
    expect(
      streakDays(["2026-06-15", "2026-06-14", "2026-06-13"], "2026-06-15"),
    ).toBe(3);
  });

  it("counts from yesterday when today empty but yesterday present", () => {
    expect(streakDays(["2026-06-14", "2026-06-13"], "2026-06-15")).toBe(2);
  });

  it("empty set → 0", () => {
    expect(streakDays([], "2026-06-15")).toBe(0);
  });

  it("neither today nor yesterday present → 0", () => {
    expect(streakDays(["2026-06-10"], "2026-06-15")).toBe(0);
  });

  it("a gap breaks the streak", () => {
    expect(streakDays(["2026-06-15", "2026-06-13"], "2026-06-15")).toBe(1);
  });
});

describe("adherencePct", () => {
  it("expected <= 0 → 0", () => {
    expect(adherencePct(5, 0)).toBe(0);
    expect(adherencePct(5, -1)).toBe(0);
  });

  it("partial → rounded percentage", () => {
    expect(adherencePct(3, 4)).toBe(75);
  });

  it("over-achievement is capped at 100", () => {
    expect(adherencePct(5, 4)).toBe(100);
  });

  it("zero actual → 0", () => {
    expect(adherencePct(0, 10)).toBe(0);
  });
});

describe("contentCushionDays", () => {
  it("dailyTarget <= 0 → 0", () => {
    expect(
      contentCushionDays({ readyCount: 5, dailyTarget: 0, daysSinceLastDrop: 0 }),
    ).toBe(0);
  });

  it("ready/target with no drops since → full cushion", () => {
    expect(
      contentCushionDays({ readyCount: 9, dailyTarget: 3, daysSinceLastDrop: 0 }),
    ).toBe(3);
  });

  it("subtracts days since last drop", () => {
    expect(
      contentCushionDays({ readyCount: 9, dailyTarget: 3, daysSinceLastDrop: 2 }),
    ).toBe(1);
  });

  it("floors at 0", () => {
    expect(
      contentCushionDays({ readyCount: 3, dailyTarget: 3, daysSinceLastDrop: 5 }),
    ).toBe(0);
  });
});

describe("daysSinceLastDrop", () => {
  it("null → MAX_SAFE_INTEGER", () => {
    expect(daysSinceLastDrop(null, "2026-06-15")).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("whole days between dates", () => {
    expect(daysSinceLastDrop("2026-06-10", "2026-06-15")).toBe(5);
  });

  it("same day → 0", () => {
    expect(daysSinceLastDrop("2026-06-15", "2026-06-15")).toBe(0);
  });

  it("future last-drop date floored at 0", () => {
    expect(daysSinceLastDrop("2026-06-20", "2026-06-15")).toBe(0);
  });
});
