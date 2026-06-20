import { describe, it, expect, beforeEach, afterEach } from "vitest";
// Importing the db helper bootstraps the Better Auth `user` table; getRawDb()
// also runs lib/migrate (which applies migrations/022 → creates app_settings).
import "./helpers/db";
import { getRawDb } from "@/lib/db";
import { createTestUser, cleanupTestUser } from "./helpers/db";
import {
  resolveActiveModel,
  resolveActiveModelId,
  getAdminDefaultModel,
  setAdminDefaultModel,
  getUserModelPreference,
  setUserModelPreference,
  ADMIN_DEFAULT_MODEL_KEY,
} from "@/lib/active-model";
import {
  DEFAULT_MODEL_ID,
  getModel,
  listModels,
} from "@/lib/model-catalog";

// ---------------------------------------------------------------------------
// active-model (#203 Phase B) — chat-model resolution + admin/user setters.
//
// Precedence: per-user preference > admin default (app_settings) > CHAT_MODEL
// env > DEFAULT_MODEL_ID. Every candidate is validated against the catalog;
// invalid/unknown ids are skipped on read, and a per-user preference that is
// not userSelectable is ignored. resolveActiveModelId returns the id string;
// resolveActiveModel returns the full catalog entry and must agree.
// ---------------------------------------------------------------------------

// Two valid catalog ids distinct from DEFAULT_MODEL_ID, to prove precedence
// actually changes the result.
const ADMIN_VALID = "claude-opus-4-8";
const USER_VALID = "claude-haiku-4-5-20251001";
const INVALID = "totally-bogus-model-id";

function userPrefKey(userId: string): string {
  return `ai.user_model:${userId}`;
}

function clearSettings(): void {
  getRawDb().exec("DELETE FROM app_settings");
}

/** Seed a raw app_settings row directly (bypasses setter validation). */
function seedSetting(key: string, value: string): void {
  const now = Math.floor(Date.now() / 1000);
  getRawDb()
    .prepare(
      "INSERT OR REPLACE INTO app_settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, NULL)",
    )
    .run(key, value, now);
}

describe("active-model", () => {
  let savedChatModel: string | undefined;
  // app_settings.updated_by FKs to user(id); the setters write it, so admin +
  // user ids must be real user rows.
  let adminId: string;
  let adminEmail: string;
  let u1: string;
  let u1Email: string;
  let u2: string;
  let u2Email: string;

  beforeEach(() => {
    const admin = createTestUser();
    adminId = admin.userId;
    adminEmail = admin.email;
    const a = createTestUser();
    u1 = a.userId;
    u1Email = a.email;
    const b = createTestUser();
    u2 = b.userId;
    u2Email = b.email;

    savedChatModel = process.env.CHAT_MODEL;
    delete process.env.CHAT_MODEL;
    clearSettings();
  });

  afterEach(() => {
    clearSettings();
    cleanupTestUser(adminId, adminEmail);
    cleanupTestUser(u1, u1Email);
    cleanupTestUser(u2, u2Email);
    if (savedChatModel === undefined) delete process.env.CHAT_MODEL;
    else process.env.CHAT_MODEL = savedChatModel;
  });

  // ── Precedence (resolveActiveModelId) ───────────────────────────────────────

  describe("resolveActiveModelId precedence", () => {
    it("falls back to DEFAULT_MODEL_ID when nothing is set", async () => {
      expect(await resolveActiveModelId()).toBe(DEFAULT_MODEL_ID);
      expect(await resolveActiveModelId({ userId: u1 })).toBe(DEFAULT_MODEL_ID);
    });

    it("admin default wins over the env / built-in fallback", async () => {
      await setAdminDefaultModel(ADMIN_VALID, adminId);
      expect(await resolveActiveModelId()).toBe(ADMIN_VALID);
    });

    it("a valid per-user preference wins over the admin default", async () => {
      await setAdminDefaultModel(ADMIN_VALID, adminId);
      await setUserModelPreference(u1, USER_VALID);
      expect(await resolveActiveModelId({ userId: u1 })).toBe(USER_VALID);
    });

    it("a user without a preference still gets the admin default", async () => {
      await setAdminDefaultModel(ADMIN_VALID, adminId);
      await setUserModelPreference(u1, USER_VALID);
      // a different user has no preference → admin default
      expect(await resolveActiveModelId({ userId: u2 })).toBe(ADMIN_VALID);
    });

    it("CHAT_MODEL env beats the built-in default but loses to the admin default", async () => {
      process.env.CHAT_MODEL = USER_VALID;
      expect(await resolveActiveModelId()).toBe(USER_VALID);
      await setAdminDefaultModel(ADMIN_VALID, adminId);
      expect(await resolveActiveModelId()).toBe(ADMIN_VALID);
    });
  });

  // ── Invalid / non-selectable stored ids fall back ───────────────────────────

  describe("resolveActiveModelId — invalid stored ids fall back", () => {
    it("an invalid admin default falls through (does NOT return the invalid id)", async () => {
      seedSetting(ADMIN_DEFAULT_MODEL_KEY, INVALID);
      const resolved = await resolveActiveModelId();
      expect(resolved).not.toBe(INVALID);
      expect(resolved).toBe(DEFAULT_MODEL_ID);
    });

    it("an invalid admin default still yields a valid env model when set", async () => {
      seedSetting(ADMIN_DEFAULT_MODEL_KEY, INVALID);
      process.env.CHAT_MODEL = ADMIN_VALID;
      expect(await resolveActiveModelId()).toBe(ADMIN_VALID);
    });

    it("an invalid CHAT_MODEL env falls through to DEFAULT_MODEL_ID", async () => {
      process.env.CHAT_MODEL = INVALID;
      expect(await resolveActiveModelId()).toBe(DEFAULT_MODEL_ID);
    });

    it("an invalid per-user preference falls through to the admin default", async () => {
      await setAdminDefaultModel(ADMIN_VALID, adminId);
      seedSetting(userPrefKey(u1), INVALID);
      const resolved = await resolveActiveModelId({ userId: u1 });
      expect(resolved).not.toBe(INVALID);
      expect(resolved).toBe(ADMIN_VALID);
    });

    it("a per-user preference that is a valid-but-NOT-userSelectable catalog id is ignored", async () => {
      // Find a real catalog id whose userSelectable is false. If none exists in
      // this catalog, the resolver's userSelectable gate can't be exercised with
      // a real id — see the reported coverage gap. The test below adapts.
      const nonSelectable = listModels().find((m) => !m.userSelectable);
      await setAdminDefaultModel(ADMIN_VALID, adminId);

      if (nonSelectable) {
        seedSetting(userPrefKey(u1), nonSelectable.id);
        const resolved = await resolveActiveModelId({ userId: u1 });
        // Not userSelectable → ignored → falls through to the admin default.
        expect(resolved).not.toBe(nonSelectable.id);
        expect(resolved).toBe(ADMIN_VALID);
      } else {
        // No non-selectable real id exists; assert the catalog invariant so the
        // gap is visible, and verify a userSelectable preference IS honored.
        expect(listModels().every((m) => m.userSelectable)).toBe(true);
        seedSetting(userPrefKey(u1), USER_VALID);
        expect(await resolveActiveModelId({ userId: u1 })).toBe(USER_VALID);
      }
    });
  });

  // ── resolveActiveModel (entry) agrees with resolveActiveModelId (id) ─────────

  describe("resolveActiveModel returns the full catalog entry, consistent with the id", () => {
    it("returns the DEFAULT_MODEL_ID entry when nothing is set", async () => {
      const entry = await resolveActiveModel();
      expect(entry.id).toBe(DEFAULT_MODEL_ID);
      expect(entry).toEqual(getModel(DEFAULT_MODEL_ID));
    });

    it("entry.id equals resolveActiveModelId for the same options (admin default)", async () => {
      await setAdminDefaultModel(ADMIN_VALID, adminId);
      const id = await resolveActiveModelId();
      const entry = await resolveActiveModel();
      expect(entry.id).toBe(id);
      expect(entry).toEqual(getModel(id));
    });

    it("entry.id equals resolveActiveModelId for a per-user preference", async () => {
      await setAdminDefaultModel(ADMIN_VALID, adminId);
      await setUserModelPreference(u1, USER_VALID);
      const id = await resolveActiveModelId({ userId: u1 });
      const entry = await resolveActiveModel({ userId: u1 });
      expect(id).toBe(USER_VALID);
      expect(entry.id).toBe(USER_VALID);
      expect(entry).toEqual(getModel(USER_VALID));
    });

    it("never returns an invalid entry — falls back to a real catalog entry", async () => {
      seedSetting(ADMIN_DEFAULT_MODEL_KEY, INVALID);
      const entry = await resolveActiveModel();
      expect(entry.id).not.toBe(INVALID);
      expect(getModel(entry.id)).toBeDefined();
    });
  });

  // ── Setters validate ────────────────────────────────────────────────────────

  describe("setAdminDefaultModel validation", () => {
    it("persists a valid model id", async () => {
      await setAdminDefaultModel(ADMIN_VALID, adminId);
      expect(await getAdminDefaultModel()).toBe(ADMIN_VALID);
    });

    it("rejects an invalid model id and persists nothing", async () => {
      await expect(setAdminDefaultModel(INVALID, adminId)).rejects.toThrow();
      expect(await getAdminDefaultModel()).toBeNull();
    });
  });

  describe("setUserModelPreference validation", () => {
    it("persists a valid, user-selectable model id", async () => {
      await setUserModelPreference(u1, USER_VALID);
      expect(await getUserModelPreference(u1)).toBe(USER_VALID);
    });

    it("rejects an unknown model id", async () => {
      await expect(setUserModelPreference(u1, INVALID)).rejects.toThrow();
      expect(await getUserModelPreference(u1)).toBeNull();
    });

    it("rejects a valid-but-NOT-userSelectable catalog id (when one exists)", async () => {
      const nonSelectable = listModels().find((m) => !m.userSelectable);
      if (nonSelectable) {
        await expect(
          setUserModelPreference(u1, nonSelectable.id),
        ).rejects.toThrow();
        expect(await getUserModelPreference(u1)).toBeNull();
      } else {
        // Catalog invariant: all entries are currently userSelectable.
        expect(listModels().every((m) => m.userSelectable)).toBe(true);
      }
    });

    it("clears the preference when passed null", async () => {
      await setUserModelPreference(u1, USER_VALID);
      expect(await getUserModelPreference(u1)).toBe(USER_VALID);
      await setUserModelPreference(u1, null);
      expect(await getUserModelPreference(u1)).toBeNull();
    });
  });
});
