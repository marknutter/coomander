import { Stack } from "expo-router";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ThemeProvider } from "@/lib/theme";
import { ErrorBoundary } from "@/components/error-boundary";

/**
 * Root layout. Wraps the whole app in an error boundary, theme provider, and
 * safe-area context. Routing is deferred to the `(app)` (protected) and
 * `(auth)` route groups, each of which enforces its own session guard.
 */
export default function RootLayout() {
  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <ThemeProvider>
            <Stack screenOptions={{ headerShown: false }} />
          </ThemeProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}
