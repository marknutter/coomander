/**
 * Minimal ambient declarations for the handful of universally-available Web
 * Platform globals that @coomander/core relies on for base64 decoding.
 *
 * core's tsconfig deliberately omits the `DOM` lib and `@types/node` (issue
 * #344) so the compiler rejects accidental platform coupling. But `atob`,
 * `TextDecoder`, and `Uint8Array`-from-`TextDecoder` are part of the WHATWG /
 * Encoding standards and exist in EVERY target this package runs in — browsers,
 * React Native (Hermes), Cloudflare workerd, and Node 18+. Declaring just these
 * signatures keeps the guard intact (no DOM, no Node) while letting the pure
 * base64 helpers compile. Runtime behaviour is unaffected.
 */

/** WHATWG base64 decode: binary string (one char per byte) ← base64. */
declare function atob(data: string): string;

/** Encoding Standard TextDecoder — only the `decode` surface core uses. */
declare class TextDecoder {
  constructor(label?: string);
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}
