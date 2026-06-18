import { Stack, Redirect } from "expo-router";

import { authClient, twoFactorPending } from "@/lib/auth-client";
import { LoadingScreen } from "@/components/screen";

/**
 * Auth route group. The inverse guard of `(app)`: an already-authenticated user
 * is bounced to the protected shell so they never see the sign-in screen again.
 *
 * Two important guards:
 *
 * 1. `isPending` → show loading screen (but NOT during 2FA — see below).
 * 2. `session && !twoFactorPending` → redirect to protected shell.
 *
 * During the 2FA challenge, Better Auth's `useSession()` flickers `isPending`
 * between true/false. If we show `<LoadingScreen />` during that flicker, it
 * unmounts the Stack (and the sign-in screen), which resets the component
 * state — killing the inline 2FA challenge. So we skip the loading screen
 * entirely while `twoFactorPending` is set.
 */
export default function AuthLayout() {
  const { data: session, isPending } = authClient.useSession();

  // During 2FA challenge, never show loading screen — it would unmount
  // the sign-in screen and lose the showTwoFactor state.
  if (isPending && !twoFactorPending) return <LoadingScreen />;

  if (session && !twoFactorPending) return <Redirect href="/" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
