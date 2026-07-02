import { describe, it, expect } from "vitest";
import {
  parseRichSegments,
  stripSystemTags,
  stripAllTags,
  stripTrailingPartialMarker,
  type RichSegment,
} from "./rich-blocks";

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the shared rich-block parser/strippers (@coomander/core).
//
// Written against the SPEC, black-box: a segment is either
//   { kind: "text", text }
// or
//   { kind: "block", type: "chart" | "image", json, raw }
// The single contract these tests pin down:
//   - parseRichSegments must brace-balance the inner JSON so a `]` INSIDE a data
//     array (`"data":[1,2]`) does not prematurely terminate the marker.
//   - stripSystemTags removes backend [PROFILE:]/[STEP_*:] tags but PRESERVES
//     [CHART:]/[IMAGE:] block markers (they must survive persistence).
//   - stripAllTags removes everything (block markers too) and collapses spaces.
//   - stripTrailingPartialMarker trims a still-streaming partial marker tail.
// ─────────────────────────────────────────────────────────────────────────────

/** Sum the text of every text segment, in order. */
function textOf(segments: RichSegment[]): string {
  return segments
    .map((s) => (s.kind === "text" ? s.text : ""))
    .join("");
}

const CHART_MARKER =
  '[CHART:{"type":"bar","labels":["a"],"series":[{"name":"x","data":[1,2]}]}]';
const IMAGE_MARKER = '[IMAGE:{"key":"k","alt":"a"}]';

describe("parseRichSegments", () => {
  it("returns a single text segment for plain text", () => {
    const segments = parseRichSegments("just some plain text, no markers");

    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      kind: "text",
      text: "just some plain text, no markers",
    });
  });

  it("extracts exactly one chart block even when data arrays contain ']'", () => {
    const segments = parseRichSegments(CHART_MARKER);

    const blocks = segments.filter((s) => s.kind === "block");
    expect(blocks).toHaveLength(1);

    const block = blocks[0]!;
    expect(block.kind).toBe("block");
    if (block.kind !== "block") return; // narrow for TS
    expect(block.type).toBe("chart");

    // `json` is the inner object string and must parse as JSON.
    const parsed = JSON.parse(block.json) as {
      type: string;
      labels: string[];
      series: { name: string; data: number[] }[];
    };
    expect(parsed.type).toBe("bar");
    expect(parsed.labels).toEqual(["a"]);
    expect(parsed.series[0]!.data).toEqual([1, 2]);

    // The block was not truncated at the first inner ']'.
    expect(block.json).toContain('"data":[1,2]');
  });

  it("splits text-before + block + text-after into 3 ordered segments", () => {
    const segments = parseRichSegments(`Before ${CHART_MARKER} after`);

    expect(segments).toHaveLength(3);
    expect(segments[0]).toEqual({ kind: "text", text: "Before " });
    expect(segments[1]!.kind).toBe("block");
    expect(segments[2]).toEqual({ kind: "text", text: " after" });

    const mid = segments[1]!;
    if (mid.kind === "block") {
      expect(mid.type).toBe("chart");
    }
  });

  it("extracts an [IMAGE:{…}] marker as a single image block", () => {
    const segments = parseRichSegments(IMAGE_MARKER);

    const blocks = segments.filter((s) => s.kind === "block");
    expect(blocks).toHaveLength(1);

    const block = blocks[0]!;
    if (block.kind !== "block") throw new Error("expected block");
    expect(block.type).toBe("image");
    const parsed = JSON.parse(block.json) as { key: string; alt: string };
    expect(parsed.key).toBe("k");
    expect(parsed.alt).toBe("a");
  });

  it("leaves an unclosed [CHART:{ marker as plain text (no block extracted)", () => {
    const input = 'streaming... [CHART:{"type":';
    const segments = parseRichSegments(input);

    expect(segments.some((s) => s.kind === "block")).toBe(false);
    // The partial marker text is preserved verbatim in the text segments.
    expect(textOf(segments)).toContain('[CHART:{"type":');
  });
});

describe("stripSystemTags", () => {
  it("drops a [PROFILE:key=value] system tag", () => {
    const out = stripSystemTags("hi [PROFILE:name=bob] there");

    expect(out).not.toContain("PROFILE");
    expect(out).not.toContain("[");
    expect(out).toContain("hi");
    expect(out).toContain("there");
  });

  it("preserves a [CHART:{…}] block marker verbatim", () => {
    const out = stripSystemTags(`see this chart: ${CHART_MARKER} end`);

    expect(out).toContain(CHART_MARKER);
  });

  it("drops a [STEP_DONE:x] system tag", () => {
    const out = stripSystemTags("working [STEP_DONE:upload] done");

    expect(out).not.toContain("STEP_DONE");
    expect(out).not.toContain("[");
  });
});

describe("stripAllTags", () => {
  it("drops BOTH system tags AND block markers, collapsing space runs", () => {
    const input = `a [PROFILE:x=1] b ${CHART_MARKER} c ${IMAGE_MARKER} d`;
    const out = stripAllTags(input);

    // No marker syntax of any kind survives.
    expect(out).not.toContain("[");
    expect(out).not.toContain("PROFILE");
    expect(out).not.toContain("CHART");
    expect(out).not.toContain("IMAGE");

    // Runs of whitespace are collapsed — no double spaces remain.
    expect(out).not.toMatch(/ {2,}/);

    // The surrounding literal text survives, in order.
    expect(out).toMatch(/a\s+b\s+c\s+d/);
  });
});

describe("stripTrailingPartialMarker", () => {
  it("strips a trailing partial [CHART:{ marker tail", () => {
    const out = stripTrailingPartialMarker('Here is a chart [CHART:{"ty');

    expect(out).not.toContain("[CHART");
    expect(out).not.toContain("[");
    expect(out).toContain("Here is a chart");
  });

  it("leaves a COMPLETE trailing [CHART:{…}] marker unchanged", () => {
    const input = `Here is a chart ${CHART_MARKER}`;
    expect(stripTrailingPartialMarker(input)).toBe(input);
  });

  it("leaves text with no marker unchanged", () => {
    const input = "just some text with no markers at all";
    expect(stripTrailingPartialMarker(input)).toBe(input);
  });
});
