import { describe, it, expect } from "vitest";
import { planPing, PRESET_SLOTS } from "@/lib/coomander/agent";

type Slot = "morning" | "midday" | "check" | "evening";
type NagFrequency = "tight" | "moderate" | "light";

const ALL_SLOTS: Slot[] = ["morning", "midday", "check", "evening"];
const ALL_PRESETS: NagFrequency[] = ["tight", "moderate", "light"];

// Spec'd allowed-slot sets, declared here independently of the implementation.
const ALLOWED: Record<NagFrequency, Slot[]> = {
  tight: ["morning", "midday", "check", "evening"],
  moderate: ["morning", "midday", "evening"],
  light: ["morning", "evening"],
};

describe("PRESET_SLOTS", () => {
  it("tight contains all four slots in order", () => {
    expect(PRESET_SLOTS.tight).toEqual(["morning", "midday", "check", "evening"]);
  });

  it("moderate drops the check slot", () => {
    expect(PRESET_SLOTS.moderate).toEqual(["morning", "midday", "evening"]);
  });

  it("light keeps only morning and evening", () => {
    expect(PRESET_SLOTS.light).toEqual(["morning", "evening"]);
  });
});

describe("planPing — preset gating (no day quality)", () => {
  for (const preset of ALL_PRESETS) {
    for (const slot of ALL_SLOTS) {
      const allowed = ALLOWED[preset].includes(slot);
      it(`${preset} preset, ${slot} slot → send=${allowed}`, () => {
        const result = planPing({ slot, nagFrequency: preset });
        expect(result.send).toBe(allowed);
      });
    }
  }

  it("a slot not in the preset includes a reason mentioning the preset", () => {
    // light preset excludes midday + check
    const midday = planPing({ slot: "midday", nagFrequency: "light" });
    expect(midday.send).toBe(false);
    expect(midday.reason).toBeTruthy();
    expect(midday.reason!.toLowerCase()).toContain("preset");

    const check = planPing({ slot: "check", nagFrequency: "light" });
    expect(check.send).toBe(false);
    expect(check.reason).toBeTruthy();
    expect(check.reason!.toLowerCase()).toContain("preset");
  });

  it("light preset: morning and evening fire, midday and check are suppressed", () => {
    expect(planPing({ slot: "morning", nagFrequency: "light" }).send).toBe(true);
    expect(planPing({ slot: "evening", nagFrequency: "light" }).send).toBe(true);
    expect(planPing({ slot: "midday", nagFrequency: "light" }).send).toBe(false);
    expect(planPing({ slot: "check", nagFrequency: "light" }).send).toBe(false);
  });

  it("moderate preset: only the check slot is suppressed", () => {
    expect(planPing({ slot: "morning", nagFrequency: "moderate" }).send).toBe(true);
    expect(planPing({ slot: "midday", nagFrequency: "moderate" }).send).toBe(true);
    expect(planPing({ slot: "evening", nagFrequency: "moderate" }).send).toBe(true);
    expect(planPing({ slot: "check", nagFrequency: "moderate" }).send).toBe(false);
  });

  it("tight preset: every slot fires", () => {
    for (const slot of ALL_SLOTS) {
      expect(planPing({ slot, nagFrequency: "tight" }).send).toBe(true);
    }
  });
});

describe("planPing — bad-day suppression", () => {
  it("tight: bad day suppresses midday and check, but never morning/evening", () => {
    expect(planPing({ slot: "midday", nagFrequency: "tight", dayQuality: "bad" }).send).toBe(false);
    expect(planPing({ slot: "check", nagFrequency: "tight", dayQuality: "bad" }).send).toBe(false);
    expect(planPing({ slot: "morning", nagFrequency: "tight", dayQuality: "bad" }).send).toBe(true);
    expect(planPing({ slot: "evening", nagFrequency: "tight", dayQuality: "bad" }).send).toBe(true);
  });

  it("moderate: bad day suppresses midday (check already gated by preset)", () => {
    expect(planPing({ slot: "midday", nagFrequency: "moderate", dayQuality: "bad" }).send).toBe(false);
    expect(planPing({ slot: "morning", nagFrequency: "moderate", dayQuality: "bad" }).send).toBe(true);
    expect(planPing({ slot: "evening", nagFrequency: "moderate", dayQuality: "bad" }).send).toBe(true);
  });

  it("light: bad day never affects the only allowed slots (morning/evening)", () => {
    expect(planPing({ slot: "morning", nagFrequency: "light", dayQuality: "bad" }).send).toBe(true);
    expect(planPing({ slot: "evening", nagFrequency: "light", dayQuality: "bad" }).send).toBe(true);
  });

  it("bad-day suppression reason mentions the bad day", () => {
    const result = planPing({ slot: "midday", nagFrequency: "tight", dayQuality: "bad" });
    expect(result.send).toBe(false);
    expect(result.reason).toBeTruthy();
    expect(result.reason!.toLowerCase()).toContain("bad");
  });

  it("dayQuality 'good' never suppresses any allowed slot", () => {
    for (const preset of ALL_PRESETS) {
      for (const slot of ALLOWED[preset]) {
        expect(
          planPing({ slot, nagFrequency: preset, dayQuality: "good" }).send,
          `${preset}/${slot} with good day`,
        ).toBe(true);
      }
    }
  });

  it("dayQuality null never suppresses any allowed slot", () => {
    for (const preset of ALL_PRESETS) {
      for (const slot of ALLOWED[preset]) {
        expect(
          planPing({ slot, nagFrequency: preset, dayQuality: null }).send,
          `${preset}/${slot} with null day`,
        ).toBe(true);
      }
    }
  });

  it("dayQuality undefined (omitted) never suppresses any allowed slot", () => {
    for (const preset of ALL_PRESETS) {
      for (const slot of ALLOWED[preset]) {
        expect(
          planPing({ slot, nagFrequency: preset }).send,
          `${preset}/${slot} with undefined day`,
        ).toBe(true);
      }
    }
  });
});
