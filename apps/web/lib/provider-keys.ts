/**
 * Provider API key management (AI Gateway Phase 2 — issue #465).
 *
 * Admins set/replace provider keys (Anthropic/OpenAI/Google) from the admin UI.
 * Keys are encrypted at rest (lib/secrets-crypto, AES-GCM) and stored one row
 * per provider in the `provider_keys` table. The plaintext is NEVER returned to
 * the client and NEVER logged.
 *
 * ## Resolution precedence (used by the chat engine / provider layer)
 *   admin-set key (DB, decrypted)  >  ENV var (e.g. ANTHROPIC_API_KEY)
 *
 * The DB-set key takes precedence so an operator can rotate keys at runtime
 * without a redeploy; ENV remains the zero-config default.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { providerKeys } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";
import { encryptSecret, decryptSecret, maskSecret, isEncryptionConfigured } from "./secrets-crypto";
import { log } from "@/lib/logger";

// NOTE: provider ids are inlined locally (PROVIDERS below) rather than imported
// from a model catalog — the catalog is deferred, so this module stays
// catalog-free and only needs the provider id strings.

/** Providers that can hold a managed key. */
export const PROVIDERS = ["anthropic", "openai", "google"] as const;
export type KeyProvider = (typeof PROVIDERS)[number];

/** The ENV var that holds each provider's key when no DB key is set. */
const ENV_VAR_BY_PROVIDER: Record<KeyProvider, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  google: "GOOGLE_API_KEY",
};

export function isKeyProvider(value: string): value is KeyProvider {
  return (PROVIDERS as readonly string[]).includes(value);
}

/** Where a resolved key came from. */
export type KeySource = "db" | "env" | "none";

export interface ProviderKeyStatus {
  provider: KeyProvider;
  /** True when a usable key exists from either source. */
  configured: boolean;
  /** Which source supplies the active key (db wins over env). */
  source: KeySource;
  /** Masked hint (last 4) when a DB key is set; never the full key. */
  hint: string | null;
  /** Whether the corresponding ENV var is present (independent of DB). */
  envPresent: boolean;
  /** Unix-seconds of the last DB update, or null when no DB key. */
  updatedAt: number | null;
}

/**
 * Set or replace a provider's key. Encrypts before storing and records a
 * masked last-4 hint for the UI. Admin-gated by the caller (API route).
 *
 * @throws when encryption is not configured (no KEK) or the key is empty.
 */
export async function setProviderKey(
  provider: KeyProvider,
  plaintextKey: string,
  updatedBy: string | null,
): Promise<void> {
  const trimmed = plaintextKey.trim();
  if (!trimmed) throw new Error("Provider key cannot be empty");
  if (!isEncryptionConfigured()) {
    throw new Error("Cannot store provider key: no PROVIDER_KEY_KEK / BETTER_AUTH_SECRET configured");
  }

  const encrypted = await encryptSecret(trimmed);
  const hint = maskSecret(trimmed);
  const now = Math.floor(Date.now() / 1000);

  const db = getDb();
  await db
    .insert(providerKeys)
    .values({
      provider,
      encrypted_key: encrypted,
      key_hint: hint,
      created_at: now,
      updated_at: now,
      updated_by: updatedBy,
    })
    .onConflictDoUpdate({
      target: providerKeys.provider,
      set: {
        encrypted_key: encrypted,
        key_hint: hint,
        updated_at: now,
        updated_by: updatedBy,
      },
    });

  // Intentionally log only the provider + actor — NEVER the key or ciphertext.
  log.info("[provider-keys] key set", { provider, updatedBy });
}

/** Delete a provider's DB key (falls back to ENV afterwards). */
export async function deleteProviderKey(provider: KeyProvider): Promise<void> {
  const db = getDb();
  await db.delete(providerKeys).where(eq(providerKeys.provider, provider));
  log.info("[provider-keys] key cleared", { provider });
}

/** Back-compat alias for {@link deleteProviderKey}. */
export const clearProviderKey = deleteProviderKey;

/** Fetch the raw stored row for a provider, or undefined. Internal. */
async function getStoredRow(provider: KeyProvider) {
  const db = getDb();
  return queryFirst(db.select().from(providerKeys).where(eq(providerKeys.provider, provider)));
}

/**
 * Resolve the usable plaintext key for a provider following precedence
 * (DB-set > ENV). Returns null when neither source has a key.
 *
 * The decrypted value is secret — callers must not log or return it. On a
 * decrypt failure (e.g. KEK rotated, corrupted row) we log a warning WITHOUT
 * the value and fall back to ENV so the app keeps working.
 */
export async function resolveProviderKey(provider: KeyProvider): Promise<string | null> {
  const row = await getStoredRow(provider).catch(() => undefined);
  if (row?.encrypted_key) {
    try {
      return await decryptSecret(row.encrypted_key);
    } catch (err) {
      log.warn("[provider-keys] failed to decrypt stored key; falling back to ENV", {
        provider,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const envVal = process.env[ENV_VAR_BY_PROVIDER[provider]];
  return envVal && envVal.trim() ? envVal : null;
}

/**
 * Report configured/not status for a provider without revealing the key.
 * Safe to return to the admin client.
 */
export async function getProviderKeyStatus(provider: KeyProvider): Promise<ProviderKeyStatus> {
  const envPresent = Boolean(process.env[ENV_VAR_BY_PROVIDER[provider]]?.trim());
  const row = await getStoredRow(provider).catch(() => undefined);

  if (row?.encrypted_key) {
    return {
      provider,
      configured: true,
      source: "db",
      hint: row.key_hint ?? null,
      envPresent,
      updatedAt: row.updated_at ?? null,
    };
  }

  return {
    provider,
    configured: envPresent,
    source: envPresent ? "env" : "none",
    hint: null,
    envPresent,
    updatedAt: null,
  };
}

/** Status for every managed provider — drives the admin UI list. */
export async function listProviderKeyStatus(): Promise<ProviderKeyStatus[]> {
  return Promise.all(PROVIDERS.map((p) => getProviderKeyStatus(p)));
}

/** Back-compat alias for {@link listProviderKeyStatus}. */
export const getAllProviderKeyStatuses = listProviderKeyStatus;
