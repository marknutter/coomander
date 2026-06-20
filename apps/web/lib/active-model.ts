/**
 * Active chat-model resolution (AI multiprovider — epic #203, Phase B).
 *
 * Decides which catalog model a chat request runs against, persists the admin
 * default in `app_settings`, and (optionally) a per-user preference. Consumed by
 * the admin model switcher, the per-user settings switcher, and Coomander's
 * `GET /api/coomander/agent-context` route (which feeds the live agent Worker).
 *
 * ## Resolution precedence
 *   per-user preference  >  admin default (DB)  >  CHAT_MODEL env  >  DEFAULT_MODEL_ID
 *
 * Every candidate is validated against the catalog (lib/model-catalog). Unknown
 * ids are skipped (and rejected on write), so resolution always returns a known
 * catalog entry. The multi-provider engine / agent reads the returned id and
 * its capability flags and dispatches by the entry's `provider`/`tier`.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { appSettings } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";
import {
  DEFAULT_MODEL_ID,
  isValidModelId,
  getModel,
  type ModelCatalogEntry,
} from "@/lib/model-catalog";
import { BadRequestError } from "@/lib/errors";
import { log } from "@/lib/logger";

/** Settings key holding the admin-selected default model id. */
export const ADMIN_DEFAULT_MODEL_KEY = "ai.default_model";
/** Prefix for per-user model preference keys: `ai.user_model:<userId>`. */
const USER_MODEL_KEY_PREFIX = "ai.user_model:";

async function getSetting(key: string): Promise<string | null> {
  const db = getDb();
  const row = await queryFirst(
    db.select({ value: appSettings.value }).from(appSettings).where(eq(appSettings.key, key)),
  ).catch(() => undefined);
  return row?.value ?? null;
}

async function putSetting(key: string, value: string, updatedBy: string | null): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  await db
    .insert(appSettings)
    .values({ key, value, updated_at: now, updated_by: updatedBy })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value, updated_at: now, updated_by: updatedBy },
    });
}

async function deleteSetting(key: string): Promise<void> {
  const db = getDb();
  await db.delete(appSettings).where(eq(appSettings.key, key));
}

// ─── Admin default ────────────────────────────────────────────────────────────

/** The admin-set default model id, or null when unset. May be unvalidated. */
export async function getAdminDefaultModel(): Promise<string | null> {
  return getSetting(ADMIN_DEFAULT_MODEL_KEY);
}

/**
 * Persist the admin default model. Validates against the catalog; throws
 * BadRequestError on an unknown id.
 */
export async function setAdminDefaultModel(modelId: string, updatedBy: string | null): Promise<void> {
  if (!isValidModelId(modelId)) {
    throw new BadRequestError(`Unknown model id: ${modelId}`);
  }
  await putSetting(ADMIN_DEFAULT_MODEL_KEY, modelId, updatedBy);
  log.info("[active-model] admin default model set", { modelId, updatedBy });
}

// ─── Per-user preference (optional) ─────────────────────────────────────────────

/** A user's preferred model id, or null when unset. May be unvalidated. */
export async function getUserModelPreference(userId: string): Promise<string | null> {
  return getSetting(`${USER_MODEL_KEY_PREFIX}${userId}`);
}

/**
 * Set or clear a user's model preference. Passing null clears it (revert to the
 * admin default). A non-null id must be a catalog entry AND user-selectable.
 */
export async function setUserModelPreference(
  userId: string,
  modelId: string | null,
): Promise<void> {
  const key = `${USER_MODEL_KEY_PREFIX}${userId}`;
  if (modelId === null) {
    await deleteSetting(key);
    return;
  }
  const entry = getModel(modelId);
  if (!entry) throw new BadRequestError(`Unknown model id: ${modelId}`);
  if (!entry.userSelectable) throw new BadRequestError(`Model not selectable: ${modelId}`);
  await putSetting(key, modelId, userId);
}

// ─── Resolution ─────────────────────────────────────────────────────────────────

export interface ResolveActiveModelOptions {
  /** When provided, a valid per-user preference wins over the admin default. */
  userId?: string;
}

/**
 * Resolve the active model id for a chat request, applying full precedence and
 * validating every candidate against the catalog. The returned id is ALWAYS a
 * known catalog id (worst case the built-in DEFAULT_MODEL_ID).
 */
export async function resolveActiveModelId(
  opts: ResolveActiveModelOptions = {},
): Promise<string> {
  // 1. Per-user preference (only if valid + user-selectable)
  if (opts.userId) {
    const pref = await getUserModelPreference(opts.userId);
    if (pref && getModel(pref)?.userSelectable) return pref;
  }

  // 2. Admin default
  const adminDefault = await getAdminDefaultModel();
  if (adminDefault && isValidModelId(adminDefault)) return adminDefault;

  // 3. CHAT_MODEL env
  const envModel = process.env.CHAT_MODEL;
  if (envModel && isValidModelId(envModel)) return envModel;

  // 4. Built-in default
  return DEFAULT_MODEL_ID;
}

/**
 * Resolve the active model and return the full catalog entry (id +
 * capability flags). The agent-context route uses this so the live agent can
 * tool-gate / multimodal-gate by the resolved entry's flags. Always returns a
 * known catalog entry (worst case DEFAULT_MODEL_ID's entry).
 */
export async function resolveActiveModel(
  opts: ResolveActiveModelOptions = {},
): Promise<ModelCatalogEntry> {
  const id = await resolveActiveModelId(opts);
  // resolveActiveModelId only ever returns a validated catalog id, but guard
  // anyway so the return type is non-null.
  return getModel(id) ?? getModel(DEFAULT_MODEL_ID)!;
}
