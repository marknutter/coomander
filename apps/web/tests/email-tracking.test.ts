import { describe, it, expect } from "vitest";

// ─── Email open/click tracking ──────────────────────────────────────────────
//
// lib/email-tracking.ts provides the signing/verification + HTML-rewriting
// primitives behind the email open-pixel and click-redirect feature. Tokens are
// signed with EMAIL_TRACKING_SECRET || BETTER_AUTH_SECRET || a dev default. The
// vitest config sets BETTER_AUTH_SECRET globally, so sign + verify in this file
// use the same secret (do not mutate these env vars mid-test).
//
// We test observable behavior only — never the internal token encoding beyond
// the documented `<payload>.<sig>` shape.

import {
  signTrackingToken,
  verifyTrackingToken,
  rewriteLinks,
  injectOpenPixel,
  applyCampaignTracking,
  TRANSPARENT_GIF,
} from "@/lib/email-tracking";

const BASE = "https://app.test";
const CTX = { campaignId: "camp-123", email: "user@test.com" };

// ─── signTrackingToken / verifyTrackingToken ────────────────────────────────

describe("signTrackingToken", () => {
  it("returns a two-part `<payload>.<sig>` token", () => {
    const token = signTrackingToken(CTX);
    expect(typeof token).toBe("string");
    const parts = token.split(".");
    expect(parts).toHaveLength(2);
    expect(parts[0].length).toBeGreaterThan(0);
    expect(parts[1].length).toBeGreaterThan(0);
  });
});

describe("verifyTrackingToken", () => {
  it("round-trips: verify(sign(ctx)) deep-equals ctx (no url)", () => {
    const token = signTrackingToken(CTX);
    expect(verifyTrackingToken(token)).toEqual(CTX);
  });

  it("does not include a url property when signed without one", () => {
    const result = verifyTrackingToken(signTrackingToken(CTX));
    expect(result).not.toBeNull();
    expect(result).not.toHaveProperty("url");
  });

  it("round-trips for a different context (no url)", () => {
    const ctx = { campaignId: "abc", email: "someone+tag@example.org" };
    expect(verifyTrackingToken(signTrackingToken(ctx))).toEqual(ctx);
  });

  it("round-trips the url when signed with one", () => {
    const ctx = { ...CTX, url: "https://example.com/landing?ref=42" };
    const result = verifyTrackingToken(signTrackingToken(ctx));
    expect(result).toEqual(ctx);
    expect(result).toHaveProperty("url", ctx.url);
  });

  it("round-trips the url for a different context", () => {
    const ctx = {
      campaignId: "abc",
      email: "someone+tag@example.org",
      url: "http://two.example.com/path?x=1&y=2",
    };
    expect(verifyTrackingToken(signTrackingToken(ctx))).toEqual(ctx);
  });

  it("returns null for null input", () => {
    expect(verifyTrackingToken(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(verifyTrackingToken(undefined)).toBeNull();
  });

  it("returns null for empty-string input", () => {
    expect(verifyTrackingToken("")).toBeNull();
  });

  it("returns null for a malformed token with no dot", () => {
    expect(verifyTrackingToken("nodot")).toBeNull();
  });

  it("returns null when the signature is tampered", () => {
    const token = signTrackingToken(CTX);
    const [payload, sig] = token.split(".");
    // Flip the last char of the signature to a different valid base64url char.
    const lastChar = sig.slice(-1);
    const replacement = lastChar === "A" ? "B" : "A";
    const tampered = `${payload}.${sig.slice(0, -1)}${replacement}`;
    expect(verifyTrackingToken(tampered)).toBeNull();
  });

  it("returns null when the payload is tampered", () => {
    const token = signTrackingToken(CTX);
    const [payload, sig] = token.split(".");
    const lastChar = payload.slice(-1);
    const replacement = lastChar === "A" ? "B" : "A";
    const tampered = `${payload.slice(0, -1)}${replacement}.${sig}`;
    expect(verifyTrackingToken(tampered)).toBeNull();
  });
});

// ─── rewriteLinks ───────────────────────────────────────────────────────────

describe("rewriteLinks", () => {
  /** Extract the `t` (token) query param from a rewritten click href. */
  function tokenFromHref(href: string): string | null {
    const match = href.match(/[?&]t=([^"&]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  /**
   * Recover the original destination from a rewritten click href: the url is
   * signed INTO the token (no separate `u` query param anymore), so extract the
   * token and verify it to read back `.url`.
   */
  function originalUrlFromHref(href: string): string | null {
    const token = tokenFromHref(href);
    if (!token) return null;
    const verified = verifyTrackingToken(token);
    return verified?.url ?? null;
  }

  it("rewrites an http link through /api/email/click with the destination signed into the token", () => {
    const original = "http://example.com/page";
    const html = `<a href="${original}">Visit</a>`;
    const out = rewriteLinks(html, CTX, BASE);

    expect(out).toContain(`${BASE}/api/email/click`);
    // Original url must NOT appear as the raw href target anymore.
    expect(out).not.toContain(`href="${original}"`);
    // The destination is NOT leaked as a `u` query param (open-redirect fix).
    expect(out).not.toContain("u=");

    const hrefMatch = out.match(/href="([^"]+)"/);
    expect(hrefMatch).not.toBeNull();
    const href = hrefMatch![1];
    expect(href.startsWith(`${BASE}/api/email/click?t=`)).toBe(true);

    // Token in the rewritten link verifies back to the original context + url.
    const token = tokenFromHref(href);
    expect(token).not.toBeNull();
    expect(verifyTrackingToken(token)).toEqual({ ...CTX, url: original });
  });

  it("rewrites an https link through /api/email/click", () => {
    const original = "https://secure.example.com/landing?ref=42";
    const html = `<a href="${original}">Go</a>`;
    const out = rewriteLinks(html, CTX, BASE);

    expect(out).toContain(`${BASE}/api/email/click`);
    expect(out).not.toContain("u=");
    const href = out.match(/href="([^"]+)"/)![1];
    expect(href.startsWith(`${BASE}/api/email/click?t=`)).toBe(true);
    expect(originalUrlFromHref(href)).toBe(original);
    expect(verifyTrackingToken(tokenFromHref(href))).toEqual({
      ...CTX,
      url: original,
    });
  });

  it("leaves mailto: links unchanged", () => {
    const html = `<a href="mailto:hi@test.com">Email us</a>`;
    expect(rewriteLinks(html, CTX, BASE)).toBe(html);
  });

  it("leaves tel: links unchanged", () => {
    const html = `<a href="tel:+15551234567">Call</a>`;
    expect(rewriteLinks(html, CTX, BASE)).toBe(html);
  });

  it("leaves #anchor links unchanged", () => {
    const html = `<a href="#section">Jump</a>`;
    expect(rewriteLinks(html, CTX, BASE)).toBe(html);
  });

  it("leaves links already pointing at /api/email/click unchanged", () => {
    const already = `${BASE}/api/email/click?t=existing&u=whatever`;
    const html = `<a href="${already}">Tracked</a>`;
    const out = rewriteLinks(html, CTX, BASE);
    // Must not double-wrap an already-tracked link.
    expect(out).toBe(html);
  });

  it("leaves /api/unsubscribe links unchanged", () => {
    const html = `<a href="${BASE}/api/unsubscribe?e=user@test.com">Unsubscribe</a>`;
    expect(rewriteLinks(html, CTX, BASE)).toBe(html);
  });

  it("preserves sibling attributes on the <a> tag", () => {
    const original = "https://example.com/x";
    const html = `<a class="btn" style="color:red" href="${original}" target="_blank">Click</a>`;
    const out = rewriteLinks(html, CTX, BASE);

    expect(out).toContain('class="btn"');
    expect(out).toContain('style="color:red"');
    expect(out).toContain('target="_blank"');
    expect(out).toContain(`${BASE}/api/email/click`);
    const href = out.match(/href="([^"]+)"/)![1];
    expect(originalUrlFromHref(href)).toBe(original);
  });

  it("rewrites multiple links in one document", () => {
    const a = "https://one.example.com/";
    const b = "http://two.example.com/path";
    const html = `<p><a href="${a}">One</a> and <a href="${b}">Two</a></p>`;
    const out = rewriteLinks(html, CTX, BASE);

    const clickCount = (out.match(/\/api\/email\/click/g) || []).length;
    expect(clickCount).toBe(2);

    const hrefs = [...out.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs).toHaveLength(2);
    expect(originalUrlFromHref(hrefs[0])).toBe(a);
    expect(originalUrlFromHref(hrefs[1])).toBe(b);
  });

  it("leaves a document with no links unchanged", () => {
    const html = `<p>No links here.</p>`;
    expect(rewriteLinks(html, CTX, BASE)).toBe(html);
  });
});

// ─── injectOpenPixel ────────────────────────────────────────────────────────

describe("injectOpenPixel", () => {
  /** Pull the open-pixel <img> tag out of the rendered html. */
  function pixelTag(html: string): string | null {
    const match = html.match(/<img[^>]*\/api\/email\/open[^>]*>/);
    return match ? match[0] : null;
  }

  it("inserts the pixel immediately before </body> when present", () => {
    const html = `<html><body><p>Hi</p></body></html>`;
    const out = injectOpenPixel(html, CTX, BASE);

    expect(out).toContain(`${BASE}/api/email/open?t=`);
    // The pixel must appear before the closing body tag.
    const pixelIdx = out.indexOf("/api/email/open");
    const bodyCloseIdx = out.indexOf("</body>");
    expect(pixelIdx).toBeGreaterThan(-1);
    expect(bodyCloseIdx).toBeGreaterThan(-1);
    expect(pixelIdx).toBeLessThan(bodyCloseIdx);
  });

  it("appends the pixel to the end when there is no </body>", () => {
    const html = `<p>No body tag</p>`;
    const out = injectOpenPixel(html, CTX, BASE);

    expect(out).toContain(`${BASE}/api/email/open?t=`);
    expect(out.startsWith(html)).toBe(true);
    // The pixel comes after the original content.
    expect(out.indexOf("/api/email/open")).toBeGreaterThan(
      out.indexOf("No body tag")
    );
  });

  it("uses a token that verifies back to the context", () => {
    const html = `<body></body>`;
    const out = injectOpenPixel(html, CTX, BASE);
    const tokenMatch = out.match(/\/api\/email\/open\?t=([^"&]+)/);
    expect(tokenMatch).not.toBeNull();
    expect(verifyTrackingToken(decodeURIComponent(tokenMatch![1]))).toEqual(CTX);
  });

  it("renders a 1x1 hidden img", () => {
    const html = `<body></body>`;
    const out = injectOpenPixel(html, CTX, BASE);
    const img = pixelTag(out);
    expect(img).not.toBeNull();
    expect(img).toMatch(/width\s*=\s*["']?1["']?/);
    expect(img).toMatch(/height\s*=\s*["']?1["']?/);
    // Hidden via display:none and/or visibility:hidden styling.
    expect(img!.toLowerCase()).toMatch(/display\s*:\s*none|visibility\s*:\s*hidden/);
  });
});

// ─── applyCampaignTracking ──────────────────────────────────────────────────

describe("applyCampaignTracking", () => {
  it("yields both a rewritten click link and an open pixel", () => {
    const html = `<html><body><a href="https://example.com/x">Click</a></body></html>`;
    const out = applyCampaignTracking(html, CTX, BASE);

    expect(out).toContain(`${BASE}/api/email/click`);
    expect(out).toContain(`${BASE}/api/email/open?t=`);

    // The original raw link target should be gone (routed through click).
    expect(out).not.toContain(`href="https://example.com/x"`);
  });

  it("places the open pixel before </body> alongside rewritten links", () => {
    const html = `<html><body><a href="http://example.com/">Go</a></body></html>`;
    const out = applyCampaignTracking(html, CTX, BASE);

    const pixelIdx = out.indexOf("/api/email/open");
    const bodyCloseIdx = out.indexOf("</body>");
    expect(pixelIdx).toBeLessThan(bodyCloseIdx);
  });
});

// ─── TRANSPARENT_GIF ────────────────────────────────────────────────────────

describe("TRANSPARENT_GIF", () => {
  it("is a non-empty Buffer", () => {
    expect(Buffer.isBuffer(TRANSPARENT_GIF)).toBe(true);
    expect(TRANSPARENT_GIF.length).toBeGreaterThan(0);
  });

  it("starts with a GIF magic header", () => {
    // GIF87a / GIF89a — sanity check it's actually a GIF, not arbitrary bytes.
    const header = TRANSPARENT_GIF.subarray(0, 3).toString("ascii");
    expect(header).toBe("GIF");
  });
});
