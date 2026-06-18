import { describe, it, expect } from "vitest";
import { isValidTransition, CONTENT_STATES, stateIndex } from "@/lib/coomander/contentStates";
import type { ContentStateValue } from "@/lib/schema";

const EXPECTED_ORDER: ContentStateValue[] = [
  "drafted",
  "shot",
  "approved",
  "uploaded_to_edit",
  "edited",
  "scheduled",
  "shipped",
];

describe("CONTENT_STATES", () => {
  it("has the expected order", () => {
    expect(CONTENT_STATES).toEqual(EXPECTED_ORDER);
  });

  it("has length 7", () => {
    expect(CONTENT_STATES).toHaveLength(7);
  });
});

describe("stateIndex", () => {
  it("returns correct indices for each state", () => {
    EXPECTED_ORDER.forEach((state, i) => {
      expect(stateIndex(state)).toBe(i);
    });
  });
});

describe("isValidTransition", () => {
  it("forward by exactly 1 → valid", () => {
    const r = isValidTransition("drafted", "shot");
    expect(r.valid).toBe(true);
  });

  it("forward skipping → invalid with skip error", () => {
    const r = isValidTransition("drafted", "approved");
    expect(r.valid).toBe(false);
    expect(r.error!.toLowerCase()).toContain("skip");
  });

  it("same state → invalid with already error", () => {
    const r = isValidTransition("drafted", "drafted");
    expect(r.valid).toBe(false);
    expect(r.error!.toLowerCase()).toContain("already");
  });

  it("backward without reason → invalid with reason error", () => {
    const r = isValidTransition("edited", "shot");
    expect(r.valid).toBe(false);
    expect(r.error!.toLowerCase()).toContain("reason");
  });

  it("backward with empty/whitespace reason → invalid with reason error", () => {
    const empty = isValidTransition("edited", "shot", "");
    expect(empty.valid).toBe(false);
    expect(empty.error!.toLowerCase()).toContain("reason");

    const ws = isValidTransition("edited", "shot", "   ");
    expect(ws.valid).toBe(false);
    expect(ws.error!.toLowerCase()).toContain("reason");
  });

  it("backward with a non-empty reason → valid", () => {
    const r = isValidTransition("edited", "shot", "reshoot needed");
    expect(r.valid).toBe(true);
  });

  it("unknown from-state → invalid", () => {
    const r = isValidTransition("bogus" as ContentStateValue, "shot");
    expect(r.valid).toBe(false);
  });

  it("unknown to-state → invalid", () => {
    const r = isValidTransition("drafted", "bogus" as ContentStateValue);
    expect(r.valid).toBe(false);
  });
});
