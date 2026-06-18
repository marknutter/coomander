import { View, Text, Pressable, StyleSheet } from "react-native";

import { authClient } from "@/lib/auth-client";
import { useTheme } from "@/lib/theme";
import { Screen } from "@/components/screen";

/**
 * Protected home screen. Confirms the mobile auth round-trip works end to end:
 * it renders the signed-in user's name/email (from the Better Auth session)
 * and offers a sign-out button. This is the minimal proof that the
 * @better-auth/expo client, the secure-store session cookie, and the shared
 * web backend are all wired together correctly.
 */
export default function HomeScreen() {
  const { colors } = useTheme();
  const { data: session } = authClient.useSession();
  const user = session?.user;

  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <View style={styles.container}>
        <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
          SIGNED IN
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {user?.name ?? "Welcome"}
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          {user?.email ?? "You are signed in to Coomander."}
        </Text>

        <Pressable
          onPress={() => authClient.signOut()}
          accessibilityRole="button"
          style={[styles.button, { backgroundColor: colors.primary }]}
        >
          <Text style={[styles.buttonLabel, { color: colors.primaryForeground }]}>
            Sign out
          </Text>
        </Pressable>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: "center", alignItems: "center", padding: 24, gap: 8 },
  eyebrow: { fontSize: 11, letterSpacing: 1.4, textTransform: "uppercase" },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 15, textAlign: "center" },
  button: {
    marginTop: 24,
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 28,
    alignItems: "center",
  },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
});
