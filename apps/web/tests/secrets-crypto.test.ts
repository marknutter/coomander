import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  maskSecret,
  isEncryptionConfigured,
  MissingKekError,
  DecryptError,
} from "@/lib/secrets-crypto";

// ---------------------------------------------------------------------------
// secrets-crypto (#203) — symmetric AES-256-GCM secret encryption over the Web
// Crypto API. Tested against the documented contract (round-trip, random IV,
// tamper-detection, KEK fallback) — not internal KDF details.
//
// Every test saves + restores PROVIDER_KEY_KEK and BETTER_AUTH_SECRET so env
// state never leaks across tests (BETTER_AUTH_SECRET is set globally by the
// vitest config; we must restore it).
// ---------------------------------------------------------------------------

describe("secrets-crypto", () => {
  let savedKek: string | undefined;
  let savedAuthSecret: string | undefined;

  beforeEach(() => {
    savedKek = process.env.PROVIDER_KEY_KEK;
    savedAuthSecret = process.env.BETTER_AUTH_SECRET;
  });

  afterEach(() => {
    if (savedKek === undefined) delete process.env.PROVIDER_KEY_KEK;
    else process.env.PROVIDER_KEY_KEK = savedKek;
    if (savedAuthSecret === undefined) delete process.env.BETTER_AUTH_SECRET;
    else process.env.BETTER_AUTH_SECRET = savedAuthSecret;
  });

  // ── Round-trip + random IV ──────────────────────────────────────────────────

  describe("encrypt/decrypt round-trip", () => {
    beforeEach(() => {
      process.env.PROVIDER_KEY_KEK = "test-kek-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    });

    it("encrypt then decrypt returns the original plaintext", async () => {
      const plaintext = "sk-ant-super-secret-key-123456";
      const stored = await encryptSecret(plaintext);
      expect(await decryptSecret(stored)).toBe(plaintext);
    });

    it("round-trips an empty string and unicode", async () => {
      expect(await decryptSecret(await encryptSecret(""))).toBe("");
      const unicode = "🔐 clé-secrète ☂ 秘密";
      expect(await decryptSecret(await encryptSecret(unicode))).toBe(unicode);
    });

    it("ciphertext does not equal / contain the plaintext", async () => {
      const plaintext = "sk-ant-plaintext-value";
      const stored = await encryptSecret(plaintext);
      expect(stored).not.toBe(plaintext);
      expect(stored).not.toContain(plaintext);
    });

    it("two encryptions of the same plaintext differ (random IV) but both decrypt", async () => {
      const a = await encryptSecret("same-input");
      const b = await encryptSecret("same-input");
      expect(a).not.toBe(b);
      expect(await decryptSecret(a)).toBe("same-input");
      expect(await decryptSecret(b)).toBe("same-input");
    });
  });

  // ── Tamper / format error paths ─────────────────────────────────────────────

  describe("decryptSecret rejects tampered or malformed input", () => {
    beforeEach(() => {
      process.env.PROVIDER_KEY_KEK = "test-kek-aaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    });

    it("throws DecryptError on a non-versioned / wrong-shape input", async () => {
      await expect(decryptSecret("not-a-ciphertext")).rejects.toBeInstanceOf(
        DecryptError,
      );
    });

    it("throws DecryptError on a wrong version prefix", async () => {
      const stored = await encryptSecret("hello");
      await expect(
        decryptSecret(stored.replace(/^v1:/, "v2:")),
      ).rejects.toBeInstanceOf(DecryptError);
    });

    it("throws DecryptError on too-few / too-many segments", async () => {
      await expect(decryptSecret("v1:onlyonepart")).rejects.toBeInstanceOf(
        DecryptError,
      );
      await expect(decryptSecret("v1:a:b:c:extra")).rejects.toBeInstanceOf(
        DecryptError,
      );
    });

    it("throws DecryptError on a tampered ciphertext (flip a char)", async () => {
      const stored = await encryptSecret("tamper-target");
      const parts = stored.split(":");
      const data = parts[2];
      const replacement = data[0] === "A" ? "B" : "A";
      parts[2] = replacement + data.slice(1);
      await expect(decryptSecret(parts.join(":"))).rejects.toBeInstanceOf(
        DecryptError,
      );
    });

    it("throws DecryptError when decrypted under the wrong KEK", async () => {
      const stored = await encryptSecret("secret-under-kek-A");
      process.env.PROVIDER_KEY_KEK = "different-kek-bbbbbbbbbbbbbbbbbbbbbbbb";
      await expect(decryptSecret(stored)).rejects.toBeInstanceOf(DecryptError);
    });
  });

  // ── isEncryptionConfigured + KEK fallback ───────────────────────────────────

  describe("isEncryptionConfigured + KEK resolution", () => {
    it("reflects whether PROVIDER_KEY_KEK or BETTER_AUTH_SECRET is set", () => {
      delete process.env.PROVIDER_KEY_KEK;
      delete process.env.BETTER_AUTH_SECRET;
      expect(isEncryptionConfigured()).toBe(false);

      process.env.BETTER_AUTH_SECRET = "fallback-kek-from-auth-secret";
      expect(isEncryptionConfigured()).toBe(true);

      delete process.env.BETTER_AUTH_SECRET;
      process.env.PROVIDER_KEY_KEK = "primary-kek";
      expect(isEncryptionConfigured()).toBe(true);
    });

    it("encryptSecret throws MissingKekError when no KEK is configured", async () => {
      delete process.env.PROVIDER_KEY_KEK;
      delete process.env.BETTER_AUTH_SECRET;
      await expect(encryptSecret("x")).rejects.toBeInstanceOf(MissingKekError);
    });

    it("falls back to BETTER_AUTH_SECRET as the KEK when PROVIDER_KEY_KEK is unset", async () => {
      delete process.env.PROVIDER_KEY_KEK;
      process.env.BETTER_AUTH_SECRET = "auth-secret-used-as-kek";
      const stored = await encryptSecret("works-via-fallback");
      expect(await decryptSecret(stored)).toBe("works-via-fallback");
    });

    it("PROVIDER_KEY_KEK and BETTER_AUTH_SECRET derive DIFFERENT keys (fallback is not interchangeable)", async () => {
      // Encrypt under PROVIDER_KEY_KEK, then drop it so only the (different)
      // BETTER_AUTH_SECRET remains — decryption must fail, proving the KEK
      // actually changed (not that the two values happened to coincide).
      process.env.PROVIDER_KEY_KEK = "explicit-primary-kek-value";
      process.env.BETTER_AUTH_SECRET = "a-totally-different-auth-secret";
      const stored = await encryptSecret("scoped-to-primary");
      delete process.env.PROVIDER_KEY_KEK;
      await expect(decryptSecret(stored)).rejects.toBeInstanceOf(DecryptError);
    });
  });

  // ── maskSecret ──────────────────────────────────────────────────────────────

  describe("maskSecret", () => {
    it("returns a fixed placeholder for short secrets (<= 8 chars)", () => {
      expect(maskSecret("")).toBe("••••••••");
      expect(maskSecret("abc")).toBe("••••••••");
      expect(maskSecret("12345678")).toBe("••••••••");
    });

    it("returns ••••<last4> for longer secrets and never reveals the full value", () => {
      expect(maskSecret("123456789")).toBe("••••6789");
      const secret = "sk-ant-very-long-secret-value-xyz";
      const masked = maskSecret(secret);
      expect(masked).toContain(secret.slice(-4));
      expect(masked).not.toContain(secret.slice(0, 5));
    });
  });
});
