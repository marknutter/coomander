/**
 * AI Gateway Phase 4 — in-app AI usage & cost reader.
 *
 * AI Gateway already shows usage/cost in the Cloudflare dashboard. This module
 * pulls the same numbers in-app (so the admin dashboard at /admin/ai-usage can
 * render them) AND adds **per-user attribution** by filtering on the
 * `cf-aig-metadata` `userId` tag the agents Worker sets (apps/agents/src/chat.ts).
 *
 * Data source: the **Cloudflare GraphQL Analytics API** (account-scoped). The
 * AI Gateway request analytics live under
 * `viewer.accounts(filter:{accountTag}).aiGatewayRequestsAdaptiveGroups`,
 * grouped by model/provider (or a time bucket), with the group-level `count`
 * giving the request count and `sum` aggregating tokens / cost / cached requests.
 *
 * Auth + filtering:
 *   - `CF_ANALYTICS_API_TOKEN`  — Cloudflare API token with **Account
 *     Analytics: Read** (account-scoped — distinct from the *Zone* Analytics
 *     scope the email poller in lib/email-delivery.ts uses; the same token can
 *     carry both grants).
 *   - `CLOUDFLARE_ACCOUNT_ID`   — the account the gateway lives in.
 *   - `AI_GATEWAY_ID`           — the gateway name/slug, used to filter to OUR
 *     gateway (same value apps/agents uses to build the gateway baseURL).
 *
 * GRACEFUL SKIP: when any of those three are unset, every public function
 * returns an "unconfigured" marker (`{ configured: false, ... }`) and NEVER
 * throws. This mirrors `syncEmailDelivery` (lib/email-delivery.ts) and
 * `runHealthProbe` — an unconfigured deploy renders a friendly empty-state, not
 * an error.
 *
 * SCHEMA NOTES (verified live against the CF GraphQL Analytics API):
 *   - The `aiGatewayRequestsAdaptiveGroups` group type exposes
 *     `{ count, sum, dimensions, confidence }` — there is **no `quantiles`**
 *     field, so request-duration percentiles (latency p50/p90) are NOT available
 *     from this dataset and the dashboard does not surface them.
 *   - `sum` exposes split token counters
 *     (`cachedTokensIn`/`uncachedTokensIn`/`cachedTokensOut`/`uncachedTokensOut`),
 *     plus `cost`, `cachedRequests`, `erroredRequests`. There is no `requests`
 *     sum — the request count is the group-level `count`.
 *   - The daily series bucket dimension is `date` (there is no `datetimeDay`);
 *     the hourly bucket is `datetimeHour`.
 *   - Per-user attribution filters on `metadataValues_has: <userId>` — the
 *     `cf-aig-metadata` we set is `{userId, model}`, so the userId appears in the
 *     request's metadata *values* array. (There is no `metadataKey`/
 *     `metadataValue` equality filter on this dataset.)
 * The field names are co-located at the top of this file (`AI_USAGE_QUERY`,
 * `readSum`, `extractGroups`) so a CF rename is a one-place edit, and every
 * parser path degrades to 0 / null rather than throwing.
 */

import { log } from "@/lib/logger";

// ─── Configuration: the GraphQL query, field mapping, windows ────────────────

const CF_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

/** Max groups to pull per query. CF caps GraphQL `limit` at 10000. */
const QUERY_LIMIT = 10000;

/**
 * Supported lookback windows. The key is the `?window=` query param value; the
 * value is the lookback in hours used to compute the `since` bound. CF retains
 * AI Gateway analytics well beyond 7 days, so both windows are comfortably
 * inside retention.
 */
export const WINDOW_HOURS: Record<AiUsageWindow, number> = {
  "24h": 24,
  "7d": 24 * 7,
};

export type AiUsageWindow = "24h" | "7d";

export function isAiUsageWindow(v: string | null | undefined): v is AiUsageWindow {
  return v === "24h" || v === "7d";
}

/**
 * How wide each time-series bucket is, per window. 24h → hourly (24 points),
 * 7d → daily (7 points). CF's adaptive-groups dimension for the daily bucket is
 * `date` (NOT `datetimeDay` — that dimension does not exist on this dataset).
 */
const SERIES_DIMENSION: Record<AiUsageWindow, string> = {
  "24h": "datetimeHour",
  "7d": "date",
};

/**
 * The AI Gateway analytics query.
 *
 *   viewer.accounts(filter:{accountTag}).aiGatewayRequestsAdaptiveGroups(
 *     filter:{ gateway, datetime_geq, datetime_leq, [metadataValues_has] }
 *     limit, orderBy
 *   ) { count  sum{...}  dimensions{...} }
 *
 * Two group-bys run in one request via aliases:
 *   - `byModel`  — grouped by model + provider (powers the per-model table +
 *      totals, which we sum client-side).
 *   - `bySeries` — grouped by the time bucket dimension (powers the chart).
 *
 * `__SERIES__` (the time bucket dimension) and `__METADATA_FILTER__` (the
 * optional per-user filter) are substituted in `buildQuery()` — GraphQL does not
 * allow a variable as a field/enum literal, and the metadata filter must be
 * omitted entirely (not passed as null) for the account-wide view.
 */
const AI_USAGE_QUERY = `
query AiGatewayUsage(
  $accountTag: String!
  $gatewayId: String!
  $since: Time!
  $until: Time!
  $limit: Int!
  $userId: String!
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      byModel: aiGatewayRequestsAdaptiveGroups(
        filter: {
          gateway: $gatewayId
          datetime_geq: $since
          datetime_leq: $until
          __METADATA_FILTER__
        }
        limit: $limit
        orderBy: [count_DESC]
      ) {
        count
        sum {
          cachedTokensIn
          uncachedTokensIn
          cachedTokensOut
          uncachedTokensOut
          cost
          cachedRequests
        }
        dimensions {
          model
          provider
        }
      }
      bySeries: aiGatewayRequestsAdaptiveGroups(
        filter: {
          gateway: $gatewayId
          datetime_geq: $since
          datetime_leq: $until
          __METADATA_FILTER__
        }
        limit: $limit
        orderBy: [__SERIES___ASC]
      ) {
        count
        sum {
          cachedTokensIn
          uncachedTokensIn
          cachedTokensOut
          uncachedTokensOut
          cost
          cachedRequests
        }
        dimensions {
          ts: __SERIES__
        }
      }
    }
  }
}`;

/**
 * Substitute the series dimension and the optional per-user metadata filter into
 * the query string. When not scoped to a user we both drop the filter clause AND
 * remove the now-unused `$userId` variable declaration (CF rejects unused
 * variables).
 */
function buildQuery(seriesDimension: string, scopedToUser: boolean): string {
  let q = AI_USAGE_QUERY
    .replaceAll("__SERIES__", seriesDimension)
    .replaceAll("__METADATA_FILTER__", scopedToUser ? "metadataValues_has: $userId" : "");
  if (!scopedToUser) {
    q = q.replace("\n  $userId: String!", "");
  }
  return q;
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AiUsageTotals {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  cost: number;
  cachedRequests: number;
  cacheHitRate: number | null; // 0–1, null when no requests
}

export interface AiUsageByModel {
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

export interface AiUsageSeriesPoint {
  ts: string; // ISO-ish bucket label from CF
  requests: number;
  tokens: number;
  cost: number;
}

export interface AiUsageReport {
  configured: true;
  window: AiUsageWindow;
  /** Present only when the report is scoped to a single user. */
  userId: string | null;
  totals: AiUsageTotals;
  byModel: AiUsageByModel[];
  series: AiUsageSeriesPoint[];
}

export interface AiUsageUnconfigured {
  configured: false;
  /** Which of the required env vars are missing (names only — never values). */
  missing: string[];
}

export type AiUsageResult = AiUsageReport | AiUsageUnconfigured;

// ─── Raw GraphQL response shapes (all optional — parsed defensively) ──────────

interface RawSum {
  cachedTokensIn?: number | null;
  uncachedTokensIn?: number | null;
  cachedTokensOut?: number | null;
  uncachedTokensOut?: number | null;
  cost?: number | null;
  cachedRequests?: number | null;
}

interface RawModelGroup {
  count?: number | null;
  sum?: RawSum | null;
  dimensions?: { model?: string | null; provider?: string | null } | null;
}

interface RawSeriesGroup {
  count?: number | null;
  sum?: RawSum | null;
  dimensions?: { ts?: string | null } | null;
}

interface RawAccount {
  byModel?: RawModelGroup[] | null;
  bySeries?: RawSeriesGroup[] | null;
}

interface RawResponse {
  data?: { viewer?: { accounts?: RawAccount[] | null } | null } | null;
  errors?: Array<{ message: string }> | null;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function num(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Normalize a `sum {}` block. Total tokens are the cached + uncached split CF
 * exposes (there is no flat `tokensIn`/`tokensOut` aggregate). Request count is
 * NOT here — it's the group-level `count` (read in `extractGroups`).
 */
function readSum(sum: RawSum | null | undefined) {
  return {
    tokensIn: num(sum?.cachedTokensIn) + num(sum?.uncachedTokensIn),
    tokensOut: num(sum?.cachedTokensOut) + num(sum?.uncachedTokensOut),
    cost: num(sum?.cost),
    cachedRequests: num(sum?.cachedRequests),
  };
}

function cacheHitRate(requests: number, cached: number): number | null {
  if (requests <= 0) return null;
  // Clamp — cached should never exceed requests, but guard against odd data.
  return Math.min(Math.max(cached / requests, 0), 1);
}

/**
 * Normalize the two adaptive-groups arrays into per-model rows, a time series,
 * and account-wide totals. Pure + defensive so a schema drift yields empty
 * data rather than a throw.
 */
export function extractGroups(
  modelGroups: RawModelGroup[],
  seriesGroups: RawSeriesGroup[],
): { totals: AiUsageTotals; byModel: AiUsageByModel[]; series: AiUsageSeriesPoint[] } {
  const byModel: AiUsageByModel[] = modelGroups.map((g) => {
    const s = readSum(g.sum);
    const requests = num(g.count);
    return {
      model: g.dimensions?.model ?? "unknown",
      provider: g.dimensions?.provider ?? "unknown",
      requests,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokens: s.tokensIn + s.tokensOut,
      cost: s.cost,
      cachedRequests: s.cachedRequests,
      cacheHitRate: cacheHitRate(requests, s.cachedRequests),
    };
  });

  let requests = 0,
    tokensIn = 0,
    tokensOut = 0,
    cost = 0,
    cachedRequests = 0;

  for (const m of byModel) {
    requests += m.requests;
    tokensIn += m.tokensIn;
    tokensOut += m.tokensOut;
    cost += m.cost;
    cachedRequests += m.cachedRequests;
  }

  const totals: AiUsageTotals = {
    requests,
    tokensIn,
    tokensOut,
    tokens: tokensIn + tokensOut,
    cost,
    cachedRequests,
    cacheHitRate: cacheHitRate(requests, cachedRequests),
  };

  const series: AiUsageSeriesPoint[] = seriesGroups
    .map((g) => {
      const s = readSum(g.sum);
      return {
        ts: g.dimensions?.ts ?? "",
        requests: num(g.count),
        tokens: s.tokensIn + s.tokensOut,
        cost: s.cost,
      };
    })
    .filter((p) => p.ts !== "");

  return { totals, byModel, series };
}

// ─── GraphQL fetch ───────────────────────────────────────────────────────────

async function fetchUsage(
  token: string,
  accountTag: string,
  gatewayId: string,
  window: AiUsageWindow,
  userId: string | null,
): Promise<{ totals: AiUsageTotals; byModel: AiUsageByModel[]; series: AiUsageSeriesPoint[] }> {
  const until = new Date();
  const since = new Date(until.getTime() - WINDOW_HOURS[window] * 60 * 60 * 1000);
  const seriesDimension = SERIES_DIMENSION[window];
  const scopedToUser = userId !== null && userId !== "";

  const variables: Record<string, unknown> = {
    accountTag,
    gatewayId,
    since: since.toISOString(),
    until: until.toISOString(),
    limit: QUERY_LIMIT,
  };
  // Per-user filtering: thread the userId tag through `metadataValues_has`.
  // Omitted entirely → account-wide. See AI_USAGE_QUERY docblock.
  if (scopedToUser) variables.userId = userId;

  const res = await fetch(CF_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: buildQuery(seriesDimension, scopedToUser),
      variables,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`CF GraphQL Analytics error ${res.status}: ${body}`);
  }

  const json = (await res.json()) as RawResponse;

  if (json.errors && json.errors.length > 0) {
    throw new Error(
      `CF GraphQL Analytics returned errors: ${json.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const account = json.data?.viewer?.accounts?.[0];
  return extractGroups(account?.byModel ?? [], account?.bySeries ?? []);
}

// ─── Public entry point ───────────────────────────────────────────────────────

const EMPTY_TOTALS: AiUsageTotals = {
  requests: 0,
  tokensIn: 0,
  tokensOut: 0,
  tokens: 0,
  cost: 0,
  cachedRequests: 0,
  cacheHitRate: null,
};

/**
 * Read AI Gateway usage/cost for the given window, optionally scoped to one
 * user (`userId` → filters on the `cf-aig-metadata` userId tag).
 *
 * GRACEFUL: returns `{ configured: false, missing: [...] }` when creds are
 * unset, and never throws — on any transport/GraphQL error it logs and returns
 * an empty-but-configured report so the dashboard shows zeros, not a crash.
 */
export async function getAiUsage(
  window: AiUsageWindow,
  userId: string | null = null,
): Promise<AiUsageResult> {
  const token = process.env.CF_ANALYTICS_API_TOKEN;
  const accountTag = process.env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayId = process.env.AI_GATEWAY_ID;

  const missing: string[] = [];
  if (!token) missing.push("CF_ANALYTICS_API_TOKEN");
  if (!accountTag) missing.push("CLOUDFLARE_ACCOUNT_ID");
  if (!gatewayId) missing.push("AI_GATEWAY_ID");

  if (missing.length > 0 || !token || !accountTag || !gatewayId) {
    log.debug("AI usage analytics not configured, skipping", { missing });
    return { configured: false, missing };
  }

  try {
    const { totals, byModel, series } = await fetchUsage(
      token,
      accountTag,
      gatewayId,
      window,
      userId,
    );
    return { configured: true, window, userId, totals, byModel, series };
  } catch (err) {
    log.warn("getAiUsage failed", {
      error: err instanceof Error ? err.message : String(err),
      window,
      scopedToUser: !!userId,
    });
    // Degrade to an empty (but configured) report so the dashboard renders
    // zeros + a note rather than an error toast.
    return {
      configured: true,
      window,
      userId,
      totals: { ...EMPTY_TOTALS },
      byModel: [],
      series: [],
    };
  }
}
