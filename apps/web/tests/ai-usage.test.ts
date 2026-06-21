import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ─── AI Gateway usage & cost reader (#467) ──────────────────────────────────
//
// lib/ai-usage.ts (rewritten against the REAL Cloudflare GraphQL Analytics
// schema) exposes three public surfaces we test against the contract:
//
//   isAiUsageWindow(v): v is "24h" | "7d"      — window-string type guard
//   extractGroups(modelGroups, seriesGroups)   — PURE normalizer of raw CF rows
//   getAiUsage(window, userId?): Promise<...>   — credentialed reader (fetch)
//
// We test ONLY the documented contract — never the internal GraphQL query
// string, request variables, or private helpers. extractGroups is pure (no
// env, no fetch). For getAiUsage we stub global.fetch the same way
// tests/email-delivery.test.ts drives the Cloudflare GraphQL endpoint, and
// save/restore the three required env vars per test.
//
// NOTE on the new schema: there are NO latency fields anymore (no
// avgLatencyMs / latencyP50Ms / latencyP90Ms / quantiles). Token counts come
// from a cached/uncached split (tokensIn = cachedTokensIn + uncachedTokensIn,
// tokensOut = cachedTokensOut + uncachedTokensOut). Per-row request counts come
// from each group's `count`, not from `sum`.

import {
  isAiUsageWindow,
  extractGroups,
  getAiUsage,
} from "@/lib/ai-usage";

const CF_GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql";

// ─── Raw-group builders (mirror the RawModelGroup / RawSeriesGroup shapes) ────
//
// RawSum carries the cached/uncached token split + cost + cachedRequests.
// All fields are optional and may be null/undefined — the parser coerces
// non-finite/null/undefined numbers to 0.

type RawSum = {
  cachedTokensIn?: number | null;
  uncachedTokensIn?: number | null;
  cachedTokensOut?: number | null;
  uncachedTokensOut?: number | null;
  cost?: number | null;
  cachedRequests?: number | null;
};

/** Build a model group; per-row requests come from `count`. */
function modelGroup(opts: {
  count?: number | null;
  sum?: RawSum | null;
  dimensions?: { model?: string | null; provider?: string | null } | null;
}) {
  return opts;
}

/** Build a series group; the bucket label is dimensions.ts. */
function seriesGroup(opts: {
  count?: number | null;
  sum?: RawSum | null;
  dimensions?: { ts?: string | null } | null;
}) {
  return opts;
}

/** A fetch Response-like object exposing .ok + .status + .json()/.text(). */
function okFetchResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/**
 * Build a Cloudflare GraphQL "OK" body shaped like the impl reads:
 *   data.viewer.accounts[0].byModel / .bySeries
 */
function cfBody(
  byModel: ReturnType<typeof modelGroup>[],
  bySeries: ReturnType<typeof seriesGroup>[],
) {
  return {
    data: {
      viewer: {
        accounts: [{ byModel, bySeries }],
      },
    },
  };
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

/** Set all three required credentials. */
function withCreds() {
  process.env.CF_ANALYTICS_API_TOKEN = "test-cf-token";
  process.env.CLOUDFLARE_ACCOUNT_ID = "test-account-id";
  process.env.AI_GATEWAY_ID = "test-gateway";
}

/** Stub global.fetch to resolve an OK CF body. Returns the spy. */
function stubFetch(body: unknown) {
  const spy = vi.fn().mockResolvedValue(okFetchResponse(body));
  vi.stubGlobal("fetch", spy);
  return spy;
}

// What a fully zeroed totals row looks like (no requests, no rate).
const ZEROED_TOTALS = {
  requests: 0,
  tokensIn: 0,
  tokensOut: 0,
  tokens: 0,
  cost: 0,
  cachedRequests: 0,
  cacheHitRate: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. isAiUsageWindow — type guard
// ─────────────────────────────────────────────────────────────────────────────

describe("isAiUsageWindow", () => {
  it("returns true for the two supported windows", () => {
    expect(isAiUsageWindow("24h")).toBe(true);
    expect(isAiUsageWindow("7d")).toBe(true);
  });

  it("returns false for any other string", () => {
    for (const v of ["1h", "30d", "24H", "7D", "day", "", "  24h  ", "24h7d"]) {
      expect(isAiUsageWindow(v)).toBe(false);
    }
  });

  it("returns false for null / undefined", () => {
    expect(isAiUsageWindow(null)).toBe(false);
    expect(isAiUsageWindow(undefined)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. extractGroups — pure normalizer
// ─────────────────────────────────────────────────────────────────────────────

describe("extractGroups — byModel rows (happy multi-model)", () => {
  it("maps each group to a normalized row, computing tokens + cacheHitRate", () => {
    const { byModel } = extractGroups(
      [
        modelGroup({
          count: 100,
          sum: {
            cachedTokensIn: 200,
            uncachedTokensIn: 800, // tokensIn = 1000
            cachedTokensOut: 100,
            uncachedTokensOut: 400, // tokensOut = 500
            cost: 1.25,
            cachedRequests: 20,
          },
          dimensions: { model: "claude-sonnet-4", provider: "anthropic" },
        }),
        modelGroup({
          count: 40,
          sum: {
            cachedTokensIn: 50,
            uncachedTokensIn: 150, // tokensIn = 200
            cachedTokensOut: 40,
            uncachedTokensOut: 60, // tokensOut = 100
            cost: 0.5,
            cachedRequests: 10,
          },
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
      tokensIn: 1000, // cached + uncached in
      tokensOut: 500, // cached + uncached out
      tokens: 1500, // tokensIn + tokensOut
      cost: 1.25,
      cachedRequests: 20,
      cacheHitRate: 0.2, // 20 / 100
    });

    expect(byModel[1]).toMatchObject({
      model: "claude-haiku",
      provider: "anthropic",
      requests: 40,
      tokensIn: 200,
      tokensOut: 100,
      tokens: 300,
      cost: 0.5,
      cachedRequests: 10,
      cacheHitRate: 0.25, // 10 / 40
    });
  });

  it("preserves group order (one row per group)", () => {
    const { byModel } = extractGroups(
      [
        modelGroup({ count: 1, dimensions: { model: "a", provider: "p" } }),
        modelGroup({ count: 1, dimensions: { model: "b", provider: "p" } }),
        modelGroup({ count: 1, dimensions: { model: "c", provider: "p" } }),
      ],
      [],
    );
    expect(byModel.map((m) => m.model)).toEqual(["a", "b", "c"]);
  });

  it("derives requests from `count`, not from sum", () => {
    const { byModel } = extractGroups(
      [
        modelGroup({
          count: 42,
          sum: { cachedRequests: 7 },
          dimensions: { model: "m", provider: "p" },
        }),
      ],
      [],
    );
    expect(byModel[0].requests).toBe(42);
  });
});

describe("extractGroups — empty input", () => {
  it("returns empty arrays and a zeroed/null totals row", () => {
    const { totals, byModel, series } = extractGroups([], []);
    expect(byModel).toEqual([]);
    expect(series).toEqual([]);
    expect(totals).toEqual(ZEROED_TOTALS);
  });
});

describe("extractGroups — missing sum / dimensions default", () => {
  it("defaults numeric sum fields to 0 and dimensions to 'unknown' when absent", () => {
    const { byModel } = extractGroups([modelGroup({})], []);

    expect(byModel[0]).toEqual({
      model: "unknown",
      provider: "unknown",
      requests: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokens: 0,
      cost: 0,
      cachedRequests: 0,
      cacheHitRate: null, // requests === 0
    });
  });

  it("treats null sum / null dimensions like missing", () => {
    const { byModel } = extractGroups(
      [modelGroup({ count: null, sum: null, dimensions: null })],
      [],
    );
    expect(byModel[0]).toMatchObject({
      model: "unknown",
      provider: "unknown",
      requests: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokens: 0,
      cost: 0,
      cachedRequests: 0,
      cacheHitRate: null,
    });
  });

  it("fills only the missing sub-fields (partial sum / partial dimensions)", () => {
    const { byModel } = extractGroups(
      [
        modelGroup({
          count: 10,
          // only cachedTokensIn provided; everything else missing
          sum: { cachedTokensIn: 5 },
          dimensions: { model: "only-model" }, // provider missing
        }),
      ],
      [],
    );
    expect(byModel[0]).toMatchObject({
      model: "only-model",
      provider: "unknown",
      requests: 10,
      tokensIn: 5, // 5 + 0
      tokensOut: 0,
      tokens: 5,
      cost: 0,
      cachedRequests: 0,
    });
  });
});

describe("extractGroups — cacheHitRate null-on-zero + clamp", () => {
  it("is null when requests === 0 (even if cachedRequests > 0)", () => {
    const { byModel, totals } = extractGroups(
      [modelGroup({ count: 0, sum: { cachedRequests: 5 } })],
      [],
    );
    expect(byModel[0].cacheHitRate).toBeNull();
    expect(totals.cacheHitRate).toBeNull();
  });

  it("clamps to 1 when cachedRequests exceeds requests", () => {
    const { byModel } = extractGroups(
      [modelGroup({ count: 10, sum: { cachedRequests: 50 } })],
      [],
    );
    expect(byModel[0].cacheHitRate).toBe(1);
  });

  it("clamps to 0 when cachedRequests is negative", () => {
    const { byModel } = extractGroups(
      [modelGroup({ count: 10, sum: { cachedRequests: -5 } })],
      [],
    );
    expect(byModel[0].cacheHitRate).toBe(0);
  });

  it("computes the proportional rate in the normal 0–1 case", () => {
    const { byModel } = extractGroups(
      [modelGroup({ count: 8, sum: { cachedRequests: 2 } })],
      [],
    );
    expect(byModel[0].cacheHitRate).toBe(0.25);
  });
});

describe("extractGroups — totals summation", () => {
  it("sums requests/tokens/cost/cached across models and recomputes cacheHitRate", () => {
    const { totals } = extractGroups(
      [
        modelGroup({
          count: 100,
          sum: {
            cachedTokensIn: 400,
            uncachedTokensIn: 600, // tokensIn 1000
            cachedTokensOut: 200,
            uncachedTokensOut: 300, // tokensOut 500
            cost: 2,
            cachedRequests: 25,
          },
        }),
        modelGroup({
          count: 300,
          sum: {
            cachedTokensIn: 1000,
            uncachedTokensIn: 2000, // tokensIn 3000
            cachedTokensOut: 500,
            uncachedTokensOut: 1000, // tokensOut 1500
            cost: 6,
            cachedRequests: 75,
          },
        }),
      ],
      [],
    );

    expect(totals.requests).toBe(400);
    expect(totals.tokensIn).toBe(4000);
    expect(totals.tokensOut).toBe(2000);
    expect(totals.tokens).toBe(6000); // tokensIn + tokensOut
    expect(totals.cost).toBe(8);
    expect(totals.cachedRequests).toBe(100);
    expect(totals.cacheHitRate).toBe(0.25); // 100 / 400
  });

  it("totals cacheHitRate clamps to [0,1] when cachedRequests exceeds requests", () => {
    const { totals } = extractGroups(
      [
        modelGroup({ count: 10, sum: { cachedRequests: 20 } }),
        modelGroup({ count: 10, sum: { cachedRequests: 20 } }),
      ],
      [],
    );
    // 40 cached / 20 requests -> clamped to 1
    expect(totals.cacheHitRate).toBe(1);
  });
});

describe("extractGroups — series mapping + empty-ts drop", () => {
  it("maps each series group to { ts, requests, tokens, cost }", () => {
    const { series } = extractGroups(
      [],
      [
        seriesGroup({
          count: 5,
          sum: {
            cachedTokensIn: 4,
            uncachedTokensIn: 6, // 10
            cachedTokensOut: 3,
            uncachedTokensOut: 4, // 7
            cost: 0.3,
          },
          dimensions: { ts: "2026-06-18T00:00:00Z" },
        }),
        seriesGroup({
          count: 8,
          sum: {
            cachedTokensIn: 10,
            uncachedTokensIn: 10, // 20
            cachedTokensOut: 2,
            uncachedTokensOut: 3, // 5
            cost: 0.6,
          },
          dimensions: { ts: "2026-06-18T01:00:00Z" },
        }),
      ],
    );

    expect(series).toEqual([
      { ts: "2026-06-18T00:00:00Z", requests: 5, tokens: 17, cost: 0.3 },
      { ts: "2026-06-18T01:00:00Z", requests: 8, tokens: 25, cost: 0.6 },
    ]);
  });

  it("derives series requests from `count`", () => {
    const { series } = extractGroups(
      [],
      [seriesGroup({ count: 99, dimensions: { ts: "t" } })],
    );
    expect(series[0].requests).toBe(99);
  });

  it("drops points whose ts is missing or empty", () => {
    const { series } = extractGroups(
      [],
      [
        seriesGroup({ count: 1, dimensions: { ts: "valid" } }),
        seriesGroup({ count: 2, dimensions: { ts: "" } }), // dropped
        seriesGroup({ count: 3, dimensions: {} }), // ts missing -> dropped
        seriesGroup({ count: 4, dimensions: null }), // dims null -> dropped
        seriesGroup({ count: 5 }), // dims missing -> dropped
      ],
    );

    expect(series).toEqual([{ ts: "valid", requests: 1, tokens: 0, cost: 0 }]);
  });
});

describe("extractGroups — defensive against malformed numbers (no throw)", () => {
  it("coerces NaN / Infinity / -Infinity sum fields and count to 0", () => {
    const { byModel, totals, series } = extractGroups(
      [
        modelGroup({
          count: NaN,
          sum: {
            cachedTokensIn: Infinity,
            uncachedTokensIn: -Infinity,
            cachedTokensOut: NaN,
            uncachedTokensOut: Infinity,
            cost: NaN,
            cachedRequests: Infinity,
          } as RawSum,
          dimensions: { model: "m", provider: "p" },
        }),
      ],
      [
        seriesGroup({
          count: NaN,
          sum: {
            cachedTokensIn: Infinity,
            uncachedTokensIn: NaN,
            cachedTokensOut: NaN,
            uncachedTokensOut: -Infinity,
            cost: -Infinity,
          } as RawSum,
          dimensions: { ts: "t" },
        }),
      ],
    );

    expect(byModel[0]).toMatchObject({
      requests: 0,
      tokensIn: 0,
      tokensOut: 0,
      tokens: 0,
      cost: 0,
      cachedRequests: 0,
      cacheHitRate: null, // requests coerced to 0
    });
    expect(totals).toEqual(ZEROED_TOTALS);
    expect(series).toEqual([{ ts: "t", requests: 0, tokens: 0, cost: 0 }]);
  });

  it("coerces string / object / null / undefined number fields to 0 without throwing", () => {
    expect(() =>
      extractGroups(
        [
          modelGroup({
            // intentionally wrong runtime types — parser must not throw
            count: "12" as unknown as number,
            sum: {
              cachedTokensIn: undefined,
              uncachedTokensIn: ({} as unknown) as number,
              cachedTokensOut: null,
              uncachedTokensOut: "x" as unknown as number,
              cost: null,
              cachedRequests: "y" as unknown as number,
            },
            dimensions: { model: "m", provider: "p" },
          }),
        ],
        [],
      ),
    ).not.toThrow();

    const { byModel } = extractGroups(
      [
        modelGroup({
          count: "12" as unknown as number,
          sum: { cachedTokensIn: undefined, uncachedTokensIn: "5" as unknown as number },
          dimensions: { model: "m", provider: "p" },
        }),
      ],
      [],
    );
    expect(byModel[0].requests).toBe(0); // "12" string -> 0 (not a finite number)
    expect(byModel[0].tokensIn).toBe(0); // undefined + "5" string -> 0
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. getAiUsage — credentialed reader
// ─────────────────────────────────────────────────────────────────────────────

describe("getAiUsage — graceful skip when creds are missing", () => {
  it("skips with all three names when none are set, and never calls fetch", async () => {
    delete process.env.CF_ANALYTICS_API_TOKEN;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.AI_GATEWAY_ID;
    const spy = stubFetch(cfBody([], []));

    const result = await getAiUsage("24h");

    expect(result).toMatchObject({ configured: false });
    const missing = (result as { missing: string[] }).missing;
    expect(missing).toContain("CF_ANALYTICS_API_TOKEN");
    expect(missing).toContain("CLOUDFLARE_ACCOUNT_ID");
    expect(missing).toContain("AI_GATEWAY_ID");
    expect(missing).toHaveLength(3);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips when only CF_ANALYTICS_API_TOKEN is missing", async () => {
    withCreds();
    delete process.env.CF_ANALYTICS_API_TOKEN;
    const spy = stubFetch(cfBody([], []));

    const result = await getAiUsage("7d");

    expect(result).toMatchObject({ configured: false });
    expect((result as { missing: string[] }).missing).toEqual(["CF_ANALYTICS_API_TOKEN"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips when only CLOUDFLARE_ACCOUNT_ID is missing", async () => {
    withCreds();
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    const spy = stubFetch(cfBody([], []));

    const result = await getAiUsage("24h");

    expect((result as { configured: boolean }).configured).toBe(false);
    expect((result as { missing: string[] }).missing).toEqual(["CLOUDFLARE_ACCOUNT_ID"]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips when only AI_GATEWAY_ID is missing", async () => {
    withCreds();
    delete process.env.AI_GATEWAY_ID;
    const spy = stubFetch(cfBody([], []));

    const result = await getAiUsage("24h");

    expect((result as { configured: boolean }).configured).toBe(false);
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

describe("getAiUsage — happy path shape", () => {
  beforeEach(withCreds);

  it("POSTs to the CF GraphQL endpoint and returns a configured report", async () => {
    const spy = stubFetch(
      cfBody(
        [
          modelGroup({
            count: 100,
            sum: {
              cachedTokensIn: 200,
              uncachedTokensIn: 800, // tokensIn 1000
              cachedTokensOut: 100,
              uncachedTokensOut: 400, // tokensOut 500
              cost: 1.5,
              cachedRequests: 25,
            },
            dimensions: { model: "claude-sonnet-4", provider: "anthropic" },
          }),
        ],
        [
          seriesGroup({
            count: 100,
            sum: {
              cachedTokensIn: 200,
              uncachedTokensIn: 800,
              cachedTokensOut: 100,
              uncachedTokensOut: 400, // tokens 1500
              cost: 1.5,
            },
            dimensions: { ts: "2026-06-18T00:00:00Z" },
          }),
        ],
      ),
    );

    const result = await getAiUsage("24h");

    // Endpoint + method.
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(CF_GRAPHQL_ENDPOINT);
    expect((init as RequestInit).method).toBe("POST");

    expect(result).toMatchObject({
      configured: true,
      window: "24h",
      userId: null,
      totals: {
        requests: 100,
        tokensIn: 1000,
        tokensOut: 500,
        tokens: 1500,
        cost: 1.5,
        cachedRequests: 25,
        cacheHitRate: 0.25,
      },
    });

    const report = result as Extract<typeof result, { configured: true }>;
    expect(report.byModel).toHaveLength(1);
    expect(report.byModel[0]).toMatchObject({
      model: "claude-sonnet-4",
      provider: "anthropic",
      tokens: 1500,
    });
    expect(report.series).toEqual([
      { ts: "2026-06-18T00:00:00Z", requests: 100, tokens: 1500, cost: 1.5 },
    ]);
  });

  it("threads the window through to the report", async () => {
    stubFetch(cfBody([], []));

    const result = await getAiUsage("7d");

    expect(result).toMatchObject({ configured: true, window: "7d" });
  });

  it("returns empty arrays + null rate when the account has no groups", async () => {
    stubFetch(cfBody([], []));

    const result = await getAiUsage("24h");
    const report = result as Extract<typeof result, { configured: true }>;

    expect(report.byModel).toEqual([]);
    expect(report.series).toEqual([]);
    expect(report.totals).toEqual(ZEROED_TOTALS);
  });
});

describe("getAiUsage — per-user scoping", () => {
  beforeEach(withCreds);

  it("reflects the passed userId in the report", async () => {
    stubFetch(cfBody([], []));

    const result = await getAiUsage("24h", "user-123");

    expect(result).toMatchObject({ configured: true, userId: "user-123" });
  });

  it("reports userId: null when userId is explicitly null (account-wide)", async () => {
    stubFetch(cfBody([], []));

    const result = await getAiUsage("24h", null);

    expect(result).toMatchObject({ configured: true, userId: null });
  });

  it("defaults to userId: null when userId is omitted", async () => {
    stubFetch(cfBody([], []));

    const result = await getAiUsage("7d");

    expect(result).toMatchObject({ configured: true, userId: null });
  });
});

describe("getAiUsage — degrades to a zeroed configured report on error", () => {
  beforeEach(withCreds);

  it("returns a configured zeroed report (no throw) when fetch rejects", async () => {
    const spy = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", spy);

    let result: Awaited<ReturnType<typeof getAiUsage>> | undefined;
    await expect(
      (async () => {
        result = await getAiUsage("24h", "user-err");
      })(),
    ).resolves.toBeUndefined();

    expect(result).toEqual({
      configured: true,
      window: "24h",
      userId: "user-err",
      totals: ZEROED_TOTALS,
      byModel: [],
      series: [],
    });
  });

  it("returns a configured zeroed report when fetch resolves non-OK", async () => {
    const spy = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "Internal Server Error",
    } as unknown as Response);
    vi.stubGlobal("fetch", spy);

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

  it("returns a configured zeroed report when the GraphQL body carries errors[]", async () => {
    const spy = vi.fn().mockResolvedValue(
      okFetchResponse({
        data: null,
        errors: [{ message: "account not authorized" }],
      }),
    );
    vi.stubGlobal("fetch", spy);

    const result = await getAiUsage("24h");

    expect(result).toEqual({
      configured: true,
      window: "24h",
      userId: null,
      totals: ZEROED_TOTALS,
      byModel: [],
      series: [],
    });
  });
});
