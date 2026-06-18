/**
 * Provider-agnostic marketing automation interface.
 *
 * Fires lifecycle events to the configured provider (Loops, Customer.io, etc.).
 * Activates only when a provider API key is set; otherwise all calls are no-ops.
 */

export interface MarketingContact {
  email: string;
  userId?: string;
  firstName?: string;
  lastName?: string;
  plan?: string;
  createdAt?: string;
  properties?: Record<string, string | number | boolean>;
}

export interface MarketingEvent {
  name: string;
  email: string;
  userId?: string;
  properties?: Record<string, string | number | boolean>;
}

export interface MarketingProvider {
  readonly name: string;
  upsertContact(contact: MarketingContact): Promise<void>;
  deleteContact(email: string): Promise<void>;
  sendEvent(event: MarketingEvent): Promise<void>;
}

// ── No-op provider (used when no provider is configured) ──

const noopProvider: MarketingProvider = {
  name: "noop",
  upsertContact: async () => {},
  deleteContact: async () => {},
  sendEvent: async () => {},
};

// ── Provider resolution ──

let _provider: MarketingProvider = noopProvider;
let _initialized = false;

export function getMarketingProvider(): MarketingProvider {
  if (_initialized) return _provider;
  _initialized = true;

  if (process.env.LOOPS_API_KEY) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LoopsProvider } = require("./marketing-loops");
    _provider = new LoopsProvider(process.env.LOOPS_API_KEY);
  }

  return _provider;
}

// ── Convenience functions (fire-and-forget, matching lib/email.ts pattern) ──

export function trackSignup(contact: MarketingContact): void {
  const provider = getMarketingProvider();
  void provider.upsertContact(contact).catch((err) =>
    console.error("[marketing] trackSignup upsert failed:", err)
  );
  void provider.sendEvent({
    name: "signup",
    email: contact.email,
    userId: contact.userId,
  }).catch((err) =>
    console.error("[marketing] trackSignup event failed:", err)
  );
}

export function trackSubscriptionChange(email: string, plan: string, status: string): void {
  void getMarketingProvider().sendEvent({
    name: "subscription_changed",
    email,
    properties: { plan, status },
  }).catch((err) =>
    console.error("[marketing] trackSubscriptionChange failed:", err)
  );
}

export function trackTrialExpiry(email: string): void {
  void getMarketingProvider().sendEvent({
    name: "trial_expiring",
    email,
  }).catch((err) =>
    console.error("[marketing] trackTrialExpiry failed:", err)
  );
}

export function removeContact(email: string): void {
  void getMarketingProvider().deleteContact(email).catch((err) =>
    console.error("[marketing] removeContact failed:", err)
  );
}
