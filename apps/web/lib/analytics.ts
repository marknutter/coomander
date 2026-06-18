/**
 * Pluggable analytics abstraction.
 *
 * Server-side event tracking with swappable backends.
 * Set ANALYTICS_PROVIDER in your environment:
 *   - "posthog"   — PostHog (requires POSTHOG_API_KEY + POSTHOG_HOST)
 *   - "plausible"  — Plausible (requires PLAUSIBLE_DOMAIN)
 *   - "console"    — Logs to stdout (default in development)
 *   - "none"       — Silent (default in production if no provider set)
 *
 * Usage:
 *   import { track, identify } from "@/lib/analytics";
 *   await track("item.created", { itemId: "123" });
 *   await identify(userId, { email, plan });
 */

import { log } from "@/lib/logger";

export interface AnalyticsEvent {
  event: string;
  properties?: Record<string, unknown>;
  userId?: string;
  timestamp?: Date;
}

interface AnalyticsProvider {
  track(event: AnalyticsEvent): Promise<void>;
  identify(userId: string, traits: Record<string, unknown>): Promise<void>;
  shutdown(): Promise<void>;
}

// ─── Provider Implementations ───────────────────────────────────────────────

function createConsoleProvider(): AnalyticsProvider {
  return {
    async track(event) {
      log.debug("[analytics] track", { event: event.event, ...event.properties });
    },
    async identify(userId, traits) {
      log.debug("[analytics] identify", { userId, ...traits });
    },
    async shutdown() {},
  };
}

function createNoopProvider(): AnalyticsProvider {
  return {
    async track() {},
    async identify() {},
    async shutdown() {},
  };
}

function createPostHogProvider(): AnalyticsProvider {
  const apiKey = process.env.POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://app.posthog.com";

  if (!apiKey) {
    log.warn("[analytics] POSTHOG_API_KEY not set, falling back to console");
    return createConsoleProvider();
  }

  return {
    async track(event) {
      try {
        await fetch(`${host}/capture/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            event: event.event,
            properties: {
              ...event.properties,
              distinct_id: event.userId || "anonymous",
            },
            timestamp: (event.timestamp || new Date()).toISOString(),
          }),
        });
      } catch (err) {
        log.warn("[analytics] PostHog track failed", { error: (err as Error).message });
      }
    },
    async identify(userId, traits) {
      try {
        await fetch(`${host}/capture/`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            event: "$identify",
            properties: { distinct_id: userId, $set: traits },
          }),
        });
      } catch (err) {
        log.warn("[analytics] PostHog identify failed", { error: (err as Error).message });
      }
    },
    async shutdown() {},
  };
}

function createPlausibleProvider(): AnalyticsProvider {
  const domain = process.env.PLAUSIBLE_DOMAIN;
  const host = process.env.PLAUSIBLE_HOST || "https://plausible.io";

  if (!domain) {
    log.warn("[analytics] PLAUSIBLE_DOMAIN not set, falling back to console");
    return createConsoleProvider();
  }

  return {
    async track(event) {
      try {
        await fetch(`${host}/api/event`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            domain,
            name: event.event,
            props: event.properties,
          }),
        });
      } catch (err) {
        log.warn("[analytics] Plausible track failed", { error: (err as Error).message });
      }
    },
    async identify() {
      // Plausible is privacy-focused — no user identification
    },
    async shutdown() {},
  };
}

// ─── Provider Factory ───────────────────────────────────────────────────────

let _provider: AnalyticsProvider | null = null;

function getProvider(): AnalyticsProvider {
  if (_provider) return _provider;

  const providerName = process.env.ANALYTICS_PROVIDER
    || (process.env.NODE_ENV === "development" ? "console" : "none");

  switch (providerName) {
    case "posthog":
      _provider = createPostHogProvider();
      break;
    case "plausible":
      _provider = createPlausibleProvider();
      break;
    case "console":
      _provider = createConsoleProvider();
      break;
    case "none":
    default:
      _provider = createNoopProvider();
      break;
  }

  return _provider;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Track an event.
 */
export async function track(
  event: string,
  properties?: Record<string, unknown>,
  userId?: string,
): Promise<void> {
  await getProvider().track({ event, properties, userId });
}

/**
 * Identify a user with traits (email, plan, etc.).
 */
export async function identify(
  userId: string,
  traits: Record<string, unknown>,
): Promise<void> {
  await getProvider().identify(userId, traits);
}

/**
 * Shutdown the analytics provider (flush pending events).
 * Call this on process exit if needed.
 */
export async function shutdown(): Promise<void> {
  await getProvider().shutdown();
}
