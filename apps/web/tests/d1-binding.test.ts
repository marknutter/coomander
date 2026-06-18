import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { setD1Binding, getD1Binding } from "@/lib/db";
import { _resetDialectCache } from "@/lib/db-dialect";

describe("D1 binding seam", () => {
  const ORIGINAL_DRIVER = process.env.DATABASE_DRIVER;

  beforeEach(() => {
    _resetDialectCache();
    setD1Binding(null);
  });

  afterEach(() => {
    setD1Binding(null);
    if (ORIGINAL_DRIVER === undefined) delete process.env.DATABASE_DRIVER;
    else process.env.DATABASE_DRIVER = ORIGINAL_DRIVER;
    _resetDialectCache();
  });

  it("starts as null", () => {
    expect(getD1Binding()).toBeNull();
  });

  it("setD1Binding stores the binding for getD1Binding", () => {
    const fakeBinding = { prepare: vi.fn(), exec: vi.fn(), batch: vi.fn() };
    setD1Binding(fakeBinding);
    expect(getD1Binding()).toBe(fakeBinding);
  });

  it("setD1Binding(null) clears the binding", () => {
    setD1Binding({ prepare: vi.fn(), exec: vi.fn(), batch: vi.fn() });
    setD1Binding(null);
    expect(getD1Binding()).toBeNull();
  });

  it("getDb() throws a clear error when D1 dialect is selected without a binding", async () => {
    process.env.DATABASE_DRIVER = "d1";
    _resetDialectCache();
    // Re-import getDb dynamically so the dialect cache resolves freshly
    const { getDb } = await import("@/lib/db");
    expect(() => getDb()).toThrow(/D1 binding not available/);
  });

  it("error message mentions getCloudflareContext as the production path", async () => {
    // Documents the contract: the error tells the user that on Workers
    // the binding comes automatically from @opennextjs/cloudflare's context.
    process.env.DATABASE_DRIVER = "d1";
    _resetDialectCache();
    const { getDb } = await import("@/lib/db");
    expect(() => getDb()).toThrow(/getCloudflareContext/);
  });
});
