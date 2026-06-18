import { type ReactNode } from "react";
import { View, ActivityIndicator, StyleSheet } from "react-native";
import { SafeAreaView, type Edge } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";

import { useTheme } from "@/lib/theme";

/**
 * Themed screen container: paints the background token and applies safe-area
 * insets. The status bar follows the resolved theme so device icons stay legible
 * in both light and dark mode.
 */
export function Screen({
  children,
  edges = ["top", "left", "right"],
}: {
  children: ReactNode;
  edges?: readonly Edge[];
}) {
  const { colors, resolvedTheme } = useTheme();
  return (
    <SafeAreaView edges={edges} style={[styles.fill, { backgroundColor: colors.background }]}>
      <StatusBar style={resolvedTheme === "dark" ? "light" : "dark"} />
      {children}
    </SafeAreaView>
  );
}

/** Centered spinner on the themed background — the no-flash loading state. */
export function LoadingScreen() {
  const { colors } = useTheme();
  return (
    <View style={[styles.fill, styles.center, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  center: { alignItems: "center", justifyContent: "center" },
});
