import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { RateLimiter } from "@/lib/rate-limit";
import { NextRequest } from "next/server";

function createRequest(ip = "192.168.1.1"): NextRequest {
  return new NextRequest("http://localhost:3000/api/test", {
    headers: {
      "x-forwarded-for": ip,
    },
  });
}

describe("RateLimiter", () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter({ limit: 3, windowMs: 1000 });
  });

  afterAll(() => {
    limiter.destroy();
  });

  it("should allow requests under the limit", () => {
    const req = createRequest();
    expect(limiter.check(req)).toBeNull();
    expect(limiter.check(req)).toBeNull();
    expect(limiter.check(req)).toBeNull();
  });

  it("should block requests over the limit", () => {
    const req = createRequest();
    limiter.check(req); // 1
    limiter.check(req); // 2
    limiter.check(req); // 3

    const result = limiter.check(req); // 4 — should be blocked
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("should return proper 429 response body", async () => {
    const req = createRequest();
    for (let i = 0; i < 3; i++) limiter.check(req);

    const result = limiter.check(req);
    expect(result).not.toBeNull();

    const body = await result!.json();
    expect(body.error).toBe("Too many requests");
    expect(body.code).toBe("RATE_LIMITED");
    expect(body.retryAfter).toBeGreaterThan(0);
  });

  it("should include rate limit headers on 429", async () => {
    const req = createRequest();
    for (let i = 0; i < 3; i++) limiter.check(req);

    const result = limiter.check(req);
    expect(result).not.toBeNull();
    expect(result!.headers.get("Retry-After")).toBeTruthy();
    expect(result!.headers.get("X-RateLimit-Limit")).toBe("3");
    expect(result!.headers.get("X-RateLimit-Remaining")).toBe("0");
    expect(result!.headers.get("X-RateLimit-Reset")).toBeTruthy();
  });

  it("should track different IPs separately", () => {
    const req1 = createRequest("10.0.0.1");
    const req2 = createRequest("10.0.0.2");

    // Fill up IP 1
    limiter.check(req1);
    limiter.check(req1);
    limiter.check(req1);
    expect(limiter.check(req1)).not.toBeNull(); // blocked

    // IP 2 should still be allowed
    expect(limiter.check(req2)).toBeNull();
  });

  it("should reset the window after time passes", async () => {
    const shortLimiter = new RateLimiter({ limit: 2, windowMs: 50 });
    const req = createRequest();

    shortLimiter.check(req);
    shortLimiter.check(req);
    expect(shortLimiter.check(req)).not.toBeNull(); // blocked

    // Wait for window to expire
    await new Promise((resolve) => setTimeout(resolve, 60));

    expect(shortLimiter.check(req)).toBeNull(); // allowed again
    shortLimiter.destroy();
  });

  it("should return correct headers via getHeaders()", () => {
    const req = createRequest();
    limiter.check(req); // 1 request

    const headers = limiter.getHeaders(req);
    expect(headers["X-RateLimit-Limit"]).toBe("3");
    expect(headers["X-RateLimit-Remaining"]).toBe("2");
    expect(headers["X-RateLimit-Reset"]).toBeTruthy();
  });

  it("should clean up expired entries", async () => {
    const shortLimiter = new RateLimiter({ limit: 5, windowMs: 50 });
    const req = createRequest();
    shortLimiter.check(req);

    await new Promise((resolve) => setTimeout(resolve, 60));
    shortLimiter.cleanup();

    // After cleanup, the store should be empty (entry expired)
    const headers = shortLimiter.getHeaders(req);
    expect(headers["X-RateLimit-Remaining"]).toBe("5"); // full limit available
    shortLimiter.destroy();
  });

  it("should extract IP from x-forwarded-for", () => {
    const req = new NextRequest("http://localhost:3000/api/test", {
      headers: { "x-forwarded-for": "203.0.113.50, 70.41.3.18, 150.172.238.178" },
    });
    const key = limiter.getKey(req);
    expect(key).toBe("203.0.113.50");
  });

  it("should fall back to x-real-ip", () => {
    const req = new NextRequest("http://localhost:3000/api/test", {
      headers: { "x-real-ip": "10.10.10.10" },
    });
    const key = limiter.getKey(req);
    expect(key).toBe("10.10.10.10");
  });

  it("should fall back to 127.0.0.1 when no IP headers present", () => {
    const req = new NextRequest("http://localhost:3000/api/test");
    const key = limiter.getKey(req);
    expect(key).toBe("127.0.0.1");
  });

  it("reset() should clear all data", () => {
    const req = createRequest();
    limiter.check(req);
    limiter.check(req);
    limiter.check(req);
    expect(limiter.check(req)).not.toBeNull(); // blocked

    limiter.reset();
    expect(limiter.check(req)).toBeNull(); // allowed again
  });
});
