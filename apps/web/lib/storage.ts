/**
 * File storage with three pluggable backends:
 *
 *   1. R2 binding (Cloudflare Workers + D1)
 *      Uses `getCloudflareContext().env.STORAGE` directly. No API tokens,
 *      no S3 round-trip — preferred for Workers deploys.
 *
 *   2. S3-compatible (AWS S3, R2 via S3 API, or any S3-compatible host)
 *      Uses `S3_*` env vars. Works on Workers via `fetch`, also works on
 *      Vercel/Railway/Fly. Use this when Coomander isn't on Workers.
 *
 *   3. Local filesystem (dev only)
 *      Writes under `./data/uploads`. Crashes on Workers (no fs).
 *
 * Selection priority (in `getBackend()`):
 *
 *   isD1() && env.STORAGE present  → R2 binding backend
 *   S3_* env vars set              → S3 backend
 *   !isD1()                        → local filesystem backend
 *   otherwise                      → throw with both options listed
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { log } from "@/lib/logger";
import { isD1 } from "@/lib/db-dialect";

interface UploadResult {
  key: string;
  size: number;
  contentType: string;
}

interface StorageBackend {
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
  download(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  getUrl(key: string): string;
}

/**
 * Minimal R2 binding shape — typed loosely so this file doesn't need
 * `@cloudflare/workers-types` for non-Workers builds. The real binding
 * comes from `wrangler.toml`'s `[[r2_buckets]]` block + the OpenNext
 * runtime context, mirroring the D1 binding pattern in `lib/db.ts`.
 */
interface R2Binding {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | string,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
}

// ─── Local Filesystem Backend ──────────────────────────────────────────────

const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads");

function ensureUploadsDir() {
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
}

const localBackend: StorageBackend = {
  async upload(key, buffer) {
    ensureUploadsDir();
    fs.writeFileSync(path.join(UPLOADS_DIR, key), buffer);
  },
  async download(key) {
    return fs.readFileSync(path.join(UPLOADS_DIR, key));
  },
  async delete(key) {
    const filePath = path.join(UPLOADS_DIR, key);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  },
  getUrl(key) {
    return `/api/files/${key}`;
  },
};

// ─── R2 Binding Backend ────────────────────────────────────────────────────

/**
 * Resolve the R2 binding from the Cloudflare Workers runtime context, or
 * null if not running on Workers (or the binding isn't declared).
 */
function resolveR2Binding(): R2Binding | null {
  try {
    // Dynamic require so non-Workers builds (Vercel target) don't try to
    // resolve @opennextjs/cloudflare at module load. Same pattern as the
    // D1 binding resolver in lib/db.ts (#300).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    return (ctx?.env?.STORAGE as R2Binding | undefined) ?? null;
  } catch {
    return null;
  }
}

function r2BindingBackend(binding: R2Binding): StorageBackend {
  return {
    async upload(key, buffer, contentType) {
      // R2 accepts ArrayBuffer / Uint8Array / streams / strings. Convert
      // Node's Buffer to a Uint8Array view of the same bytes.
      await binding.put(key, new Uint8Array(buffer), {
        httpMetadata: { contentType },
      });
    },
    async download(key) {
      const obj = await binding.get(key);
      if (!obj) throw new Error(`R2 object not found: ${key}`);
      return Buffer.from(await obj.arrayBuffer());
    },
    async delete(key) {
      await binding.delete(key);
    },
    getUrl(key) {
      // The binding doesn't expose a public URL. Serve via our own
      // `/api/files/[key]` route which calls download() above. For
      // static-public access, configure an R2 public bucket / custom
      // domain and override this in tenant code.
      return `/api/files/${key}`;
    },
  };
}

// ─── S3 Backend ─────────────────────────────────────────────────────────────

function getS3Backend(): StorageBackend | null {
  const endpoint = process.env.S3_ENDPOINT;
  const bucket = process.env.S3_BUCKET;
  const accessKey = process.env.S3_ACCESS_KEY;
  const secretKey = process.env.S3_SECRET_KEY;

  if (!endpoint || !bucket || !accessKey || !secretKey) return null;

  return {
    async upload(key, buffer, contentType) {
      const date = new Date().toUTCString();
      const resource = `/${bucket}/${key}`;
      const stringToSign = `PUT\n\n${contentType}\n${date}\n${resource}`;
      const signature = crypto
        .createHmac("sha1", secretKey)
        .update(stringToSign)
        .digest("base64");

      const url = `${endpoint}/${bucket}/${key}`;
      const res = await fetch(url, {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
          Date: date,
          Authorization: `AWS ${accessKey}:${signature}`,
        },
        body: new Uint8Array(buffer),
      });

      if (!res.ok) throw new Error(`S3 upload failed: ${res.status}`);
    },

    async download(key) {
      const date = new Date().toUTCString();
      const resource = `/${bucket}/${key}`;
      const stringToSign = `GET\n\n\n${date}\n${resource}`;
      const signature = crypto
        .createHmac("sha1", secretKey)
        .update(stringToSign)
        .digest("base64");

      const url = `${endpoint}/${bucket}/${key}`;
      const res = await fetch(url, {
        headers: {
          Date: date,
          Authorization: `AWS ${accessKey}:${signature}`,
        },
      });

      if (!res.ok) throw new Error(`S3 download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },

    async delete(key) {
      const date = new Date().toUTCString();
      const resource = `/${bucket}/${key}`;
      const stringToSign = `DELETE\n\n\n${date}\n${resource}`;
      const signature = crypto
        .createHmac("sha1", secretKey)
        .update(stringToSign)
        .digest("base64");

      const url = `${endpoint}/${bucket}/${key}`;
      await fetch(url, {
        method: "DELETE",
        headers: {
          Date: date,
          Authorization: `AWS ${accessKey}:${signature}`,
        },
      });
    },

    getUrl(key) {
      return `${endpoint}/${bucket}/${key}`;
    },
  };
}

// ─── Backend selection ──────────────────────────────────────────────────────

function getBackend(): StorageBackend {
  // 1. Workers + R2 binding — preferred prod path
  if (isD1()) {
    const r2 = resolveR2Binding();
    if (r2) return r2BindingBackend(r2);
  }

  // 2. S3-compatible — works on any host (AWS S3 or R2 via S3 API)
  const s3 = getS3Backend();
  if (s3) return s3;

  // 3. Local filesystem — dev only
  if (!isD1()) return localBackend;

  // 4. Misconfigured Workers deploy — fail fast at first storage call
  //    rather than letting fs.writeFileSync crash silently at request time.
  throw new Error(
    "No storage backend available. On Cloudflare Workers (DATABASE_DRIVER=d1), " +
      "configure EITHER an R2 binding (uncomment [[r2_buckets]] binding=\"STORAGE\" " +
      "in wrangler.toml and run `wrangler r2 bucket create coomander-storage`), " +
      "OR S3-compatible env vars (S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY). " +
      "See the README \"Storage\" section for both setups."
  );
}

/**
 * Generate a unique storage key for a file.
 */
export function generateFileKey(filename: string): string {
  const ext = path.extname(filename);
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
  return `${hash}${ext}`;
}

/**
 * Upload a file buffer and return metadata.
 */
export async function uploadFile(
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<UploadResult> {
  const key = generateFileKey(filename);
  const backend = getBackend();
  await backend.upload(key, buffer, contentType);
  log.info("File uploaded", { key, size: buffer.length, contentType });
  return { key, size: buffer.length, contentType };
}

/**
 * Download a file by key.
 */
export async function downloadFile(key: string): Promise<Buffer> {
  return getBackend().download(key);
}

/**
 * Delete a file by key.
 */
export async function deleteFile(key: string): Promise<void> {
  await getBackend().delete(key);
  log.info("File deleted", { key });
}

/**
 * Get a URL for accessing a file.
 */
export function getFileUrl(key: string): string {
  return getBackend().getUrl(key);
}

/**
 * Get the current storage backend name (for diagnostics / health checks).
 */
export function getStorageBackendName(): string {
  if (isD1() && resolveR2Binding()) return "r2-binding";
  if (getS3Backend()) return "s3";
  if (!isD1()) return "local";
  return "none";
}

// Internal exports for tests — let the test suite drive backend behavior
// without having to fully mock @opennextjs/cloudflare.
export const _internal = { resolveR2Binding, r2BindingBackend, getBackend };
