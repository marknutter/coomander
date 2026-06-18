import { Stack, Redirect } from "expo-router";

import { authClient } from "@/lib/auth-client";
import { LoadingScreen } from "@/components/screen";

/**
 * Protected route group. Gates every screen below it on the Better Auth
 * session: while the session is loading we render only a spinner, and an
 * unauthenticated user is redirected to sign-in BEFORE any protected screen
 * mounts — so there is no flash of protected content.
 */
export default function ProtectedLayout() {
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <LoadingScreen />;
  if (!session) return <Redirect href="/sign-in" />;

  return <Stack screenOptions={{ headerShown: false }} />;
}
