/**
 * In-memory sliding-window rate limiter for API routes.
 *
 * Usage:
 *   import { rateLimit, authRateLimit } from "@/lib/rate-limit";
 *
 *   // In an API route handler:
 *   export async function POST(request: NextRequest) {
 *     const limited = authRateLimit.check(request);
 *     if (limited) return limited;
 *     // ... handle request
 *   }
 *
 * Configuration via env vars:
 *   RATE_LIMIT_API — requests per window for general API (default: 60)
 *   RATE_LIMIT_AUTH — requests per window for auth routes (default: 5)
 *   RATE_LIMIT_WINDOW_MS — window size in ms (default: 60000 = 1 minute)
 */

import { NextRequest, NextResponse } from "next/server";

export interface RateLimitConfig {
  /** Maximum requests per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

interface TokenBucket {
  timestamps: number[];
}

export class RateLimiter {
  private store = new Map<string, TokenBucket>();
  private config: RateLimitConfig;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(config: RateLimitConfig) {
    this.config = config;
    // Periodically clean up expired entries (every 5 minutes)
    if (typeof setInterval !== "undefined") {
      this.cleanupInterval = setInterval(() => this.cleanup(), 5 * 60 * 1000);
      // Don't block Node.js exit
      if (this.cleanupInterval && "unref" in this.cleanupInterval) {
        this.cleanupInterval.unref();
      }
    }
  }

  /**
   * Extract client identifier from request.
   * Uses X-Forwarded-For header (from reverse proxy) or falls back to a default.
   */
  getKey(request: NextRequest): string {
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      return forwarded.split(",")[0].trim();
    }
    return request.headers.get("x-real-ip") || "127.0.0.1";
  }

  /**
   * Check if a request should be rate limited.
   * Returns a 429 NextResponse if limited, or null if allowed.
   */
  check(request: NextRequest): NextResponse | null {
    const key = this.getKey(request);
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let bucket = this.store.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.store.set(key, bucket);
    }

    // Remove timestamps outside the window
    bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

    if (bucket.timestamps.length >= this.config.limit) {
      const oldestInWindow = bucket.timestamps[0];
      const retryAfterMs = oldestInWindow + this.config.windowMs - now;
      const retryAfterSec = Math.ceil(retryAfterMs / 1000);

      return NextResponse.json(
        {
          error: "Too many requests",
          code: "RATE_LIMITED",
          retryAfter: retryAfterSec,
        },
        {
          status: 429,
          headers: {
            "Retry-After": String(retryAfterSec),
            "X-RateLimit-Limit": String(this.config.limit),
            "X-RateLimit-Remaining": "0",
            "X-RateLimit-Reset": String(Math.ceil((oldestInWindow + this.config.windowMs) / 1000)),
          },
        }
      );
    }

    // Record this request
    bucket.timestamps.push(now);
    return null;
  }

  /**
   * Get rate limit headers for a successful response.
   */
  getHeaders(request: NextRequest): Record<string, string> {
    const key = this.getKey(request);
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    const bucket = this.store.get(key);
    const count = bucket
      ? bucket.timestamps.filter((t) => t > windowStart).length
      : 0;

    return {
      "X-RateLimit-Limit": String(this.config.limit),
      "X-RateLimit-Remaining": String(Math.max(0, this.config.limit - count)),
      "X-RateLimit-Reset": String(Math.ceil((now + this.config.windowMs) / 1000)),
    };
  }

  /** Clean up expired entries to prevent memory leaks. */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    for (const [key, bucket] of this.store.entries()) {
      bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);
      if (bucket.timestamps.length === 0) {
        this.store.delete(key);
      }
    }
  }

  /** Reset all stored data (useful for testing). */
  reset(): void {
    this.store.clear();
  }

  /** Stop the cleanup interval. */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }
}

// ─── Pre-configured Instances ────────────────────────────────────────────────

const API_LIMIT = parseInt(process.env.RATE_LIMIT_API || "60", 10);
const AUTH_LIMIT = parseInt(process.env.RATE_LIMIT_AUTH || "5", 10);
const WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);

/** General API rate limiter: 60 requests per minute (default) */
export const rateLimit = new RateLimiter({ limit: API_LIMIT, windowMs: WINDOW_MS });

/** Auth rate limiter: 5 requests per minute (default) — stricter for login/signup */
export const authRateLimit = new RateLimiter({ limit: AUTH_LIMIT, windowMs: WINDOW_MS });

// ─── Backward-compatible helpers ─────────────────────────────────────────────

/** Returns true if the request should be blocked (rate limit exceeded). */
export function isRateLimited(key: string): boolean {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  let bucket = rateLimit["store"].get(key);
  if (!bucket) {
    bucket = { timestamps: [] };
    rateLimit["store"].set(key, bucket);
  }

  bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

  if (bucket.timestamps.length >= API_LIMIT) {
    return true;
  }

  bucket.timestamps.push(now);
  return false;
}

/** Build a rate-limit key from IP + route identifier. */
export function rateLimitKey(ip: string, route: string): string {
  return `${route}:${ip}`;
}
