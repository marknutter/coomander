import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getDialect, isPg, isD1, _resetDialectCache } from "@/lib/db-dialect";

describe("db-dialect", () => {
  const ORIGINAL_DRIVER = process.env.DATABASE_DRIVER;
  const ORIGINAL_URL = process.env.DATABASE_URL;

  beforeEach(() => {
    _resetDialectCache();
    delete process.env.DATABASE_DRIVER;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (ORIGINAL_DRIVER === undefined) delete process.env.DATABASE_DRIVER;
    else process.env.DATABASE_DRIVER = ORIGINAL_DRIVER;
    if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_URL;
    _resetDialectCache();
  });

  it("defaults to sqlite when no env vars are set", () => {
    expect(getDialect()).toBe("sqlite");
    expect(isPg()).toBe(false);
    expect(isD1()).toBe(false);
  });

  it("selects pg when DATABASE_URL is a postgres URL", () => {
    process.env.DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    expect(getDialect()).toBe("pg");
    expect(isPg()).toBe(true);
    expect(isD1()).toBe(false);
  });

  it("selects d1 when DATABASE_DRIVER=d1", () => {
    process.env.DATABASE_DRIVER = "d1";
    expect(getDialect()).toBe("d1");
    expect(isD1()).toBe(true);
    expect(isPg()).toBe(false);
  });

  it("DATABASE_DRIVER=d1 takes precedence over DATABASE_URL", () => {
    process.env.DATABASE_DRIVER = "d1";
    process.env.DATABASE_URL = "postgres://x/y";
    expect(getDialect()).toBe("d1");
  });

  it("caches the dialect across calls", () => {
    process.env.DATABASE_DRIVER = "d1";
    expect(getDialect()).toBe("d1");
    delete process.env.DATABASE_DRIVER;
    // No reset → still d1
    expect(getDialect()).toBe("d1");
    _resetDialectCache();
    expect(getDialect()).toBe("sqlite");
  });
});
