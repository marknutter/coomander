import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("lib/auth — lazy initialization (#289)", () => {
  const ORIGINAL_DRIVER = process.env.DATABASE_DRIVER;
  const ORIGINAL_URL = process.env.DATABASE_URL;
  const ORIGINAL_PATH = process.env.DATABASE_PATH;
  const ORIGINAL_SECRET = process.env.BETTER_AUTH_SECRET;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_DRIVER;
    delete process.env.DATABASE_URL;
    process.env.DATABASE_PATH = ":memory:";
    process.env.BETTER_AUTH_SECRET = "test-secret-do-not-use-in-prod";
  });

  afterEach(() => {
    if (ORIGINAL_DRIVER === undefined) delete process.env.DATABASE_DRIVER;
    else process.env.DATABASE_DRIVER = ORIGINAL_DRIVER;
    if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_URL;
    if (ORIGINAL_PATH === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = ORIGINAL_PATH;
    if (ORIGINAL_SECRET === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = ORIGINAL_SECRET;
    vi.resetModules();
  });

  it("importing lib/auth does NOT construct the Better Auth instance", async () => {
    // The point of the lazy proxy: import should be a no-op for DB connection.
    // Setting DATABASE_DRIVER=d1 with no binding would crash if anything
    // tried to call getDb() at module load.
    process.env.DATABASE_DRIVER = "d1";
    const mod = await import("@/lib/auth");
    expect(mod.auth).toBeDefined();
    expect(typeof mod.auth).toBe("object");
  });

  it("first property access on `auth` triggers init (SQLite path)", async () => {
    delete process.env.DATABASE_DRIVER;
    process.env.DATABASE_PATH = ":memory:";
    const mod = await import("@/lib/auth");
    // Touch a real Better Auth property — `api` is the request-handler namespace.
    const api = mod.auth.api;
    expect(api).toBeDefined();
    // Subsequent access returns the same instance (cache works).
    const api2 = mod.auth.api;
    expect(api2).toBe(api);
  });

  it("on D1 dialect with no binding, accessing auth.api throws the binding error", async () => {
    process.env.DATABASE_DRIVER = "d1";
    const { _resetDialectCache } = await import("@/lib/db-dialect");
    _resetDialectCache();
    const { setD1Binding } = await import("@/lib/db");
    setD1Binding(null);
    const { auth, _resetAuthCache } = await import("@/lib/auth");
    _resetAuthCache();
    expect(() => auth.api).toThrow(/D1 binding not available/);
  });

  it("admin-promotion hook uses Drizzle (not raw better-sqlite3)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../lib/auth.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(source).not.toMatch(/getRawDb\(\)\s*\.\s*prepare/);
    expect(source).toMatch(/getDb\(\)\.update\(userTable\)/);
  });

  it("Proxy supports the `in` operator via has trap (better-auth toNextJsHandler relies on this)", async () => {
    // Regression for the live-deploy bug surfaced after Step 8 (#291 follow-up):
    // toNextJsHandler does `"handler" in auth ? auth.handler(...) : auth(...)`.
    // Without a `has` trap, the `in` check falls back to the empty Proxy
    // target and returns false, so the integration tries to call the Proxy
    // as a function — which throws "TypeError: auth is not a function".
    delete process.env.DATABASE_DRIVER;
    process.env.DATABASE_PATH = ":memory:";
    const { auth } = await import("@/lib/auth");
    expect("handler" in auth).toBe(true);
    expect("api" in auth).toBe(true);
    expect("nonexistentProperty" in auth).toBe(false);
  });

  it("no top-level static import of better-sqlite3 (only type-only)", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync(
      new URL("../lib/auth.ts", import.meta.url).pathname,
      "utf-8"
    );
    expect(source).toMatch(/import type Database from ["']better-sqlite3["']/);
    // Reject a runtime default import — the regex catches `import Database from "better-sqlite3"`
    // but not `import type Database from "better-sqlite3"`.
    expect(source).not.toMatch(/^import Database from ["']better-sqlite3["']/m);
  });
});
