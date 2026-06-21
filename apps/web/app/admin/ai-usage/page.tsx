"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, Input, Button } from "@/components/ui";
import { MetricCard, DataTable, PercentageBar } from "@/components/admin/analytics-charts";
import { Loader2, RefreshCw, Sparkles } from "lucide-react";

// ——— Types (mirror GET /api/admin/ai-usage → lib/ai-usage.ts) ———

type AiUsageWindow = "24h" | "7d";

interface Totals {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  cost: number;
  cachedRequests: number;
  cacheHitRate: number | null;
}

interface ByModel {
  model: string;
  provider: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  cost: number;
  cachedRequests: number;
  cacheHitRate: number | null;
}

interface SeriesPoint {
  ts: string;
  requests: number;
  tokens: number;
  cost: number;
}

interface UsageReport {
  configured: true;
  window: AiUsageWindow;
  userId: string | null;
  totals: Totals;
  byModel: ByModel[];
  series: SeriesPoint[];
}

interface UsageUnconfigured {
  configured: false;
  missing: string[];
}

type UsageResult = UsageReport | UsageUnconfigured;

// ——— Helpers ———

function fmtInt(n: number): string {
  return n.toLocaleString();
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtCost(n: number): string {
  // AI cost is typically fractions of a cent → show enough precision.
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function fmtPercent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

async function fetchUsage(window: AiUsageWindow, userId: string): Promise<UsageResult> {
  const params = new URLSearchParams({ window });
  if (userId.trim()) params.set("userId", userId.trim());
  const res = await fetch(`/api/admin/ai-usage?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to fetch AI usage data");
  const json = await res.json();
  return json.data as UsageResult;
}

// ——— Page ———

export default function AiUsagePage() {
  const [data, setData] = useState<UsageResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [window, setWindow] = useState<AiUsageWindow>("24h");
  // The userId currently applied to the query vs. the text in the input box.
  const [userId, setUserId] = useState("");
  const [userIdInput, setUserIdInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await fetchUsage(window, userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [window, userId]);

  useEffect(() => {
    load();
  }, [load]);

  const report = data?.configured ? data : null;
  const unconfigured = data && !data.configured ? data : null;

  // Max value for normalizing the time-series bars.
  const maxSeriesTokens = report
    ? Math.max(1, ...report.series.map((p) => p.tokens))
    : 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">AI Usage &amp; Cost</h1>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Controls: window toggle + per-user filter */}
      <div className="flex flex-wrap items-end gap-4 mb-6">
        <div className="inline-flex rounded-lg border border-zinc-200 dark:border-zinc-800 overflow-hidden">
          {(["24h", "7d"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                window === w
                  ? "bg-accent text-primary"
                  : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              }`}
            >
              {w === "24h" ? "Last 24h" : "Last 7d"}
            </button>
          ))}
        </div>

        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setUserId(userIdInput);
          }}
        >
          <div className="w-64">
            <Input
              label="Filter by user ID"
              placeholder="cf-aig-metadata userId (optional)"
              value={userIdInput}
              onChange={(e) => setUserIdInput(e.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" size="md">
            Apply
          </Button>
          {userId && (
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => {
                setUserIdInput("");
                setUserId("");
              }}
            >
              Clear
            </Button>
          )}
        </form>
      </div>

      {loading && !data && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-zinc-400" />
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 px-4 py-3 text-sm text-red-700 dark:text-red-400 mb-6">
          {error}
        </div>
      )}

      {/* Unconfigured empty-state */}
      {unconfigured && (
        <Card>
          <div className="flex flex-col items-center text-center gap-3 py-10 px-6">
            <Sparkles className="h-8 w-8 text-zinc-400" />
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              AI usage analytics not configured
            </h2>
            <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
              Route AI traffic through a Cloudflare AI Gateway and grant an analytics
              token to see per-model requests, tokens, cost, and cache-hit
              rate here — plus per-user attribution.
            </p>
            <div className="text-left text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 rounded-lg px-4 py-3 mt-1">
              <p className="font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                Set these env vars:
              </p>
              <ul className="space-y-0.5 font-mono">
                {unconfigured.missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <p className="mt-2 font-sans">
                <code>CF_ANALYTICS_API_TOKEN</code> needs{" "}
                <strong>Account Analytics: Read</strong>. <code>AI_GATEWAY_ID</code> and{" "}
                <code>CLOUDFLARE_ACCOUNT_ID</code> are the same values used to route chat
                through the gateway.
              </p>
            </div>
          </div>
        </Card>
      )}

      {report && (
        <div className="space-y-6">
          {report.userId && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Scoped to user <code className="font-mono">{report.userId}</code> (via{" "}
              <code>cf-aig-metadata</code> tag).
            </p>
          )}

          {/* Headline tiles */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricCard label="Requests" value={fmtInt(report.totals.requests)} />
            <MetricCard
              label="Tokens"
              value={fmtTokens(report.totals.tokens)}
              sub={`${fmtTokens(report.totals.tokensIn)} in / ${fmtTokens(report.totals.tokensOut)} out`}
            />
            <MetricCard label="Cost" value={fmtCost(report.totals.cost)} />
            <MetricCard
              label="Cache Hit"
              value={fmtPercent(report.totals.cacheHitRate)}
              sub={`${fmtInt(report.totals.cachedRequests)} cached`}
            />
          </div>

          {/* Per-model table */}
          <Card title="By model">
            <DataTable
              columns={[
                {
                  key: "model",
                  label: "Model",
                  render: (v, row) => (
                    <span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {String(v)}
                      </span>
                      <span className="ml-2 text-xs text-zinc-400">
                        {String(row.provider)}
                      </span>
                    </span>
                  ),
                },
                {
                  key: "requests",
                  label: "Requests",
                  align: "right",
                  render: (v) => fmtInt(v as number),
                },
                {
                  key: "tokens",
                  label: "Tokens",
                  align: "right",
                  render: (v) => fmtTokens(v as number),
                },
                {
                  key: "cost",
                  label: "Cost",
                  align: "right",
                  render: (v) => fmtCost(v as number),
                },
                {
                  key: "cacheHitRate",
                  label: "Cache Hit",
                  align: "right",
                  render: (v) => fmtPercent(v as number | null),
                },
              ]}
              rows={report.byModel as unknown as Record<string, unknown>[]}
              emptyMessage="No AI Gateway requests recorded in this window."
            />
          </Card>

          {/* Time series (simple bars) */}
          <Card title={`Tokens over time (${window === "24h" ? "hourly" : "daily"})`}>
            {report.series.length === 0 ? (
              <p className="py-8 text-center text-sm text-zinc-500 dark:text-zinc-400">
                No requests in this window.
              </p>
            ) : (
              <div className="space-y-2 py-1">
                {report.series.map((p) => (
                  <PercentageBar
                    key={p.ts}
                    label={p.ts}
                    value={p.tokens / maxSeriesTokens}
                    showPercent={false}
                  />
                ))}
                <p className="text-xs text-zinc-400 pt-2">
                  Bars are token volume relative to the busiest bucket. Total cost this
                  window: <strong>{fmtCost(report.totals.cost)}</strong>.
                </p>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}
