import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── AI Gateway usage & cost reader (#203 Phase 4) ──────────────────────────
//
// lib/ai-usage.ts exposes three public surfaces we test against the contract:
//
//   isAiUsageWindow(v): v is "24h" | "7d"      — window-string type guard
//   extractGroups(modelGroups, seriesGroups)   — PURE normalizer of raw CF rows
//   getAiUsage(window, userId?): Promise<...>   — credentialed reader (fetch)
//
// We test ONLY the documented contract — never the internal GraphQL query
// string or private helpers. extractGroups is pure (no env, no fetch). For
// getAiUsage we stub global.fetch and save/restore the three required env vars
// per test. The headline spec point: when creds are unset getAiUsage returns
// `{ configured: false, missing: [...] }` and never calls fetch / never throws.

import { isAiUsageWindow, extractGroups, getAiUsage } from "@/lib/ai-usage";

const CF_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

// ─── Raw-group builders (mirror the RawModelGroup / RawSeriesGroup shapes) ────

type RawSum = {
  requests?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  cost?: number | null;
  cachedRequests?: number | null;
};

function modelGroup(opts: {
  count?: number | null;
  sum?: RawSum | null;
  quantiles?: { durationMsP50?: number | null; durationMsP90?: number | null } | null;
  dimensions?: { model?: string | null; provider?: string | null } | null;
}) {
  return opts;
}

function seriesGroup(opts: {
  count?: number | null;
  sum?: RawSum | null;
  dimensions?: { ts?: string | null } | null;
}) {
  return opts;
}

function okFetchResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

function cfBody(
  byModel: ReturnType<typeof modelGroup>[],
  bySeries: ReturnType<typeof seriesGroup>[],
) {
  return { data: { viewer: { accounts: [{ byModel, bySeries }] } } };
}

// ─── Env-var + fetch lifecycle ───────────────────────────────────────────────

const REAL_FETCH = global.fetch;
let originalToken: string | undefined;
let originalAccount: string | undefined;
let originalGateway: string | undefined;

beforeEach(() => {
  originalToken = process.env.CF_ANALYTICS_API_TOKEN;
  originalAccount = process.env.CLOUDFLARE_ACCOUNT_ID;
  originalGateway = process.env.AI_GATEWAY_ID;
});

afterEach(() => {
  const restore = (name: string, val: string | undefined) => {
    if (val === undefined) delete process.env[name];
    else process.env[name] = val;
  };
  restore("CF_ANALYTICS_API_TOKEN", originalToken);
  restore("CLOUDFLARE_ACCOUNT_ID", originalAccount);
  restore("AI_GATEWAY_ID", originalGateway);

  vi.unstubAllGlobals();
  global.fetch = REAL_FETCH;
});

function withCreds() {
  process.env.CF_ANALYTICS_API_TOKEN = "test-cf-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account-id";
  process.env.AI_GATEWAY_ID = "test-gateway";
}

function stubFetch(body: unknown) {
  const spy = vi.fn().mockResolvedValue(okFetchResponse(body));
  vi.stubGlobal("fetch", spy);
  return spy;
}

function postedBody(spy: ReturnType<typeof vi.fn>): {
  query: string;
  variables: Record<string, unknown>;
} {
  const [, init] = spy.mock.calls[0];
  return JSON.parse((init as RequestInit).body as string);
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. isAiUsageWindow — type guard
// ─────────────────────────────────────────────────────────────────────────────

describe("isAiUsageWindow", () => {
  it("returns true for the two supported windows", () => {
    expect(isAiUsageWindow("24h")).toBe(true);
    expect(isAiUsageWindow("7d")).toBe(true);
  });

  it("returns false for any other string / null / undefined", () => {
    for (const v of ["1h", "30d", "24H", "7D", "day", "", "  24h  "]) {
      expect(isAiUsageWindow(v)).toBe(false);
    }
    expect(isAiUsageWindow(null)).toBe(false);
    expect(isAiUsageWindow(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. extractGroups — pure normalizer
// ─────────────────────────────────────────────────────────────────────────────

describe("extractGroups — byModel rows", () => {
  it("maps each group to a normalized row, computing tokens + cacheHitRate", () => {
    const { byModel } = extractGroups(
      [
        modelGroup({
          sum: { requests: 100, tokensIn: 1000, tokensOut: 500, cost: 1.25, cachedRequests: 20 },
          quantiles: { durationMsP50: 200, durationMsP90: 800 },
          dimensions: { model: "claude-sonnet-4", provider: "anthropic" },
        }),
        modelGroup({
          sum: { requests: 40, tokensIn: 200, tokensOut: 100, cost: 0.5, cachedRequests: 10 },
          quantiles: { durationMsP50: 50, durationMsP90: 120 },
          dimensions: { model: "claude-haiku", provider: "anthropic" },
        }),
      ],
      [],
    );

    expect(byModel).toHaveLength(2);
    expect(byModel[0]).toEqual({
      model: "claude-sonnet-4",
      provider: "anthropic",
      requests: 100,
      tokensIn: 1000,
      tokensOut: 500,
      tokens: 1500,
      cost: 1.25,
      cachedRequests: 20,
      cacheHitRate: 0.2,
      latencyP50Ms: 200,
      latencyP90Ms: 800,
    });
    expect(byModel[1]).toMatchObject({ model: "claude-haiku", tokens: 300, cacheHitRate: 0.25 });
  });

  it("preserves group order", () => {
    const { byModel } = extractGroups(
      [
        modelGroup({ dimensions: { model: "a", provider: "p" } }),
        modelGroup({ dimensions: { model: "b", provider: "p" } }),
        modelGroup({ dimensions: { model: "c", provider: "p" } }),
      ],
      [],
    );
    expect(byModel.map((m) => m.model)).toEqual(["a", "b", "c"]);
  });
});

describe("extractGroups — empty / missing / defensive", () => {
  it("returns empty arrays and zeroed/null totals on empty input", () => {
    const { totals, byModel, series } = extractGroups([], []);
    expect(byModel).toEqual([]);
    expect(series).toEqual([]);
    expect(totals).toEqual({
      requests: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokens: 0,
      cost: 0,
      cachedRequests: 0,
      cacheHitRate: null,
      avgLatencyMs: null,
    });
  });

  it("defaults numeric fields to 0 and dimensions to 'unknown' when absent / null", () => {
    const { byModel } = extractGroups(
      [modelGroup({}), modelGroup({ sum: null, dimensions: null, quantiles: null })],
      [],
    );
    for (const row of byModel) {
      expect(row).toMatchObject({
        model: "unknown",
        provider: "unknown",
        requests: 0,
        tokens: 0,
        cacheHitRate: null,
        latencyP50Ms: null,
        latencyP90Ms: null,
      });
    }
  });

  it("coerces NaN / Infinity / non-number fields to 0 without throwing", () => {
    expect(() =>
      extractGroups(
        [
          modelGroup({
            sum: {
              requests: NaN,
              tokensIn: Infinity,
              tokensOut: -Infinity,
              cost: "x" as unknown as number,
              cachedRequests: undefined,
            } as RawSum,
            dimensions: { model: "m", provider: "p" },
          }),
        ],
        [seriesGroup({ sum: { requests: NaN } as RawSum, dimensions: { ts: "t" } })],
      ),
    ).not.toThrow();

    const { byModel, series } = extractGroups(
      [modelGroup({ sum: { requests: NaN } as RawSum, dimensions: { model: "m", provider: "p" } })],
      [seriesGroup({ sum: { requests: NaN } as RawSum, dimensions: { ts: "t" } })],
    );
    expect(byModel[0].requests).toBe(0);
    expect(byModel[0].cacheHitRate).toBeNull();
    expect(series).toEqual([{ ts: "t", requests: 0, tokens: 0, cost: 0 }]);
  });
});

describe("extractGroups — cacheHitRate null-on-zero + clamp", () => {
  it("is null when requests === 0 even if cachedRequests > 0", () => {
    const { byModel } = extractGroups([modelGroup({ sum: { requests: 0, cachedRequests: 5 } })], []);
    expect(byModel[0].cacheHitRate).toBeNull();
  });

  it("clamps to 1 when cachedRequests exceeds requests", () => {
    const { byModel } = extractGroups([modelGroup({ sum: { requests: 10, cachedRequests: 50 } })], []);
    expect(byModel[0].cacheHitRate).toBe(1);
  });

  it("computes the proportional rate in the normal 0–1 case", () => {
    const { byModel } = extractGroups([modelGroup({ sum: { requests: 8, cachedRequests: 2 } })], []);
    expect(byModel[0].cacheHitRate).toBe(0.25);
  });
});

describe("extractGroups — totals + weighted latency", () => {
  it("sums across models and recomputes cacheHitRate", () => {
    const { totals } = extractGroups(
      [
        modelGroup({ sum: { requests: 100, tokensIn: 1000, tokensOut: 500, cost: 2, cachedRequests: 25 } }),
        modelGroup({ sum: { requests: 300, tokensIn: 3000, tokensOut: 1500, cost: 6, cachedRequests: 75 } }),
      ],
      [],
    );
    expect(totals.requests).toBe(400);
    expect(totals.tokens).toBe(6000);
    expect(totals.cost).toBe(8);
    expect(totals.cacheHitRate).toBe(0.25);
  });

  it("avgLatencyMs is the request-weighted average of per-model P50, rounded", () => {
    const { totals } = extractGroups(
      [
        modelGroup({ sum: { requests: 100 }, quantiles: { durationMsP50: 100 } }),
        modelGroup({ sum: { requests: 300 }, quantiles: { durationMsP50: 300 } }),
      ],
      [],
    );
    expect(totals.avgLatencyMs).toBe(250); // (100*100 + 300*300)/400
  });

  it("is null when no model has both weight and a P50", () => {
    const { totals } = extractGroups(
      [
        modelGroup({ sum: { requests: 0 }, quantiles: { durationMsP50: 100 } }),
        modelGroup({ sum: { requests: 100 } }),
      ],
      [],
    );
    expect(totals.avgLatencyMs).toBeNull();
  });
});

describe("extractGroups — series mapping + empty-ts drop", () => {
  it("maps each series group to { ts, requests, tokens, cost }", () => {
    const { series } = extractGroups(
      [],
      [
        seriesGroup({ sum: { requests: 5, tokensIn: 10, tokensOut: 7, cost: 0.3 }, dimensions: { ts: "t0" } }),
        seriesGroup({ sum: { requests: 8, tokensIn: 20, tokensOut: 5, cost: 0.6 }, dimensions: { ts: "t1" } }),
      ],
    );
    expect(series).toEqual([
      { ts: "t0", requests: 5, tokens: 17, cost: 0.3 },
      { ts: "t1", requests: 8, tokens: 25, cost: 0.6 },
    ]);
  });

  it("drops points whose ts is missing or empty", () => {
    const { series } = extractGroups(
      [],
      [
        seriesGroup({ sum: { requests: 1 }, dimensions: { ts: "valid" } }),
        seriesGroup({ sum: { requests: 2 }, dimensions: { ts: "" } }),
        seriesGroup({ sum: { requests: 3 }, dimensions: {} }),
        seriesGroup({ sum: { requests: 4 }, dimensions: null }),
        seriesGroup({ sum: { requests: 5 } }),
      ],
    );
    expect(series).toEqual([{ ts: "valid", requests: 1, tokens: 0, cost: 0 }]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. getAiUsage — graceful empty-state (the headline spec point)
// ─────────────────────────────────────────────────────────────────────────────

describe("getAiUsage — graceful skip when creds are missing", () => {
  it("returns { configured: false, missing: [all three] } and never calls fetch", async () => {
    delete process.env.CF_ANALYTICS_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.AI_GATEWAY_ID;
    const spy = stubFetch(cfBody([], []));

    const result = await getAiUsage("24h");

    expect(result).toEqual({
      configured: false,
      missing: ["CF_ANALYTICS_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "AI_GATEWAY_ID"],
    });
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports only the single missing var (token)", async () => {
    withCreds();
    delete process.env.CF_ANALYTICS_API_TOKEN;
    const spy = stubFetch(cfBody([], []));
    const result = await getAiUsage("7d");
    expect(result).toMatchObject({ configured: false });
    expect((result as { missing: string[] }).missing).toEqual(["CF_ANALYTICS_API_TOKEN"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports only the single missing var (account id)", async () => {
    withCreds();
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    const spy = stubFetch(cfBody([], []));
    const result = await getAiUsage("24h");
    expect((result as { missing: string[] }).missing).toEqual(["CLOUDFLARE_ACCOUNT_ID"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("reports only the single missing var (gateway id)", async () => {
    withCreds();
    delete process.env.AI_GATEWAY_ID;
    const spy = stubFetch(cfBody([], []));
    const result = await getAiUsage("24h");
    expect((result as { missing: string[] }).missing).toEqual(["AI_GATEWAY_ID"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("does not throw when skipping", async () => {
    delete process.env.CF_ANALYTICS_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.AI_GATEWAY_ID;
    await expect(getAiUsage("24h")).resolves.toMatchObject({ configured: false });
  });
});

describe("getAiUsage — configured happy path", () => {
  beforeEach(withCreds);

  it("POSTs to the CF GraphQL endpoint with a bearer header and returns a configured report", async () => {
    const spy = stubFetch(
      cfBody(
        [
          modelGroup({
            sum: { requests: 100, tokensIn: 1000, tokensOut: 500, cost: 1.5, cachedRequests: 25 },
            quantiles: { durationMsP50: 200, durationMsP90: 600 },
            dimensions: { model: "claude-sonnet-4", provider: "anthropic" },
          }),
        ],
        [seriesGroup({ sum: { requests: 100, tokensIn: 1000, tokensOut: 500, cost: 1.5 }, dimensions: { ts: "t0" } })],
      ),
    );

    const result = await getAiUsage("24h");

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(CF_GRAPHQL_ENDPOINT);
    expect((init as RequestInit).method).toBe("POST");
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe(
      "Bearer test-cf-token",
    );
    expect(result).toMatchObject({
      configured: true,
      window: "24h",
      userId: null,
      totals: { requests: 100, tokens: 1500, cost: 1.5, cacheHitRate: 0.25, avgLatencyMs: 200 },
    });
  });

  it("threads a userId into the metadata filter variables", async () => {
    const spy = stubFetch(cfBody([], []));
    const result = await getAiUsage("24h", "user-123");
    expect(result).toMatchObject({ configured: true, userId: "user-123" });
    const { variables } = postedBody(spy);
    expect(variables.metadataKey).toBe("userId");
    expect(variables.metadataValue).toBe("user-123");
  });

  it("sends null metadata (account-wide) when userId is omitted", async () => {
    const spy = stubFetch(cfBody([], []));
    await getAiUsage("7d");
    const { variables } = postedBody(spy);
    expect(variables.metadataKey).toBeNull();
    expect(variables.metadataValue).toBeNull();
  });
});

describe("getAiUsage — degrades to a zeroed configured report on error (no throw)", () => {
  beforeEach(withCreds);

  const ZEROED_TOTALS = {
    requests: 0,
    tokensIn: 0,
    tokensOut: 0,
    tokens: 0,
    cost: 0,
    cachedRequests: 0,
    cacheHitRate: null,
    avgLatencyMs: null,
  };

  it("returns a zeroed configured report when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const result = await getAiUsage("24h", "user-err");
    expect(result).toEqual({
      configured: true,
      window: "24h",
      userId: "user-err",
      totals: ZEROED_TOTALS,
      byModel: [],
      series: [],
    });
  });

  it("returns a zeroed configured report when fetch resolves non-OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => "Internal Server Error",
      } as unknown as Response),
    );
    const result = await getAiUsage("7d");
    expect(result).toEqual({
      configured: true,
      window: "7d",
      userId: null,
      totals: ZEROED_TOTALS,
      byModel: [],
      series: [],
    });
  });

  it("returns a zeroed configured report when the GraphQL body carries errors[]", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okFetchResponse({ data: null, errors: [{ message: "not authorized" }] })),
    );
    const result = await getAiUsage("24h");
    expect(result).toMatchObject({ configured: true, byModel: [], series: [] });
    expect((result as { totals: typeof ZEROED_TOTALS }).totals).toEqual(ZEROED_TOTALS);
  });
});
