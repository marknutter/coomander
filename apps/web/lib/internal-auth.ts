import crypto from "crypto";

/**
 * Constant-time string comparison for shared-secret auth on internal routes.
 * Length-guards first (timingSafeEqual throws on length mismatch), then compares
 * in constant time so a `!==` early-exit can't leak the secret via timing.
 */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
