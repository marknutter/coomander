import { describe, it, expect } from "vitest";
import { parseChartSpec, chartSpecSchema } from "./chart-spec";

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the validated [CHART:{…}] spec (@coomander/core, #222 follow-up).
//
// parseChartSpec(json): ChartSpec | null — defensive by design, NEVER throws.
// Contract (from the spec):
//   - valid bar/line/pie/area → non-null with the right fields.
//   - type not in {bar,line,pie,area} → null.
//   - any series whose data.length !== labels.length → null (cross-field refine).
//   - caps: > 12 series → null; a series with > 200 data points → null.
//   - non-JSON / "{" / "" → null (no throw).
// ─────────────────────────────────────────────────────────────────────────────

/** JSON for a chart with the given type, labels, and one matching series. */
function chartJson(
  type: string,
  labels: string[],
  data: number[],
): string {
  return JSON.stringify({
    type,
    labels,
    series: [{ name: "Series", data }],
  });
}

describe("parseChartSpec — valid specs", () => {
  it.each(["bar", "line", "pie", "area"] as const)(
    "accepts a valid %s spec and returns the parsed fields",
    (type) => {
      const spec = parseChartSpec(chartJson(type, ["Jan", "Feb", "Mar"], [1, 2, 3]));

      expect(spec).not.toBeNull();
      expect(spec!.type).toBe(type);
      expect(spec!.labels).toEqual(["Jan", "Feb", "Mar"]);
      expect(spec!.series).toHaveLength(1);
      expect(spec!.series[0]!.name).toBe("Series");
      expect(spec!.series[0]!.data).toEqual([1, 2, 3]);
    },
  );

  it("accepts an optional title", () => {
    const spec = parseChartSpec(
      JSON.stringify({
        type: "bar",
        title: "Monthly signups",
        labels: ["a", "b"],
        series: [{ name: "s", data: [1, 2] }],
      }),
    );
    expect(spec).not.toBeNull();
    expect(spec!.title).toBe("Monthly signups");
  });

  it("accepts multiple series that each align with labels", () => {
    const spec = parseChartSpec(
      JSON.stringify({
        type: "line",
        labels: ["a", "b"],
        series: [
          { name: "one", data: [1, 2] },
          { name: "two", data: [3, 4] },
        ],
      }),
    );
    expect(spec).not.toBeNull();
    expect(spec!.series).toHaveLength(2);
  });
});

describe("parseChartSpec — rejections (return null)", () => {
  it("rejects an unknown chart type ('scatter')", () => {
    expect(parseChartSpec(chartJson("scatter", ["a"], [1]))).toBeNull();
  });

  it("rejects a series whose data.length !== labels.length", () => {
    const json = JSON.stringify({
      type: "bar",
      labels: ["a", "b", "c"],
      series: [{ name: "s", data: [1, 2] }], // 2 !== 3
    });
    expect(parseChartSpec(json)).toBeNull();
  });

  it("rejects more than 12 series", () => {
    const series = Array.from({ length: 13 }, (_, i) => ({
      name: `s${i}`,
      data: [1], // aligns 1:1 with the single label → only the series cap is violated
    }));
    const json = JSON.stringify({ type: "bar", labels: ["a"], series });
    expect(parseChartSpec(json)).toBeNull();
  });

  it("rejects a series with more than 200 data points", () => {
    const labels = Array.from({ length: 201 }, (_, i) => `l${i}`);
    const data = Array.from({ length: 201 }, (_, i) => i);
    const json = JSON.stringify({
      type: "bar",
      labels,
      series: [{ name: "s", data }],
    });
    expect(parseChartSpec(json)).toBeNull();
  });

  it("rejects an empty series array", () => {
    const json = JSON.stringify({ type: "bar", labels: ["a"], series: [] });
    expect(parseChartSpec(json)).toBeNull();
  });
});

describe("parseChartSpec — malformed input never throws", () => {
  it.each([
    ["plain non-JSON", "not json at all"],
    ["lone brace", "{"],
    ["empty string", ""],
  ])("returns null for %s", (_label, input) => {
    let result: ReturnType<typeof parseChartSpec> | "THREW" = "THREW";
    expect(() => {
      result = parseChartSpec(input);
    }).not.toThrow();
    expect(result).toBeNull();
  });
});

describe("chartSpecSchema", () => {
  it("is exported and safeParses a valid spec to success", () => {
    const result = chartSpecSchema.safeParse({
      type: "pie",
      labels: ["a", "b"],
      series: [{ name: "s", data: [1, 2] }],
    });
    expect(result.success).toBe(true);
  });

  it("safeParse fails on a labels/data mismatch", () => {
    const result = chartSpecSchema.safeParse({
      type: "pie",
      labels: ["a", "b"],
      series: [{ name: "s", data: [1] }],
    });
    expect(result.success).toBe(false);
  });
});
