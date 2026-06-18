// ── Feature Flags (Cloudflare Flagship) ───────────────────────────────────────
//
// Three-tier fallback (same pattern as lib/email.ts):
//   1. Workers binding (env.FLAGS) — production on Cloudflare Workers.
//      Zero config; the [[flagship]] binding in wrangler.toml handles auth.
//   2. OpenFeature SDK fallback — for non-Workers environments (Docker, VPS)
//      where FLAGSHIP_APP_ID + CLOUDFLARE_ACCOUNT_ID + CF_API_TOKEN are set.
//   3. Local config fallback — reads from FLAG_* env vars or flags.json.
//      All flags default to their provided default value when no config exists.
//
// Flagship is currently in private beta. Tier 3 works without any CF access,
// so downstream projects can use feature flags immediately in local dev.

export interface FlagContext {
  userId?: string;
  plan?: string;
  email?: string;
  [key: string]: string | undefined;
}

// ── Tier 1: Workers Binding ──────────────────────────────────────────────────

interface FlagshipBinding {
  getBooleanValue(key: string, defaultValue: boolean, context?: Record<string, string>): Promise<boolean>;
  getStringValue(key: string, defaultValue: string, context?: Record<string, string>): Promise<string>;
  getNumberValue(key: string, defaultValue: number, context?: Record<string, string>): Promise<number>;
  getObjectValue<T = Record<string, unknown>>(key: string, defaultValue: T, context?: Record<string, string>): Promise<T>;
}

/**
 * Resolve the Cloudflare Flagship binding from the Workers runtime context.
 * Returns null if not running on Workers or if the [[flagship]] binding
 * is not declared in wrangler.toml.
 */
function resolveFlagshipBinding(): FlagshipBinding | null {
  try {
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    return (ctx?.env?.FLAGS as FlagshipBinding | undefined) ?? null;
  } catch {
    return null;
  }
}

// ── Tier 2: OpenFeature SDK ──────────────────────────────────────────────────

// Lazy-initialized OpenFeature client. The @cloudflare/flagship and
// @openfeature/server-sdk packages are optional — only install them if
// you need feature flags outside of Workers.
let openFeatureInitialized = false;

async function getOpenFeatureClient(): Promise<{
  getBooleanValue(key: string, defaultValue: boolean, context?: Record<string, string>): Promise<boolean>;
  getStringValue(key: string, defaultValue: string, context?: Record<string, string>): Promise<string>;
  getNumberValue(key: string, defaultValue: number, context?: Record<string, string>): Promise<number>;
} | null> {
  const appId = process.env.FLAGSHIP_APP_ID;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CF_API_TOKEN;

  if (!appId || !accountId || !apiToken) return null;

  try {
    // Dynamic imports — these packages are optional
    const { OpenFeature } = require("@openfeature/server-sdk");
    const { FlagshipServerProvider } = require("@cloudflare/flagship");

    if (!openFeatureInitialized) {
      await OpenFeature.setProviderAndWait(
        new FlagshipServerProvider({ appId, accountId, authToken: apiToken })
      );
      openFeatureInitialized = true;
    }

    return OpenFeature.getClient();
  } catch {
    // Packages not installed — fall through to tier 3
    return null;
  }
}

// ── Tier 3: Local Config Fallback ────────────────────────────────────────────

// In-memory cache of local flag overrides.
// Sources (checked in order):
//   1. Environment variables: FLAG_<UPPERCASE_KEY>=true|false|"value"|123
//   2. flags.json in project root (optional)
let localFlags: Record<string, unknown> | null = null;

function loadLocalFlags(): Record<string, unknown> {
  if (localFlags !== null) return localFlags;

  const result: Record<string, unknown> = {};

  // 1. Load from flags.json if it exists
  try {
    const fs = require("fs");
    const path = require("path");
    const flagsPath = path.join(process.cwd(), "flags.json");
    if (fs.existsSync(flagsPath)) {
      const data = JSON.parse(fs.readFileSync(flagsPath, "utf-8"));
      Object.assign(result, data);
    }
  } catch {
    // flags.json not found or not parseable — fine
  }

  // 2. Override with FLAG_* environment variables
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("FLAG_") && value !== undefined) {
      // Convert FLAG_MY_FEATURE to my-feature
      const flagKey = key.slice(5).toLowerCase().replace(/_/g, "-");

      // Parse value: booleans, numbers, or strings
      if (value === "true") result[flagKey] = true;
      else if (value === "false") result[flagKey] = false;
      else if (!isNaN(Number(value)) && value.trim() !== "") result[flagKey] = Number(value);
      else result[flagKey] = value;
    }
  }

  localFlags = result;
  return localFlags;
}

function getLocalFlag<T>(key: string, defaultValue: T): T {
  const flags = loadLocalFlags();
  if (key in flags) return flags[key] as T;
  return defaultValue;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize FlagContext to a flat string record for Flagship's evaluation
 * context (which expects Record<string, string>).
 */
function toEvalContext(context?: FlagContext): Record<string, string> | undefined {
  if (!context) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(context)) {
    if (value !== undefined) result[key] = value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Evaluate a boolean feature flag.
 *
 * @param key - The flag key (e.g. "new-dashboard", "maintenance-mode")
 * @param defaultValue - Value returned when the flag doesn't exist or evaluation fails
 * @param context - Optional evaluation context (userId, plan, etc.) for targeting rules
 *
 * @example
 * ```ts
 * const showNewDashboard = await getFlag("new-dashboard", false, {
 *   userId: session.user.id,
 *   plan: session.user.plan,
 * });
 * ```
 */
export async function getFlag(
  key: string,
  defaultValue: boolean,
  context?: FlagContext,
): Promise<boolean> {
  // Tier 1: Workers binding
  const binding = resolveFlagshipBinding();
  if (binding) {
    try {
      return await binding.getBooleanValue(key, defaultValue, toEvalContext(context));
    } catch {
      console.warn(`[flags] Flagship binding evaluation failed for "${key}", using default`);
    }
  }

  // Tier 2: OpenFeature SDK
  const ofClient = await getOpenFeatureClient();
  if (ofClient) {
    try {
      return await ofClient.getBooleanValue(key, defaultValue, toEvalContext(context));
    } catch {
      console.warn(`[flags] OpenFeature evaluation failed for "${key}", using default`);
    }
  }

  // Tier 3: Local config
  return getLocalFlag(key, defaultValue);
}

/**
 * Evaluate a string feature flag.
 *
 * @example
 * ```ts
 * const checkoutVariant = await getStringFlag("checkout-variant", "control", {
 *   userId: session.user.id,
 * });
 * ```
 */
export async function getStringFlag(
  key: string,
  defaultValue: string,
  context?: FlagContext,
): Promise<string> {
  const binding = resolveFlagshipBinding();
  if (binding) {
    try {
      return await binding.getStringValue(key, defaultValue, toEvalContext(context));
    } catch {
      console.warn(`[flags] Flagship binding evaluation failed for "${key}", using default`);
    }
  }

  const ofClient = await getOpenFeatureClient();
  if (ofClient) {
    try {
      return await ofClient.getStringValue(key, defaultValue, toEvalContext(context));
    } catch {
      console.warn(`[flags] OpenFeature evaluation failed for "${key}", using default`);
    }
  }

  return getLocalFlag(key, defaultValue);
}

/**
 * Evaluate a numeric feature flag.
 *
 * @example
 * ```ts
 * const maxUploadMb = await getNumberFlag("max-upload-mb", 10, {
 *   plan: session.user.plan,
 * });
 * ```
 */
export async function getNumberFlag(
  key: string,
  defaultValue: number,
  context?: FlagContext,
): Promise<number> {
  const binding = resolveFlagshipBinding();
  if (binding) {
    try {
      return await binding.getNumberValue(key, defaultValue, toEvalContext(context));
    } catch {
      console.warn(`[flags] Flagship binding evaluation failed for "${key}", using default`);
    }
  }

  const ofClient = await getOpenFeatureClient();
  if (ofClient) {
    try {
      return await ofClient.getNumberValue(key, defaultValue, toEvalContext(context));
    } catch {
      console.warn(`[flags] OpenFeature evaluation failed for "${key}", using default`);
    }
  }

  return getLocalFlag(key, defaultValue);
}

/**
 * Invalidate the cached local flags. Call this if you've changed flags.json
 * or FLAG_* env vars at runtime (e.g. in tests).
 */
export function invalidateFlagCache(): void {
  localFlags = null;
  openFeatureInitialized = false;
}
