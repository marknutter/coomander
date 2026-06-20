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
 * grouped by model/provider, with `sum` aggregations for requests / tokens /
 * cost / cached requests and `quantiles` for latency.
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
 * ⚠️ UNVERIFIED FIELD NAMES (same caveat as lib/email-delivery.ts):
 * Cloudflare's GraphQL Analytics schema for AI Gateway could not be verified
 * live from this environment. The dataset name, dimension names, and aggregate
 * field names below are our best understanding of the public schema and are
 * deliberately co-located at the top of this file (`AI_USAGE_QUERY`,
 * `FIELD_MAP`, `extractGroups`) so they're trivial to adjust in one place if CF
 * names differ. Every parser path degrades to 0 / null rather than throwing, so
 * a schema mismatch yields an empty (but non-crashing) dashboard, and the
 * GraphQL `errors[]` are logged for diagnosis.
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
 * 7d → daily (7 points). We ask CF to group by the matching truncated-datetime
 * dimension (`datetimeHour` / `datetimeDay`).
 */
const SERIES_DIMENSION: Record<AiUsageWindow, string> = {
  "24h": "datetimeHour",
  "7d": "datetimeDay",
};

/**
 * The AI Gateway analytics query.
 *
 * Shape mirrors the documented account-scoped adaptive-groups pattern (cf. the
 * R2 `r2OperationsAdaptiveGroups` example in CF docs):
 *
 *   viewer.accounts(filter:{accountTag}).aiGatewayRequestsAdaptiveGroups(
 *     filter:{ gateway, datetime_geq, datetime_leq, [metadataKey/metadataValue] }
 *     limit, orderBy
 *   ) { count  sum{...}  quantiles{...}  dimensions{...} }
 *
 * We run TWO group-bys in one request via aliases:
 *   - `byModel`  — grouped by model + provider (powers the per-model table +
 *      totals, which we sum client-side).
 *   - `bySeries` — grouped by the time bucket dimension (powers the chart).
 *
 * FILTERING to our gateway: `gateway: $gatewayId`. (Some schema versions name
 * this dimension `gatewayId`/`gatewayName`; `gateway` is the documented filter
 * key. If CF rejects it, that's the one-line spot to change.)
 *
 * PER-USER attribution: the optional `$userId` is threaded into the filter as a
 * `requestMetadata` match on the `userId` key we set via `cf-aig-metadata`
 * (`{userId, model}`) in apps/agents/src/chat.ts. The exact filter field for custom
 * metadata is unverified; we send `metadataKey`/`metadataValue` which is the
 * shape AI Gateway's metadata filtering uses elsewhere. When `$userId` is null
 * the metadata filter is omitted entirely (account-wide view).
 */
const AI_USAGE_QUERY = `
query AiGatewayUsage(
  $accountTag: String!
  $gatewayId: String!
  $since: Time!
  $until: Time!
  $limit: Int!
  $seriesDimension: String!
  $metadataKey: String
  $metadataValue: String
) {
  viewer {
    accounts(filter: { accountTag: $accountTag }) {
      byModel: aiGatewayRequestsAdaptiveGroups(
        filter: {
          gateway: $gatewayId
          datetime_geq: $since
          datetime_leq: $until
          metadataKey: $metadataKey
          metadataValue: $metadataValue
        }
        limit: $limit
        orderBy: [count_DESC]
      ) {
        count
        sum {
          requests
          tokensIn
          tokensOut
          cost
          cachedRequests
        }
        quantiles {
          durationMsP50
          durationMsP90
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
          metadataKey: $metadataKey
          metadataValue: $metadataValue
        }
        limit: $limit
        orderBy: [$seriesDimension]
      ) {
        count
        sum {
          requests
          tokensIn
          tokensOut
          cost
          cachedRequests
        }
        dimensions {
          ts: $seriesDimension
        }
      }
    }
  }
}`;

// The `orderBy: [$seriesDimension]` and `dimensions { ts: $seriesDimension }`
// above use a GraphQL variable in a position that CF's schema may treat as an
// enum/field name rather than a string. Because GraphQL does not allow a
// variable as a field/enum literal, we substitute the series dimension into the
// query string at call time instead. The constant above documents intent; the
// effective query is produced by `buildQuery()`.
function buildQuery(seriesDimension: string): string {
  return AI_USAGE_QUERY
    .replace("orderBy: [$seriesDimension]", `orderBy: [${seriesDimension}_ASC]`)
    .replace("ts: $seriesDimension", `ts: ${seriesDimension}`)
    // drop the now-unused $seriesDimension variable declaration so CF doesn't
    // reject the request for an unused variable
    .replace("\n  $seriesDimension: String!", "");
}

/**
 * Maps the CF `sum {}` aggregate field names → our normalized keys. Co-located
 * with the query so a CF rename is a one-line edit here. Each is read
 * defensively (missing → 0) in `extractGroups`.
 */
const FIELD_MAP = {
  requests: "requests",
  tokensIn: "tokensIn",
  tokensOut: "tokensOut",
  cost: "cost",
  cachedRequests: "cachedRequests",
} as const;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AiUsageTotals {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  tokens: number;
  cost: number;
  cachedRequests: number;
  cacheHitRate: number | null; // 0–1, null when no requests
  avgLatencyMs: number | null;
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
  latencyP50Ms: number | null;
  latencyP90Ms: number | null;
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
  requests?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  cost?: number | null;
  cachedRequests?: number | null;
}

interface RawModelGroup {
  count?: number | null;
  sum?: RawSum | null;
  quantiles?: { durationMsP50?: number | null; durationMsP90?: number | null } | null;
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

function readSum(sum: RawSum | null | undefined) {
  return {
    requests: num(sum?.[FIELD_MAP.requests]),
    tokensIn: num(sum?.[FIELD_MAP.tokensIn]),
    tokensOut: num(sum?.[FIELD_MAP.tokensOut]),
    cost: num(sum?.[FIELD_MAP.cost]),
    cachedRequests: num(sum?.[FIELD_MAP.cachedRequests]),
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
    return {
      model: g.dimensions?.model ?? "unknown",
      provider: g.dimensions?.provider ?? "unknown",
      requests: s.requests,
      tokensIn: s.tokensIn,
      tokensOut: s.tokensOut,
      tokens: s.tokensIn + s.tokensOut,
      cost: s.cost,
      cachedRequests: s.cachedRequests,
      cacheHitRate: cacheHitRate(s.requests, s.cachedRequests),
      latencyP50Ms:
        typeof g.quantiles?.durationMsP50 === "number" ? g.quantiles.durationMsP50 : null,
      latencyP90Ms:
        typeof g.quantiles?.durationMsP90 === "number" ? g.quantiles.durationMsP90 : null,
    };
  });

  // Totals: sum across models. Latency is a request-weighted average of the
  // per-model P50 (a reasonable single headline number; true global percentiles
  // can't be re-derived from per-model percentiles).
  let requests = 0,
    tokensIn = 0,
    tokensOut = 0,
    cost = 0,
    cachedRequests = 0,
    latencyWeightedSum = 0,
    latencyWeight = 0;

  for (const m of byModel) {
    requests += m.requests;
    tokensIn += m.tokensIn;
    tokensOut += m.tokensOut;
    cost += m.cost;
    cachedRequests += m.cachedRequests;
    if (m.latencyP50Ms !== null && m.requests > 0) {
      latencyWeightedSum += m.latencyP50Ms * m.requests;
      latencyWeight += m.requests;
    }
  }

  const totals: AiUsageTotals = {
    requests,
    tokensIn,
    tokensOut,
    tokens: tokensIn + tokensOut,
    cost,
    cachedRequests,
    cacheHitRate: cacheHitRate(requests, cachedRequests),
    avgLatencyMs: latencyWeight > 0 ? Math.round(latencyWeightedSum / latencyWeight) : null,
  };

  const series: AiUsageSeriesPoint[] = seriesGroups
    .map((g) => {
      const s = readSum(g.sum);
      return {
        ts: g.dimensions?.ts ?? "",
        requests: s.requests,
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

  const res = await fetch(CF_GRAPHQL_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query: buildQuery(seriesDimension),
      variables: {
        accountTag,
        gatewayId,
        since: since.toISOString(),
        until: until.toISOString(),
        limit: QUERY_LIMIT,
        // Per-user filtering: thread the userId tag through the metadata filter.
        // Omitted (null) → account-wide. See AI_USAGE_QUERY docblock.
        metadataKey: userId ? "userId" : null,
        metadataValue: userId ?? null,
      },
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
      totals: {
        requests: 0,
        tokensIn: 0,
        tokensOut: 0,
        tokens: 0,
        cost: 0,
        cachedRequests: 0,
        cacheHitRate: null,
        avgLatencyMs: null,
      },
      byModel: [],
      series: [],
    };
  }
}
