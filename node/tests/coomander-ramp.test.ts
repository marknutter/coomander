import { describe, it, expect } from "vitest";
import {
  expectedToday,
  inRamp,
  RAMP_DAYS,
  NORMAL_REEL_RAMP,
  TRIAL_REEL_RAMP,
} from "@/lib/coomander/ramp";
import type { CadenceBeat } from "@/lib/schema";

// expectedToday only reads { cadence_kind, target_count, subtype } from the
// beat, so a partial literal cast is sufficient for these unit tests.
function makeBeat(
  cadence_kind: string,
  target_count: number,
  subtype: string | null,
): CadenceBeat {
  return { cadence_kind, target_count, subtype } as unknown as CadenceBeat;
}

describe("ramp constants", () => {
  it("RAMP_DAYS === 6", () => {
    expect(RAMP_DAYS).toBe(6);
  });

  it("NORMAL_REEL_RAMP === [1,2,3,3,3,3]", () => {
    expect(NORMAL_REEL_RAMP).toEqual([1, 2, 3, 3, 3, 3]);
  });

  it("TRIAL_REEL_RAMP === [0,0,0,1,2,3]", () => {
    expect(TRIAL_REEL_RAMP).toEqual([0, 0, 0, 1, 2, 3]);
  });
});

describe("inRamp", () => {
  it("returns true for days 0..5", () => {
    for (let d = 0; d <= 5; d++) {
      expect(inRamp(d)).toBe(true);
    }
  });

  it("returns false for negative days", () => {
    expect(inRamp(-1)).toBe(false);
    expect(inRamp(-100)).toBe(false);
  });

  it("returns false for day 6 and beyond", () => {
    expect(inRamp(6)).toBe(false);
    expect(inRamp(7)).toBe(false);
    expect(inRamp(50)).toBe(false);
  });
});

describe("expectedToday — during ramp (normal_reel)", () => {
  it("follows NORMAL_REEL_RAMP for each ramp day", () => {
    const beat = makeBeat("daily", 5, "normal_reel");
    expect(expectedToday(beat, 0)).toBe(1);
    expect(expectedToday(beat, 1)).toBe(2);
    expect(expectedToday(beat, 2)).toBe(3);
    expect(expectedToday(beat, 3)).toBe(3);
    expect(expectedToday(beat, 4)).toBe(3);
    expect(expectedToday(beat, 5)).toBe(3);
  });

  it("day 0 normal_reel → 1", () => {
    expect(expectedToday(makeBeat("daily", 5, "normal_reel"), 0)).toBe(1);
  });

  it("day 3 normal_reel → 3", () => {
    expect(expectedToday(makeBeat("daily", 5, "normal_reel"), 3)).toBe(3);
  });
});

describe("expectedToday — during ramp (trial_reel)", () => {
  it("follows TRIAL_REEL_RAMP for each ramp day", () => {
    const beat = makeBeat("daily", 5, "trial_reel");
    expect(expectedToday(beat, 0)).toBe(0);
    expect(expectedToday(beat, 1)).toBe(0);
    expect(expectedToday(beat, 2)).toBe(0);
    expect(expectedToday(beat, 3)).toBe(1);
    expect(expectedToday(beat, 4)).toBe(2);
    expect(expectedToday(beat, 5)).toBe(3);
  });

  it("day 0 trial_reel → 0", () => {
    expect(expectedToday(makeBeat("daily", 5, "trial_reel"), 0)).toBe(0);
  });

  it("day 3 trial_reel → 1", () => {
    expect(expectedToday(makeBeat("daily", 5, "trial_reel"), 3)).toBe(1);
  });

  it("day 5 trial_reel → 3", () => {
    expect(expectedToday(makeBeat("daily", 5, "trial_reel"), 5)).toBe(3);
  });
});

describe("expectedToday — steady-state (after ramp or non-reel subtype)", () => {
  it("daily → target_count after ramp", () => {
    expect(expectedToday(makeBeat("daily", 4, "normal_reel"), 6)).toBe(4);
  });

  it("weekly → round(target_count/7) after ramp", () => {
    // round(21/7) = 3
    expect(expectedToday(makeBeat("weekly", 21, "normal_reel"), 10)).toBe(3);
  });

  it("window → 0", () => {
    expect(expectedToday(makeBeat("window", 10, "normal_reel"), 10)).toBe(0);
  });

  it("daily_vlog_buffer → 0", () => {
    expect(expectedToday(makeBeat("daily_vlog_buffer", 5, null), 10)).toBe(0);
  });
});

describe("expectedToday — ramp override vs non-reel", () => {
  it("weekly normal_reel target 21 at day 0 → 1 (ramp overrides cadence)", () => {
    expect(expectedToday(makeBeat("weekly", 21, "normal_reel"), 0)).toBe(1);
  });

  it("weekly normal_reel target 21 at day 10 → 3 (steady-state round(21/7))", () => {
    expect(expectedToday(makeBeat("weekly", 21, "normal_reel"), 10)).toBe(3);
  });

  it("daily non-reel beat at day 0 → target_count (ramp does not apply)", () => {
    expect(expectedToday(makeBeat("daily", 7, null), 0)).toBe(7);
  });

  it("daily non-reel beat with unrelated subtype at day 0 → target_count", () => {
    expect(expectedToday(makeBeat("daily", 7, "some_other"), 0)).toBe(7);
  });
});
