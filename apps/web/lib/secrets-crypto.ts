/**
 * Symmetric encryption for secrets at rest (AI Gateway Phase 2 — issue #465).
 *
 * Used to encrypt provider API keys (Anthropic/OpenAI/Google) before storing
 * them in D1/SQLite/PG. Uses the Web Crypto API (`globalThis.crypto.subtle`) so
 * it runs identically on Node.js and on Cloudflare Workers — no npm dependency.
 *
 * ## Scheme
 *  - Algorithm: AES-256-GCM (authenticated; tamper-evident).
 *  - Key derivation: PBKDF2-SHA-256 (210k iterations) over a Key Encryption Key
 *    (KEK) read from `PROVIDER_KEY_KEK`, falling back to `BETTER_AUTH_SECRET`.
 *    A fixed application salt is used so the same KEK always derives the same
 *    AES key (we don't store a per-secret KDF salt — the per-message IV gives
 *    us the required uniqueness for GCM).
 *  - Per-encryption random 96-bit IV. Output is versioned and self-describing:
 *      "v1:" + base64(iv) + ":" + base64(ciphertext+tag)
 *
 * ## Security notes
 *  - Never log plaintext or ciphertext of a key. Callers must treat decrypted
 *    values as write-only/secret.
 *  - Rotating the KEK invalidates all stored ciphertexts (they become
 *    undecryptable) — admins must re-enter provider keys after a KEK change.
 *    This is intentional: the DB never holds a key recoverable without the KEK.
 */

const VERSION = "v1";
const PBKDF2_ITERATIONS = 210_000;
const IV_BYTES = 12; // 96-bit IV recommended for AES-GCM

// Fixed, non-secret application salt. The secret is the KEK; the salt only needs
// to be stable + domain-separated, not secret. Changing it is a KEK rotation.
const APP_SALT = new TextEncoder().encode("coomander:provider-key-kek:v1");

/** Thrown when no KEK is configured in the environment. */
export class MissingKekError extends Error {
  constructor() {
    super(
      "No key-encryption key configured. Set PROVIDER_KEY_KEK or BETTER_AUTH_SECRET.",
    );
    this.name = "MissingKekError";
  }
}

/** Thrown when a ciphertext cannot be decrypted (bad format, wrong KEK, tamper). */
export class DecryptError extends Error {
  constructor(message = "Failed to decrypt secret") {
    super(message);
    this.name = "DecryptError";
  }
}

/** Resolve the raw KEK material from the environment. */
function getKekMaterial(): string {
  const kek = process.env.PROVIDER_KEY_KEK || process.env.BETTER_AUTH_SECRET;
  if (!kek) throw new MissingKekError();
  return kek;
}

/** True when a KEK is available — lets callers degrade gracefully (no throw). */
export function isEncryptionConfigured(): boolean {
  return Boolean(process.env.PROVIDER_KEY_KEK || process.env.BETTER_AUTH_SECRET);
}

function getSubtle(): SubtleCrypto {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("Web Crypto SubtleCrypto is not available in this runtime");
  }
  return subtle;
}

/** Derive the AES-GCM key from the KEK via PBKDF2. */
async function deriveAesKey(): Promise<CryptoKey> {
  const subtle = getSubtle();
  const keyMaterial = await subtle.importKey(
    "raw",
    new TextEncoder().encode(getKekMaterial()),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: APP_SALT,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function toBase64(bytes: Uint8Array): string {
  // Buffer is available on Node and in the Workers runtime (nodejs_compat).
  return Buffer.from(bytes).toString("base64");
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const buf = Buffer.from(b64, "base64");
  // Copy into a standalone ArrayBuffer so the typed array is `Uint8Array<ArrayBuffer>`
  // (a valid BufferSource) rather than a view over Node's shared pool buffer.
  const out = new Uint8Array(new ArrayBuffer(buf.byteLength));
  out.set(buf);
  return out;
}

/**
 * Encrypt a plaintext secret. Returns a versioned, self-describing string safe
 * to store in a TEXT column: `v1:<base64 iv>:<base64 ciphertext+tag>`.
 *
 * @throws {MissingKekError} when no KEK is configured.
 */
export async function encryptSecret(plaintext: string): Promise<string> {
  const subtle = getSubtle();
  const key = await deriveAesKey();
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  return `${VERSION}:${toBase64(iv)}:${toBase64(ciphertext)}`;
}

/**
 * Decrypt a string produced by {@link encryptSecret}. Returns the plaintext.
 *
 * @throws {MissingKekError} when no KEK is configured.
 * @throws {DecryptError} when the input is malformed or fails authentication
 *   (wrong KEK, corrupted/tampered ciphertext).
 */
export async function decryptSecret(stored: string): Promise<string> {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new DecryptError("Unrecognized ciphertext format");
  }
  const [, ivB64, dataB64] = parts;

  let iv: Uint8Array<ArrayBuffer>;
  let data: Uint8Array<ArrayBuffer>;
  try {
    iv = fromBase64(ivB64);
    data = fromBase64(dataB64);
  } catch {
    throw new DecryptError("Malformed ciphertext encoding");
  }

  try {
    const subtle = getSubtle();
    const key = await deriveAesKey();
    const plaintext = await subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return new TextDecoder().decode(plaintext);
  } catch (err) {
    if (err instanceof MissingKekError) throw err;
    throw new DecryptError();
  }
}

/**
 * Mask a secret for display — never reveal the full value. Shows the last 4
 * characters when the secret is long enough, otherwise a fixed placeholder.
 * Intended for "configured (••••abcd)" UI hints; the plaintext never reaches
 * the client, so this runs server-side on a freshly decrypted value if at all.
 */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return "••••••••";
  return `••••${plaintext.slice(-4)}`;
}
