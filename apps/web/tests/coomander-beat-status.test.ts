import { describe, it, expect } from "vitest";
import { computeBeatStatus } from "@/lib/coomander/beats";

describe("computeBeatStatus — daily", () => {
  it("expected_today equals targetCount", () => {
    const r = computeBeatStatus({ cadenceKind: "daily", targetCount: 3, actualToday: 0 });
    expect(r.expected_today).toBe(3);
  });

  it("actualToday 0 with target>0 → untouched", () => {
    const r = computeBeatStatus({ cadenceKind: "daily", targetCount: 1, actualToday: 0 });
    expect(r.status).toBe("untouched");
  });

  it("actualToday < target → behind", () => {
    const r = computeBeatStatus({ cadenceKind: "daily", targetCount: 3, actualToday: 1 });
    expect(r.status).toBe("behind");
  });

  it("actualToday === target → completed", () => {
    const r = computeBeatStatus({ cadenceKind: "daily", targetCount: 2, actualToday: 2 });
    expect(r.status).toBe("completed");
  });

  it("actualToday > target → ahead", () => {
    const r = computeBeatStatus({ cadenceKind: "daily", targetCount: 1, actualToday: 3 });
    expect(r.status).toBe("ahead");
  });
});

describe("computeBeatStatus — weekly", () => {
  it("actualWindow 0 → untouched", () => {
    const r = computeBeatStatus({
      cadenceKind: "weekly",
      targetCount: 7,
      actualToday: 0,
      actualWindow: 0,
      dayOfWeek: 4,
    });
    expect(r.status).toBe("untouched");
  });

  it("actualWindow > target → ahead", () => {
    const r = computeBeatStatus({
      cadenceKind: "weekly",
      targetCount: 7,
      actualToday: 0,
      actualWindow: 8,
      dayOfWeek: 4,
    });
    expect(r.status).toBe("ahead");
  });

  it("actualWindow === target → completed", () => {
    const r = computeBeatStatus({
      cadenceKind: "weekly",
      targetCount: 7,
      actualToday: 0,
      actualWindow: 7,
      dayOfWeek: 4,
    });
    expect(r.status).toBe("completed");
  });

  it("actualWindow >= expectedToDate (target=7, dow=4, actual=4) → on_pace", () => {
    // expectedToDate = 7*(4/7) = 4, actual 4 >= 4
    const r = computeBeatStatus({
      cadenceKind: "weekly",
      targetCount: 7,
      actualToday: 0,
      actualWindow: 4,
      dayOfWeek: 4,
    });
    expect(r.status).toBe("on_pace");
  });

  it("actualWindow < expectedToDate (target=7, dow=4, actual=2) → behind", () => {
    const r = computeBeatStatus({
      cadenceKind: "weekly",
      targetCount: 7,
      actualToday: 0,
      actualWindow: 2,
      dayOfWeek: 4,
    });
    expect(r.status).toBe("behind");
  });
});

describe("computeBeatStatus — window", () => {
  it("actualWindow 0 → untouched", () => {
    const r = computeBeatStatus({
      cadenceKind: "window",
      targetCount: 10,
      actualToday: 0,
      actualWindow: 0,
      windowDaysRemaining: 5,
      windowTotalDays: 10,
    });
    expect(r.status).toBe("untouched");
  });

  it("actualWindow > target → ahead", () => {
    const r = computeBeatStatus({
      cadenceKind: "window",
      targetCount: 10,
      actualToday: 0,
      actualWindow: 11,
      windowDaysRemaining: 5,
      windowTotalDays: 10,
    });
    expect(r.status).toBe("ahead");
  });

  it("actualWindow === target → completed", () => {
    const r = computeBeatStatus({
      cadenceKind: "window",
      targetCount: 10,
      actualToday: 0,
      actualWindow: 10,
      windowDaysRemaining: 5,
      windowTotalDays: 10,
    });
    expect(r.status).toBe("completed");
  });

  it("completion >= elapsedFrac → on_pace", () => {
    // completion = 6/10 = 0.6, elapsedFrac = (10-4)/10 = 0.6 → on_pace
    const r = computeBeatStatus({
      cadenceKind: "window",
      targetCount: 10,
      actualToday: 0,
      actualWindow: 6,
      windowDaysRemaining: 4,
      windowTotalDays: 10,
    });
    expect(r.status).toBe("on_pace");
  });

  it("completion < elapsedFrac → behind", () => {
    // completion = 2/10 = 0.2, elapsedFrac = (10-2)/10 = 0.8 → behind
    const r = computeBeatStatus({
      cadenceKind: "window",
      targetCount: 10,
      actualToday: 0,
      actualWindow: 2,
      windowDaysRemaining: 2,
      windowTotalDays: 10,
    });
    expect(r.status).toBe("behind");
  });

  it("returns window_progress with days_remaining and completion", () => {
    const r = computeBeatStatus({
      cadenceKind: "window",
      targetCount: 10,
      actualToday: 0,
      actualWindow: 6,
      windowDaysRemaining: 4,
      windowTotalDays: 10,
    });
    expect(r.window_progress).toBeDefined();
    expect(r.window_progress!.days_remaining).toBe(4);
    expect(r.window_progress!.completion).toBeCloseTo(0.6, 5);
  });
});

describe("computeBeatStatus — daily_vlog_buffer", () => {
  it("expected_today is 0", () => {
    const r = computeBeatStatus({
      cadenceKind: "daily_vlog_buffer",
      targetCount: 1,
      actualToday: 0,
      bufferCurrentDays: 5,
      bufferGoalDays: 3,
    });
    expect(r.expected_today).toBe(0);
  });

  it("current >= goal → buffer_healthy and buffer_status echoes values", () => {
    const r = computeBeatStatus({
      cadenceKind: "daily_vlog_buffer",
      targetCount: 1,
      actualToday: 0,
      bufferCurrentDays: 5,
      bufferGoalDays: 3,
    });
    expect(r.status).toBe("buffer_healthy");
    expect(r.buffer_status).toEqual({ current_days: 5, goal_days: 3, healthy: true });
  });

  it("current < goal → buffer_low and buffer_status echoes values", () => {
    const r = computeBeatStatus({
      cadenceKind: "daily_vlog_buffer",
      targetCount: 1,
      actualToday: 0,
      bufferCurrentDays: 2,
      bufferGoalDays: 7,
    });
    expect(r.status).toBe("buffer_low");
    expect(r.buffer_status).toEqual({ current_days: 2, goal_days: 7, healthy: false });
  });
});
