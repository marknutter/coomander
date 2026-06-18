import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { expoClient } from "@better-auth/expo/client";
import * as SecureStore from "expo-secure-store";

/**
 * Mobile auth client — talks to the SAME backend as the web app.
 *
 * The `expoClient` plugin persists the session cookie in `expo-secure-store`
 * (encrypted device storage) and replays it on every request, so the user
 * stays signed in across launches. `scheme` must match `app.json`'s `scheme`
 * (used for OAuth deep-link callbacks).
 *
 * `twoFactorClient` enables TOTP 2FA verification — the same plugin the web
 * client uses. When `signIn.email()` returns `twoFactorRedirect: true`, the
 * mobile app shows a code-entry challenge and calls
 * `authClient.twoFactor.verifyTotp({ code })`.
 *
 * `EXPO_PUBLIC_API_URL` points at the running Coomander API (e.g. the Tailscale
 * dev URL or the deployed Workers URL). Better Auth's expo plugin is the only
 * mobile-specific auth code; schemas/types/API client are shared via
 * @coomander/core.
 *
 * CSRF Origin shim (geology #232): the web server has no `expo()` server
 * plugin, so Better Auth's CSRF origin check 403s mobile auth POSTs that lack
 * an `Origin` header (React Native's fetch does not set one). We inject
 * `Origin: API_URL` on every request — API_URL is always a trusted origin
 * (it's listed in the web app's `trustedOrigins`).
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3005";

export const authClient = createAuthClient({
  baseURL: API_URL,
  fetchOptions: {
    headers: {
      Origin: API_URL,
    },
  },
  plugins: [
    twoFactorClient(),
    expoClient({
      scheme: "coomander",
      storagePrefix: "coomander",
      storage: SecureStore,
    }),
  ],
});

/**
 * Module-level flag set when `signIn.email()` returns `twoFactorRedirect`.
 *
 * Better Auth's expoClient plugin stores a partial session cookie during
 * sign-in even before 2FA verification. This causes `useSession()` to
 * return a truthy value, which the auth layout guard interprets as "user
 * is authenticated → redirect to /"— but the user hasn't finished 2FA yet.
 *
 * The sign-in screen sets this flag before rendering the inline TOTP
 * challenge, and the auth layout guard skips its redirect while it's set.
 * It's cleared on successful verification or when the user goes back.
 */
export let twoFactorPending = false;
export function setTwoFactorPending(v: boolean) {
  twoFactorPending = v;
}
