/**
 * ChartSpec — the validated shape of a `[CHART:{…}]` rich block (#222 follow-up).
 *
 * The model is taught (in the system prompt) to emit charts as EXACTLY:
 *
 *   [CHART:{"type":"bar","title":"Monthly signups",
 *           "labels":["Jan","Feb","Mar"],
 *           "series":[{"name":"Signups","data":[12,30,21]}]}]
 *
 * `parseRichSegments` (rich-blocks.ts) hands the inner JSON string to the web
 * renderer; this module is the SINGLE source of truth for what counts as a
 * valid chart. It is pure + env-free (no DOM / Node / Workers globals) so it is
 * safe to import on every surface — browser, workerd, and React Native.
 *
 * Defensive by design: `parseChartSpec` never throws. It returns `null` on any
 * failure (bad JSON, wrong shape, or a series whose `data` length doesn't line
 * up 1:1 with `labels`). The web ChatChart turns a `null` into a thrown error
 * so the surrounding block error boundary renders its fallback.
 */

import { z } from "zod";

/** A single named data series. Its `data` aligns 1:1 with the chart `labels`. */
const chartSeriesSchema = z.object({
  name: z.string().max(60),
  data: z.array(z.number()).max(200),
});

/**
 * The full chart specification. The cross-field refinement enforces that every
 * series carries exactly one value per label — a mismatch makes the chart
 * meaningless, so we reject it (→ `parseChartSpec` returns null).
 */
export const chartSpecSchema = z
  .object({
    type: z.enum(["bar", "line", "pie", "area"]),
    title: z.string().max(120).optional(),
    labels: z.array(z.string().max(60)).min(1).max(200),
    series: z.array(chartSeriesSchema).min(1).max(12),
  })
  .refine(
    (spec) => spec.series.every((s) => s.data.length === spec.labels.length),
    { message: "each series.data length must equal labels.length" },
  );

/** The inferred, validated chart spec consumed by the renderer. */
export type ChartSpec = z.infer<typeof chartSpecSchema>;

/** A single series after validation. */
export type ChartSeries = z.infer<typeof chartSeriesSchema>;

/**
 * Parse the inner JSON of a `[CHART:{…}]` marker into a validated `ChartSpec`.
 * Returns `null` (never throws) on malformed JSON or any schema violation.
 */
export function parseChartSpec(json: string): ChartSpec | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  const result = chartSpecSchema.safeParse(parsed);
  return result.success ? result.data : null;
}
