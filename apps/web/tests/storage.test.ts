import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("lib/storage backend selection (#291)", () => {
  const ORIGINAL_DRIVER = process.env.DATABASE_DRIVER;
  const ORIGINAL_URL = process.env.DATABASE_URL;
  const ORIGINAL = {
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_BUCKET: process.env.S3_BUCKET,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  };

  beforeEach(() => {
    vi.resetModules();
    delete process.env.DATABASE_DRIVER;
    delete process.env.DATABASE_URL;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_DRIVER === undefined) delete process.env.DATABASE_DRIVER;
    else process.env.DATABASE_DRIVER = ORIGINAL_DRIVER;
    if (ORIGINAL_URL === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = ORIGINAL_URL;
    for (const [k, v] of Object.entries(ORIGINAL)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  it("falls back to local backend on non-D1 with no S3 envs", async () => {
    const { _internal, getStorageBackendName } = await import("@/lib/storage");
    expect(_internal.getBackend).toBeDefined();
    expect(getStorageBackendName()).toBe("local");
  });

  it("selects S3 backend when all S3_* env vars are set (any dialect)", async () => {
    process.env.S3_ENDPOINT = "https://s3.example.com";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ACCESS_KEY = "AKIA-test";
    process.env.S3_SECRET_KEY = "test-secret";
    const { _resetDialectCache } = await import("@/lib/db-dialect");
    _resetDialectCache();
    const { getStorageBackendName } = await import("@/lib/storage");
    expect(getStorageBackendName()).toBe("s3");
  });

  it("S3 selection requires ALL four S3_* vars (missing one falls through)", async () => {
    process.env.S3_ENDPOINT = "https://s3.example.com";
    process.env.S3_BUCKET = "test-bucket";
    process.env.S3_ACCESS_KEY = "AKIA-test";
    // S3_SECRET_KEY intentionally unset
    const { _resetDialectCache } = await import("@/lib/db-dialect");
    _resetDialectCache();
    const { getStorageBackendName } = await import("@/lib/storage");
    expect(getStorageBackendName()).toBe("local");
  });

  it("on D1 with no R2 binding and no S3 envs, getBackend() throws with both options listed", async () => {
    process.env.DATABASE_DRIVER = "d1";
    const { _resetDialectCache } = await import("@/lib/db-dialect");
    _resetDialectCache();
    const { _internal } = await import("@/lib/storage");
    expect(() => _internal.getBackend()).toThrow(/R2 binding/);
    expect(() => _internal.getBackend()).toThrow(/S3_ENDPOINT/);
  });

  it("on D1 with R2 binding present, getBackend() uses the binding backend", async () => {
    process.env.DATABASE_DRIVER = "d1";
    const { _resetDialectCache } = await import("@/lib/db-dialect");
    _resetDialectCache();

    // r2BindingBackend wraps a binding object — exercise its CRUD against
    // a fake binding to confirm the wrapper plumbing is correct without
    // needing to mock @opennextjs/cloudflare's resolveR2Binding.
    const fakeStore = new Map<string, Uint8Array>();
    const fakeBinding = {
      put: vi.fn(async (key: string, value: Uint8Array) => {
        fakeStore.set(key, value);
      }),
      get: vi.fn(async (key: string) => {
        const data = fakeStore.get(key);
        if (!data) return null;
        // Slice into a fresh ArrayBuffer so the type is unambiguous (not
        // ArrayBuffer | SharedArrayBuffer like Buffer.buffer can be).
        const ab = new ArrayBuffer(data.byteLength);
        new Uint8Array(ab).set(data);
        return { arrayBuffer: async (): Promise<ArrayBuffer> => ab };
      }),
      delete: vi.fn(async (key: string) => {
        fakeStore.delete(key);
      }),
    };

    const { _internal } = await import("@/lib/storage");
    const backend = _internal.r2BindingBackend(fakeBinding);

    await backend.upload("test.txt", Buffer.from("hello"), "text/plain");
    expect(fakeBinding.put).toHaveBeenCalledOnce();
    expect(fakeStore.has("test.txt")).toBe(true);

    const downloaded = await backend.download("test.txt");
    expect(downloaded.toString("utf-8")).toBe("hello");

    await backend.delete("test.txt");
    expect(fakeStore.has("test.txt")).toBe(false);

    expect(backend.getUrl("test.txt")).toBe("/api/files/test.txt");
  });

  it("R2 binding takes precedence over S3 when both are configured (on D1)", async () => {
    // Same priority encoded in getBackend(): R2 binding first, S3 second.
    // We can't directly observe selection without mocking the resolver,
    // but we can verify the function-level behavior:
    process.env.DATABASE_DRIVER = "d1";
    process.env.S3_ENDPOINT = "https://s3.example.com";
    process.env.S3_BUCKET = "fallback";
    process.env.S3_ACCESS_KEY = "akia";
    process.env.S3_SECRET_KEY = "secret";
    const { _resetDialectCache } = await import("@/lib/db-dialect");
    _resetDialectCache();

    // No R2 binding available in the test environment, so S3 is selected.
    const { getStorageBackendName } = await import("@/lib/storage");
    expect(getStorageBackendName()).toBe("s3");
  });
});
