import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

/**
 * App-wide error boundary. Catches unhandled JS errors in the component tree
 * and shows a friendly fallback instead of crashing to a blank screen.
 *
 * Mounted once in the root layout so it wraps the entire Stack.
 */

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Log to console in dev — swap for a crash reporter in production.
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <View style={styles.container}>
          <Ionicons name="warning-outline" size={56} color="#ef4444" />
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.body}>
            The app ran into an unexpected error. Try again, or restart the app
            if the problem persists.
          </Text>
          {__DEV__ && this.state.error ? (
            <Text style={styles.errorDetail} numberOfLines={6}>
              {this.state.error.message}
            </Text>
          ) : null}
          <Pressable
            onPress={this.handleRetry}
            accessibilityRole="button"
            style={styles.retryBtn}
          >
            <Text style={styles.retryLabel}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#0a0a0a",
    padding: 32,
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#fafafa",
    marginTop: 8,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    color: "#a1a1aa",
    textAlign: "center",
  },
  errorDetail: {
    fontSize: 12,
    fontFamily: "monospace",
    color: "#ef4444",
    backgroundColor: "#1c1c1c",
    padding: 12,
    borderRadius: 8,
    width: "100%",
    marginTop: 8,
  },
  retryBtn: {
    marginTop: 16,
    backgroundColor: "#208AEF",
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  retryLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#fff",
  },
});
