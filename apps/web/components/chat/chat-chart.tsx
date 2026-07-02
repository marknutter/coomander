"use client";

/**
 * ChatChart — renders a `[CHART:{…}]` rich block (#222 follow-up).
 *
 * Receives the raw inner JSON of a chart marker (from `parseRichSegments`).
 * Validates it against the shared `ChartSpec` schema in @coomander/core; an
 * invalid spec throws, which the surrounding `BlockErrorBoundary` (in
 * chat-blocks.tsx) catches and renders as a small inline fallback — so throwing
 * is the correct failure mode here.
 *
 * Rendered with recharts via the shadcn chart primitives (components/ui/chart),
 * which inject theme-aware `--color-<key>` CSS vars from a ChartConfig. We map
 * the spec's `labels` + `series` into recharts' row shape and cycle a small
 * palette (first series uses the app's brand `--primary`).
 */

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts";

import { parseChartSpec } from "@coomander/core";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

/**
 * Small, theme-aware palette. Index 0 uses the app's brand `--primary` so the
 * primary series tracks the active theme; the rest are mid-tone hues chosen to
 * read on both light and dark surfaces.
 */
const PALETTE = [
  "hsl(221 83% 60%)", // blue
  "hsl(38 92% 55%)", // amber
  "hsl(280 65% 62%)", // violet
  "hsl(0 72% 60%)", // red
  "hsl(190 80% 45%)", // cyan
  "hsl(330 75% 62%)", // pink
  "hsl(95 55% 48%)", // green
  "hsl(255 70% 66%)", // indigo
  "hsl(160 70% 42%)", // teal
  "hsl(20 85% 58%)", // orange
  "hsl(300 60% 55%)", // magenta
] as const;

function seriesColor(index: number): string {
  return index === 0 ? "var(--primary)" : PALETTE[(index - 1) % PALETTE.length]!;
}

const CHART_MARGIN = { top: 8, right: 12, left: 0, bottom: 0 } as const;

export function ChatChart({ json }: { json: string }) {
  const spec = parseChartSpec(json);
  if (!spec) throw new Error("invalid chart spec");

  const showLegend = spec.series.length > 1;

  // One ChartConfig entry per series → `--color-s<i>` CSS vars + legend labels.
  const config: ChartConfig = {};
  spec.series.forEach((s, i) => {
    config[`s${i}`] = { label: s.name, color: seriesColor(i) };
  });

  // recharts row shape: one object per label, a column per series.
  const data = spec.labels.map((label, i) => {
    const row: Record<string, string | number> = { label };
    spec.series.forEach((s, si) => {
      row[`s${si}`] = s.data[i]!;
    });
    return row;
  });

  let chart: React.ReactElement;

  if (spec.type === "pie") {
    // Pie shows the first series; each slice is a category (label), colored per
    // slice rather than per series.
    const first = spec.series[0]!;
    const pieData = spec.labels.map((label, i) => ({
      label,
      value: first.data[i]!,
      fill: seriesColor(i),
    }));
    chart = (
      <PieChart margin={CHART_MARGIN}>
        <ChartTooltip content={<ChartTooltipContent nameKey="label" />} />
        <Pie
          data={pieData}
          dataKey="value"
          nameKey="label"
          outerRadius={88}
          strokeWidth={2}
        >
          {pieData.map((entry, i) => (
            <Cell key={i} fill={entry.fill} />
          ))}
        </Pie>
        <ChartLegend content={<ChartLegendContent nameKey="label" />} />
      </PieChart>
    );
  } else if (spec.type === "line") {
    chart = (
      <LineChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {showLegend && <ChartLegend content={<ChartLegendContent />} />}
        {spec.series.map((s, i) => (
          <Line
            key={i}
            type="monotone"
            dataKey={`s${i}`}
            name={s.name}
            stroke={`var(--color-s${i})`}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    );
  } else if (spec.type === "area") {
    chart = (
      <AreaChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {showLegend && <ChartLegend content={<ChartLegendContent />} />}
        {spec.series.map((s, i) => (
          <Area
            key={i}
            type="monotone"
            dataKey={`s${i}`}
            name={s.name}
            stroke={`var(--color-s${i})`}
            fill={`var(--color-s${i})`}
            fillOpacity={0.2}
            strokeWidth={2}
          />
        ))}
      </AreaChart>
    );
  } else {
    // bar
    chart = (
      <BarChart data={data} margin={CHART_MARGIN}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
        <YAxis tickLine={false} axisLine={false} width={36} />
        <ChartTooltip content={<ChartTooltipContent />} />
        {showLegend && <ChartLegend content={<ChartLegendContent />} />}
        {spec.series.map((s, i) => (
          <Bar
            key={i}
            dataKey={`s${i}`}
            name={s.name}
            fill={`var(--color-s${i})`}
            radius={4}
          />
        ))}
      </BarChart>
    );
  }

  return (
    <div className="my-2 w-full max-w-full overflow-hidden rounded-lg border border-border bg-card p-3">
      {spec.title ? (
        <div className="mb-2 text-sm font-medium text-card-foreground">
          {spec.title}
        </div>
      ) : null}
      <ChartContainer config={config} className="aspect-auto h-64 w-full">
        {chart}
      </ChartContainer>
    </div>
  );
}
