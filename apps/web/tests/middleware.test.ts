import { describe, it, expect } from "vitest";

// Test the middleware routing logic (which paths are protected)
// The actual middleware uses Next.js runtime APIs, so we test the logic pattern

describe("Middleware Routing Logic", () => {
  // Mirrors the Next.js matcher pattern: "/app/:path*" and "/settings/:path*"
  // which matches /app, /app/*, /settings, /settings/* but NOT /application, /apps
  const protectedPatterns = [/^\/app(\/|$)/, /^\/settings(\/|$)/];

  function isProtectedRoute(pathname: string): boolean {
    return protectedPatterns.some((pattern) => pattern.test(pathname));
  }

  it("should protect /app routes", () => {
    expect(isProtectedRoute("/app")).toBe(true);
    expect(isProtectedRoute("/app/dashboard")).toBe(true);
    expect(isProtectedRoute("/app/settings")).toBe(true);
  });

  it("should protect /settings routes", () => {
    expect(isProtectedRoute("/settings")).toBe(true);
    expect(isProtectedRoute("/settings/mfa")).toBe(true);
  });

  it("should NOT protect public routes", () => {
    expect(isProtectedRoute("/")).toBe(false);
    expect(isProtectedRoute("/auth")).toBe(false);
    expect(isProtectedRoute("/auth?tab=login")).toBe(false);
    expect(isProtectedRoute("/forgot-password")).toBe(false);
    expect(isProtectedRoute("/reset-password")).toBe(false);
    expect(isProtectedRoute("/verify-email")).toBe(false);
    expect(isProtectedRoute("/privacy-policy")).toBe(false);
    expect(isProtectedRoute("/terms")).toBe(false);
    expect(isProtectedRoute("/api/health")).toBe(false);
  });

  it("should not protect similar-but-different paths", () => {
    expect(isProtectedRoute("/application")).toBe(false);
    expect(isProtectedRoute("/apps")).toBe(false);
    expect(isProtectedRoute("/app-store")).toBe(false);
    expect(isProtectedRoute("/settings-old")).toBe(false);
  });
});
