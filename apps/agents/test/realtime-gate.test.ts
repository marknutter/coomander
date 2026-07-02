/// <reference types="@cloudflare/vitest-pool-workers/types" />
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SELF, env } from "cloudflare:test";

// Worker-gate integration tests for the realtime transport, ported from the
// AppSeed realtime epic (template #533) into Coomander's apps/agents worker
// (#222).
//
// These run inside workerd via @cloudflare/vitest-pool-workers, exercising the
// SAME default worker handler (apps/agents/src/index.ts) as production. They
// are written against the channel-routing SPEC for the two pre-DO gates that
// are observable as plain HTTP behavior:
//
//   1. The internal publish trigger (`POST /realtime/internal/publish`) is a
//      server-to-server seam guarded by the shared `x-agents-internal-secret`
//      header (env.AGENTS_INTERNAL_SECRET). No/wrong secret → 401, BEFORE any
//      session check and before any DO is touched. With the right secret it
//      forwards to the channel DO and returns { delivered: <count> }; with no
//      socket connected the count is 0.
//
//   2. The user-facing channel route (`/realtime/<type>:<id>`) sits BEHIND the
//      session gate: a request without a valid session is refused with 401
//      before any DO is instantiated.
//
// Session validation: the worker validates by forwarding the incoming Cookie
// header to GET {WEB_ORIGIN}/api/auth/get-session. We intercept that outbound
// call by stubbing the global fetch (the main worker runs in the same isolate,
// so a global stub applies to it), and fall through to the real fetch for
// everything else (so SELF.fetch still reaches the worker).

const BASE = "http://example.com";

// WEB_ORIGIN in wrangler.toml (dev) is http://127.0.0.1:3000.
const SESSION_URL = "http://127.0.0.1:3000/api/auth/get-session";

const JSON_HEADERS = { "content-type": "application/json" } as const;

// The real global fetch — captured before stubbing so non-session requests
// (including SELF.fetch routing into the worker) still work.
const realFetch = globalThis.fetch;

type SessionBehavior = { kind: "valid"; userId: string } | { kind: "null" } | null;

let sessionBehavior: SessionBehavior = null;
let sessionCallCount = 0;

function isSessionRequest(input: RequestInfo | URL): boolean {
  let url: string;
  if (typeof input === "string") url = input;
  else if (input instanceof URL) url = input.toString();
  else url = input.url;
  return url === SESSION_URL || url.startsWith(SESSION_URL);
}

beforeEach(() => {
  sessionBehavior = null;
  sessionCallCount = 0;

  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      if (isSessionRequest(input)) {
        sessionCallCount += 1;
        const b = sessionBehavior;
        // For these gate tests we only need "no session" behavior to drive the
        // 401 path; a test that wants a valid session sets it explicitly.
        if (b === null || b.kind === "null") {
          // Better Auth returns HTTP 200 with a literal JSON `null` body for
          // no/invalid session.
          return new Response("null", { status: 200, headers: JSON_HEADERS });
        }
        return new Response(
          JSON.stringify({
            session: { id: `sess-${b.userId}`, userId: b.userId },
            user: { id: b.userId, email: `${b.userId}@example.com`, name: b.userId },
          }),
          { status: 200, headers: JSON_HEADERS },
        );
      }
      return realFetch(input as RequestInfo, init);
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Internal publish secret guard (pre-session, pre-DO)", () => {
  it("returns 401 when the x-agents-internal-secret header is MISSING", async () => {
    const res = await SELF.fetch(`${BASE}/realtime/internal/publish`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channel: "user:nobody", event: {} }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // The guard short-circuits BEFORE any session validation.
    expect(sessionCallCount).toBe(0);
  });

  it("returns 401 when the secret is WRONG", async () => {
    // Ensure there is a configured expected secret to mismatch against.
    (env as { AGENTS_INTERNAL_SECRET?: string }).AGENTS_INTERNAL_SECRET =
      "the-real-secret";
    const res = await SELF.fetch(`${BASE}/realtime/internal/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agents-internal-secret": "this-is-the-wrong-secret",
      },
      body: JSON.stringify({ channel: "user:nobody", event: {} }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(sessionCallCount).toBe(0);
  });

  it("returns 200 { delivered: 0 } with the CORRECT secret and no connected socket", async () => {
    // The vitest-pool env exposes the worker's bindings/vars; set a known
    // expected secret so we can send the matching header.
    const SECRET = "gate-test-correct-secret";
    (env as { AGENTS_INTERNAL_SECRET?: string }).AGENTS_INTERNAL_SECRET = SECRET;

    const res = await SELF.fetch(`${BASE}/realtime/internal/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agents-internal-secret": SECRET,
      },
      // A channel nobody is subscribed to → the DO broadcasts to 0 sockets.
      body: JSON.stringify({ channel: "user:nobody-is-here", event: {} }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ delivered: 0 });
    // This route is the server-to-server seam — it must NOT consult the session
    // endpoint.
    expect(sessionCallCount).toBe(0);
  });

  it("returns 400 for the correct secret but a malformed channel", async () => {
    const SECRET = "gate-test-correct-secret-2";
    (env as { AGENTS_INTERNAL_SECRET?: string }).AGENTS_INTERNAL_SECRET = SECRET;
    const res = await SELF.fetch(`${BASE}/realtime/internal/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agents-internal-secret": SECRET,
      },
      // "nocolon" has no colon → parseChannel returns null → 400 invalid channel.
      body: JSON.stringify({ channel: "nocolon", event: {} }),
    });
    expect(res.status).toBe(400);
  });
});

describe("Channel route auth gate (behind the session check)", () => {
  it("refuses /realtime/<channel> with 401 when there is no valid session", async () => {
    // No Cookie header at all → the worker treats it as no session → 401, before
    // any DO is instantiated. (A WS upgrade would be refused the same way: a
    // non-101 response declines the handshake.)
    sessionBehavior = { kind: "null" };
    const res = await SELF.fetch(`${BASE}/realtime/user:someid`);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("refuses with 401 even when a (bogus) cookie is present but the session is invalid", async () => {
    sessionBehavior = { kind: "null" };
    const res = await SELF.fetch(`${BASE}/realtime/user:someid`, {
      headers: { Cookie: "better-auth.session_token=bogus" },
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    // The worker DID forward the cookie to validate it before refusing.
    expect(sessionCallCount).toBeGreaterThanOrEqual(1);
  });
});
