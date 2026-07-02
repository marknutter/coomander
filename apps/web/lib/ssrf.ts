/**
 * SSRF protection for outbound, user-supplied URLs (e.g. webhook targets).
 *
 * `assertSafeWebhookUrl()` is the single source of truth for "is this URL safe
 * to fetch?". It is called at create/update time (to reject bad URLs with a 400)
 * AND immediately before the delivery `fetch` (so a URL that became unsafe after
 * creation — e.g. via DNS rebinding — still can't be reached).
 *
 * Blocked, by default:
 *   - non-http(s) schemes
 *   - IP literals in private/loopback/link-local/unique-local/CGNAT ranges
 *   - `localhost` / `*.localhost` / `0.0.0.0` / `[::1]` / IPv4-mapped IPv6
 *   - DNS names that RESOLVE to any of the above (defeats DNS rebinding)
 *
 * Local-dev opt-in: set `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` to skip the
 * private/loopback rejection so developers can test against `localhost`. The
 * check is otherwise UNCONDITIONAL — it does NOT key off `NODE_ENV`.
 */

import { isIP } from "node:net";

const ALLOW_PRIVATE_ENV = "WEBHOOK_ALLOW_PRIVATE_TARGETS";

/** True when the explicit local-dev opt-in is enabled. */
function privateTargetsAllowed(): boolean {
  return process.env[ALLOW_PRIVATE_ENV] === "true";
}

// ─── IP range checks ──────────────────────────────────────────────────────────

/**
 * Returns true if the given IPv4 string is in a private/loopback/link-local/
 * reserved/CGNAT range that should never be reachable from an outbound webhook.
 *   0.0.0.0/8, 10/8, 100.64/10 (CGNAT), 127/8, 169.254/16 (link-local),
 *   172.16/12, 192.168/16
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Not a well-formed IPv4 — treat as unsafe rather than silently allowing.
    return true;
  }
  const [a, b] = parts;

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10/8
  if (a === 127) return true; // 127/8 loopback
  if (a === 169 && b === 254) return true; // 169.254/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 192 && b === 168) return true; // 192.168/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT

  return false;
}

/**
 * Returns true if the given IPv6 string is loopback, unique-local, link-local,
 * unspecified, or an IPv4-mapped address pointing at a private IPv4.
 *   ::1 (loopback), :: (unspecified), fc00::/7 (ULA), fe80::/10 (link-local),
 *   ::ffff:0:0/96 (IPv4-mapped — defer to the IPv4 check on the embedded v4)
 */
function isPrivateIPv6(ip: string): boolean {
  const addr = ip.toLowerCase().replace(/^\[|\]$/g, "");

  if (addr === "::1") return true; // loopback
  if (addr === "::") return true; // unspecified

  // IPv4-mapped IPv6 (::ffff:a.b.c.d or ::ffff:aabb:ccdd) → apply the IPv4 rules.
  const mapped = addr.match(/^::ffff:(.+)$/);
  if (mapped) {
    const tail = mapped[1];
    if (tail.includes(".")) {
      return isPrivateIPv4(tail);
    }
    // Hex form ::ffff:aabb:ccdd → reconstruct the dotted IPv4.
    const hexMatch = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hexMatch) {
      const hi = parseInt(hexMatch[1], 16);
      const lo = parseInt(hexMatch[2], 16);
      const v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      return isPrivateIPv4(v4);
    }
    // Any other ::ffff: form is unexpected — block it.
    return true;
  }

  // Expand to the first hextet group to test fc00::/7 and fe80::/10.
  const firstGroup = addr.split(":")[0] || "0";
  const first16 = parseInt(firstGroup, 16);
  if (Number.isNaN(first16)) return true; // malformed — block

  if ((first16 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first16 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local

  return false;
}

/** True if an IP literal (v4 or v6) is in any blocked range. */
function isPrivateIP(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPrivateIPv4(ip);
  if (family === 6) return isPrivateIPv6(ip);
  // Could be an IPv4-mapped form that `isIP` rejected; check defensively.
  if (ip.toLowerCase().startsWith("::ffff:")) return isPrivateIPv6(ip);
  return true; // not a recognizable IP literal → block
}

/** Hostnames that are unsafe by name regardless of resolution. */
function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost") return true;
  if (host.endsWith(".localhost")) return true;
  return false;
}

// ─── DNS resolution (Node/dev/self-host path) ─────────────────────────────────

/**
 * Resolve a DNS name to all of its addresses and reject if ANY of them is in a
 * blocked range. Defeats DNS rebinding / hostname-based SSRF.
 *
 * Cross-runtime caveat: production runs on Cloudflare Workers (OpenNext) where
 * `node:dns` may be unavailable. We import it dynamically inside a try/catch; if
 * resolution is unavailable we do NOT throw on that basis — the Workers platform
 * itself blocks egress to internal ranges, and the literal-IP/hostname checks
 * above still apply. The Node/Docker dev/self-host path is where rebinding is
 * live, so resolution-based blocking must work there.
 */
async function assertResolvedAddressesSafe(hostname: string): Promise<void> {
  let lookup: typeof import("node:dns/promises").lookup;
  try {
    ({ lookup } = await import("node:dns/promises"));
  } catch {
    // dns unavailable (e.g. Workers runtime) — rely on platform egress controls.
    return;
  }

  let results: Array<{ address: string }>;
  try {
    results = await lookup(hostname, { all: true });
  } catch {
    // Lookup failed (NXDOMAIN, no network, or unsupported in this runtime).
    // Don't block on resolution failure — the fetch itself will fail safely,
    // and on Workers the platform blocks internal ranges anyway.
    return;
  }

  for (const { address } of results) {
    if (isPrivateIP(address)) {
      throw new Error(
        `Webhook URL host "${hostname}" resolves to a private/internal address`,
      );
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Assert that a user-supplied URL is safe to fetch. Throws a plain `Error` on
 * any unsafe condition; callers in API routes should catch and translate to a
 * `BadRequestError`, and `deliverWebhook` should catch and record a failed
 * delivery.
 *
 * Set `WEBHOOK_ALLOW_PRIVATE_TARGETS=true` to opt into private/loopback targets
 * for local development. The check is otherwise unconditional (NOT gated on
 * `NODE_ENV`).
 */
export async function assertSafeWebhookUrl(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Invalid webhook URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Webhook URL must use http or https");
  }

  // Explicit local-dev opt-in: skip all private-target rejection.
  if (privateTargetsAllowed()) {
    return;
  }

  // Node's URL.hostname RETAINS the surrounding brackets for IPv6 literals
  // (e.g. "[::1]"), and isIP() returns 0 for a bracketed string — so strip the
  // brackets here, otherwise IPv6 targets fall through to the DNS path (which
  // can't resolve a bracketed host) and get silently allowed.
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");

  if (isBlockedHostname(hostname)) {
    throw new Error("Webhook URL cannot target internal addresses");
  }

  // If the hostname is an IP literal, check it directly.
  const family = isIP(hostname);
  if (family !== 0 || hostname.toLowerCase().startsWith("::ffff:")) {
    if (isPrivateIP(hostname)) {
      throw new Error("Webhook URL cannot target internal addresses");
    }
    return;
  }

  // Otherwise it's a DNS name — resolve and check every resolved address.
  await assertResolvedAddressesSafe(hostname);
}
