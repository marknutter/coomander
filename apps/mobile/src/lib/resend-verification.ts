import { authClient, API_URL } from "./auth-client";

/**
 * Resend the email-verification email for the given address.
 *
 * Used by the Settings screen so the (subtle) Better Auth call semantics live
 * in one place:
 *
 *  - Better Auth's client resolves to `{ data, error }` rather than throwing on
 *    a non-2xx response, so we MUST inspect `error` — a bare try/catch around
 *    the call is dead code for HTTP errors. We also keep a try/catch for genuine
 *    throws (network down, expo SecureStore/cookie errors).
 *  - `callbackURL` is absolute on purpose: the `@better-auth/expo` client
 *    rewrites any `/`-prefixed callbackURL into a `coomander://` deep link, which
 *    fails the server's origin check and is un-followable from a desktop mail
 *    client. An absolute https URL is left untouched.
 *  - The authenticated POST succeeds because the auth client sends an `Origin`
 *    header (see auth-client.ts); without it the server rejects with 403
 *    MISSING_OR_NULL_ORIGIN.
 *
 * Returns `{ ok: true }` on success, `{ ok: false }` on any failure (after
 * logging the real error). Never throws — callers drive their own UI from `ok`.
 */
export async function resendVerificationEmail(
  email: string,
): Promise<{ ok: boolean }> {
  try {
    const res = await authClient.sendVerificationEmail({
      email,
      callbackURL: `${API_URL}/app`,
    });
    if (res?.error) {
      console.warn(
        "[resendVerificationEmail] server returned error:",
        res.error.status,
        res.error.message,
      );
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[resendVerificationEmail] request threw:", err);
    return { ok: false };
  }
}
