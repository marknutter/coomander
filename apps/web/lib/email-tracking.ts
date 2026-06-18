import crypto from "crypto";

// ── Self-hosted email open/click tracking ─────────────────────────────────────
//
// Cloudflare Email Service tracks delivery only (no opens/clicks), so we track
// engagement ourselves: campaign HTML is rewritten so links route through
// /api/email/click and a 1×1 pixel hits /api/email/open. Each carries an
// HMAC-signed token identifying the campaign + subscriber, so the endpoints can
// attribute the event without a DB lookup and without trusting the URL.
//
// Tokens are signed, not encrypted — they only contain a campaign id + the
// recipient email, which the recipient already knows. The signature prevents a
// third party from forging events for other subscribers.

export interface TrackingContext {
  campaignId: string;
  email: string;
  /**
   * Click destination. Present on click tokens so the redirect target is part
   * of the signature and cannot be swapped — this prevents the click endpoint
   * from being used as an open redirect. Absent on open-pixel tokens.
   */
  url?: string;
}

function trackingSecret(): string {
  return (
    process.env.EMAIL_TRACKING_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    "dev-insecure-email-tracking-secret"
  );
}

/** Sign `{campaignId, email, url?}` into a `<payload>.<sig>` token (base64url). */
export function signTrackingToken(ctx: TrackingContext): string {
  const payload = Buffer.from(
    JSON.stringify({
      c: ctx.campaignId,
      e: ctx.email,
      ...(ctx.url ? { u: ctx.url } : {}),
    })
  ).toString("base64url");
  const sig = crypto
    .createHmac("sha256", trackingSecret())
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

/** Verify a tracking token, returning its context or null if invalid/tampered. */
export function verifyTrackingToken(token: string | null | undefined): TrackingContext | null {
  if (!token) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;

  const expected = crypto
    .createHmac("sha256", trackingSecret())
    .update(payload)
    .digest("base64url");

  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (typeof obj?.c !== "string" || typeof obj?.e !== "string") return null;
    const ctx: TrackingContext = { campaignId: obj.c, email: obj.e };
    if (typeof obj.u === "string") ctx.url = obj.u;
    return ctx;
  } catch {
    return null;
  }
}

function trackingBaseUrl(): string {
  return process.env.APP_URL || "https://YOUR_DOMAIN";
}

/**
 * Rewrite every `<a href="http(s)://…">` in the HTML to route through the click
 * endpoint. The destination is signed INTO the per-link token (not passed as a
 * separate query param), so the click endpoint cannot be coerced into an open
 * redirect. Skips non-http links (mailto:/tel:/anchors), our own unsubscribe
 * links, and links already pointing at the tracker (idempotent).
 */
export function rewriteLinks(
  html: string,
  ctx: TrackingContext,
  baseUrl: string = trackingBaseUrl()
): string {
  return html.replace(
    /(<a\b[^>]*?\shref=)(["'])(.*?)\2/gi,
    (match, prefix, quote, url) => {
      if (!/^https?:\/\//i.test(url)) return match;
      if (/\/api\/unsubscribe/i.test(url)) return match;
      if (/\/api\/email\/click/i.test(url)) return match;
      const token = signTrackingToken({
        campaignId: ctx.campaignId,
        email: ctx.email,
        url,
      });
      const tracked = `${baseUrl}/api/email/click?t=${encodeURIComponent(token)}`;
      return `${prefix}${quote}${tracked}${quote}`;
    }
  );
}

/** Inject a 1×1 open-tracking pixel just before `</body>` (or appended). */
export function injectOpenPixel(
  html: string,
  ctx: TrackingContext,
  baseUrl: string = trackingBaseUrl()
): string {
  const token = signTrackingToken(ctx);
  const pixel =
    `<img src="${baseUrl}/api/email/open?t=${encodeURIComponent(token)}" ` +
    `alt="" width="1" height="1" style="display:none" />`;
  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${pixel}</body>`)
    : html + pixel;
}

/** Apply both click rewriting and open-pixel injection to campaign HTML. */
export function applyCampaignTracking(
  html: string,
  ctx: TrackingContext,
  baseUrl: string = trackingBaseUrl()
): string {
  return injectOpenPixel(rewriteLinks(html, ctx, baseUrl), ctx, baseUrl);
}

/** 1×1 transparent GIF returned by the open endpoint. */
export const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==",
  "base64"
);
