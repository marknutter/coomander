/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for the generate_image tool (apps/agents/src/tools.ts, #222 follow-up).
//
// Black-box over the exported tool's `handler(input, ctx)`. We never hit the
// network: globalThis.fetch is stubbed and dispatches by URL —
//   - the Workers AI flux endpoint (api.cloudflare.com/client/v4/accounts/...) → base64 image
//   - the web app store route (/api/images, reached via callAsUser → global
//     fetch when env.WEB service binding is absent) → { key }
//
// Contract under test (from the spec):
//   - happy path returns an object containing the stored `key`.
//   - missing ctx.cookie throws (storing acts AS the user).
//   - a non-ok OR empty image response from the endpoint throws (never silent).
//   - the per-conversation cap (4) refuses the over-limit call for the same
//     userId+conversationId.
//
// NOTE on harness: the agents worker uses @cloudflare/vitest-pool-workers
// (workerd via miniflare). The cap counter is module-level in-memory, so each
// test below uses a UNIQUE userId/conversationId to stay independent.
// ─────────────────────────────────────────────────────────────────────────────

import { generateImageTool } from "../src/tools";
import type { ToolContext } from "../src/tools";

// atob("aGVsbG8=") === "hello" → 5 non-empty bytes. Valid base64.
const VALID_IMAGE_B64 = "aGVsbG8=";
const STORED_KEY = "ai-images/u1/2026-01-01/x.png";

function gatewayJsonImage(b64: string = VALID_IMAGE_B64): Response {
  return new Response(JSON.stringify({ result: { image: b64 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function storeKeyResponse(key: string = STORED_KEY): Response {
  return new Response(JSON.stringify({ key }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function baseEnv(): ToolContext["env"] {
  // No WEB service binding → callAsUser falls back to global fetch (which we
  // stub). WEB_ORIGIN gives the store call a concrete absolute URL.
  return {
    CLOUDFLARE_ACCOUNT_ID: "acct-123",
    CLOUDFLARE_API_TOKEN: "cf-token-123",
    WEB_ORIGIN: "http://web.test",
  } as unknown as ToolContext["env"];
}

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    userId: "user-default",
    cookie: "better-auth.session_token=abc",
    conversationId: "conv-default",
    env: baseEnv(),
    ...overrides,
  } as ToolContext;
}

/** Default happy-path fetch: Workers AI endpoint → image, store → key. */
function happyFetch() {
  return vi.fn(async (url: unknown) => {
    const u = String(url);
    if (u.includes("api.cloudflare.com/client/v4/accounts")) return gatewayJsonImage();
    if (u.includes("/api/images")) return storeKeyResponse();
    throw new Error(`unexpected fetch URL in test: ${u}`);
  });
}

let fetchMock: ReturnType<typeof happyFetch>;

beforeEach(() => {
  fetchMock = happyFetch();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("generateImageTool.handler", () => {
  it("returns an object containing the stored key on the happy path", async () => {
    const result = (await generateImageTool.handler(
      { prompt: "a mountain at sunrise" },
      makeCtx({ userId: "user-happy", conversationId: "conv-happy" }),
    )) as { key?: string };

    expect(result.key).toBe(STORED_KEY);

    // It called the Workers AI endpoint, then the web store route.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes("api.cloudflare.com/client/v4/accounts"))).toBe(true);
    expect(
      urls.some((u) => u.includes("@cf/black-forest-labs/flux-1-schnell")),
    ).toBe(true);
    expect(urls.some((u) => u.includes("/api/images"))).toBe(true);
  });

  it("throws when ctx.cookie is missing (no interactive session)", async () => {
    await expect(
      generateImageTool.handler(
        { prompt: "anything" },
        makeCtx({ cookie: undefined, userId: "user-nocookie" }),
      ),
    ).rejects.toThrow();
  });

  it("throws when CLOUDFLARE_ACCOUNT_ID is not configured", async () => {
    await expect(
      generateImageTool.handler(
        { prompt: "anything" },
        makeCtx({
          userId: "user-noacct",
          conversationId: "conv-noacct",
          env: { WEB_ORIGIN: "http://web.test" } as unknown as ToolContext["env"],
        }),
      ),
    ).rejects.toThrow();
  });

  it("throws when the Workers AI endpoint returns a non-ok response", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.cloudflare.com/client/v4/accounts")) {
        return new Response("upstream exploded", { status: 500 });
      }
      if (u.includes("/api/images")) return storeKeyResponse();
      throw new Error(`unexpected fetch URL: ${u}`);
    });

    await expect(
      generateImageTool.handler(
        { prompt: "boom" },
        makeCtx({ userId: "user-500", conversationId: "conv-500" }),
      ),
    ).rejects.toThrow();
  });

  it("throws when the endpoint returns an empty image (not a silent success)", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.cloudflare.com/client/v4/accounts")) {
        // 200 + JSON, but no image bytes.
        return new Response(JSON.stringify({ result: { image: "" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (u.includes("/api/images")) return storeKeyResponse();
      throw new Error(`unexpected fetch URL: ${u}`);
    });

    await expect(
      generateImageTool.handler(
        { prompt: "empty" },
        makeCtx({ userId: "user-empty", conversationId: "conv-empty" }),
      ),
    ).rejects.toThrow();
  });

  it("throws when the web store route fails", async () => {
    fetchMock.mockImplementation(async (url: unknown) => {
      const u = String(url);
      if (u.includes("api.cloudflare.com/client/v4/accounts")) return gatewayJsonImage();
      if (u.includes("/api/images")) return new Response("store exploded", { status: 500 });
      throw new Error(`unexpected fetch URL: ${u}`);
    });

    await expect(
      generateImageTool.handler(
        { prompt: "store fail" },
        makeCtx({ userId: "user-storefail", conversationId: "conv-storefail" }),
      ),
    ).rejects.toThrow();
  });

  it("refuses generation past the per-conversation cap (4) for the same user+conversation", async () => {
    const ctx = makeCtx({ userId: "user-cap", conversationId: "conv-cap" });

    // The first 4 succeed and each bump the in-memory counter.
    for (let i = 0; i < 4; i++) {
      const result = (await generateImageTool.handler(
        { prompt: `image ${i}` },
        ctx,
      )) as { key?: string };
      expect(result.key).toBe(STORED_KEY);
    }

    // The 5th must be refused before doing any paid work.
    await expect(
      generateImageTool.handler({ prompt: "one too many" }, ctx),
    ).rejects.toThrow();
  });
});
