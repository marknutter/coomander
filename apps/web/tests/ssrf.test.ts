import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertSafeWebhookUrl } from "@/lib/ssrf";

// ---------------------------------------------------------------------------
// ssrf — SSRF guard for outbound webhook delivery.
//
// `assertSafeWebhookUrl(url)` THROWS on unsafe URLs and RESOLVES (void) on safe
// ones. Tests are network-free and deterministic: only IP literals are used for
// the "allowed" cases so no live DNS resolution is required.
//
// Every test saves + restores WEBHOOK_ALLOW_PRIVATE_TARGETS so env state never
// leaks between tests (or to other test files). The opt-in is read at call time.
// ---------------------------------------------------------------------------

describe("assertSafeWebhookUrl", () => {
  let savedAllowPrivate: string | undefined;

  beforeEach(() => {
    savedAllowPrivate = process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
    // Ensure the opt-in is OFF for the default blocking/allowing tests, so a
    // value leaking in from the host env can't make blocked cases pass.
    delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
  });

  afterEach(() => {
    if (savedAllowPrivate === undefined) {
      delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
    } else {
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = savedAllowPrivate;
    }
  });

  // ── Scheme enforcement ────────────────────────────────────────────────────

  describe("non-http(s) schemes are blocked", () => {
    const badSchemes = [
      "ftp://example.com/resource",
      "file:///etc/passwd",
      "gopher://example.com",
      "data:text/plain,hello",
      "javascript:alert(1)",
    ];

    for (const url of badSchemes) {
      it(`throws for ${url}`, async () => {
        await expect(assertSafeWebhookUrl(url)).rejects.toThrow();
      });
    }
  });

  it("throws for a malformed / unparseable URL", async () => {
    await expect(assertSafeWebhookUrl("not a url")).rejects.toThrow();
  });

  // ── localhost-style hostnames ─────────────────────────────────────────────

  describe("localhost hostnames are blocked", () => {
    const localhostUrls = [
      "http://localhost",
      "https://localhost",
      "http://localhost:3000/webhook",
      "http://something.localhost",
      "https://api.internal.localhost/path",
    ];

    for (const url of localhostUrls) {
      it(`throws for ${url}`, async () => {
        await expect(assertSafeWebhookUrl(url)).rejects.toThrow();
      });
    }
  });

  // ── Private / loopback / link-local / CGNAT IPv4 literals ──────────────────

  describe("private/loopback/link-local/CGNAT IPv4 literals are blocked", () => {
    const blockedIPv4 = [
      "127.0.0.1", // loopback
      "10.0.0.1", // 10/8 private
      "172.16.0.1", // 172.16/12 private
      "192.168.1.1", // 192.168/16 private
      "169.254.169.254", // link-local / cloud metadata
      "0.0.0.0", // 0/8 unspecified
      "100.64.0.1", // 100.64/10 CGNAT
    ];

    for (const ip of blockedIPv4) {
      it(`throws for https://${ip}`, async () => {
        await expect(assertSafeWebhookUrl(`https://${ip}`)).rejects.toThrow();
      });
    }
  });

  // ── Private / loopback / link-local IPv6 literals ─────────────────────────

  describe("private/loopback/link-local IPv6 literals are blocked", () => {
    const blockedIPv6 = [
      "[::1]", // loopback
      "[fc00::1]", // fc00::/7 unique-local
      "[fe80::1]", // fe80::/10 link-local
      "[::ffff:127.0.0.1]", // IPv4-mapped loopback
    ];

    for (const ip of blockedIPv6) {
      it(`throws for https://${ip}`, async () => {
        await expect(assertSafeWebhookUrl(`https://${ip}`)).rejects.toThrow();
      });
    }
  });

  // ── Public IP literals (no DNS needed) resolve safely ─────────────────────

  describe("public IP-literal URLs resolve without throwing", () => {
    const allowedPublic = [
      "https://1.1.1.1", // Cloudflare DNS
      "https://8.8.8.8", // Google DNS
      "https://93.184.216.34", // example.com's documented address
    ];

    for (const url of allowedPublic) {
      it(`resolves for ${url}`, async () => {
        await expect(assertSafeWebhookUrl(url)).resolves.toBeUndefined();
      });
    }
  });

  // ── Opt-in bypass ─────────────────────────────────────────────────────────

  describe("WEBHOOK_ALLOW_PRIVATE_TARGETS opt-in", () => {
    it("resolves for a normally-blocked private URL when set to 'true'", async () => {
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = "true";
      await expect(
        assertSafeWebhookUrl("http://127.0.0.1"),
      ).resolves.toBeUndefined();
    });

    it("still throws for a private URL when the opt-in is unset", async () => {
      delete process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS;
      await expect(assertSafeWebhookUrl("http://127.0.0.1")).rejects.toThrow();
    });

    it("does NOT bypass for non-'true' values (e.g. '1')", async () => {
      process.env.WEBHOOK_ALLOW_PRIVATE_TARGETS = "1";
      await expect(assertSafeWebhookUrl("http://127.0.0.1")).rejects.toThrow();
    });
  });
});
