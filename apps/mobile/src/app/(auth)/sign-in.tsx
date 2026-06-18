import { useState, useRef } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { authClient, setTwoFactorPending } from "@/lib/auth-client";
import { useTheme } from "@/lib/theme";
import { Screen } from "@/components/screen";

// Minimal inline validation. When @coomander/core grows shared auth schemas
// (signInSchema / totpSchema, extracted from apps/web), swap these for the
// shared Zod schemas so web and mobile validate identically.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSignIn(email: string, password: string): Record<string, string> {
  const errs: Record<string, string> = {};
  if (!email.trim()) errs.email = "Email is required";
  else if (!EMAIL_RE.test(email.trim())) errs.email = "Enter a valid email address";
  if (!password) errs.password = "Password is required";
  return errs;
}

// ---------------------------------------------------------------------------
// Inline 2FA challenge — rendered in place of the sign-in form when the
// server responds with twoFactorRedirect. Avoids navigating to a separate
// route that races with the auth layout guard.
// ---------------------------------------------------------------------------

function TwoFactorChallenge({
  colors,
  onBack,
}: {
  colors: ReturnType<typeof useTheme>["colors"];
  onBack: () => void;
}) {
  const inputRef = useRef<TextInput>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCodeChange(text: string) {
    setCode(text.replace(/\D/g, "").slice(0, 6));
  }

  async function verify() {
    setError(null);
    if (code.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    setBusy(true);
    try {
      const res = await authClient.twoFactor.verifyTotp({ code });
      if (res.error) {
        setError(res.error.message ?? "Invalid code");
      } else {
        // 2FA complete — clear the flag so the auth guard redirects to /.
        setTwoFactorPending(false);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.brand}>
        <View style={[styles.iconCircle, { backgroundColor: colors.accent }]}>
          <Feather name="lock" size={28} color={colors.primary} />
        </View>
        <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
          CHECKPOINT
        </Text>
        <Text style={[styles.title, { color: colors.foreground }]}>
          Two-factor authentication
        </Text>
        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Enter the 6-digit code from your authenticator app.
        </Text>
      </View>

      <View style={styles.form}>
        <TextInput
          ref={inputRef}
          style={[
            styles.codeInput,
            {
              backgroundColor: colors.card,
              borderColor: error ? colors.destructive : colors.border,
              color: colors.foreground,
            },
          ]}
          placeholder="000000"
          placeholderTextColor={colors.mutedForeground}
          keyboardType="number-pad"
          maxLength={6}
          autoFocus
          value={code}
          onChangeText={handleCodeChange}
          editable={!busy}
          textContentType="oneTimeCode"
        />

        {error ? (
          <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
        ) : null}

        <Pressable
          onPress={verify}
          disabled={busy || code.length !== 6}
          accessibilityRole="button"
          style={[
            styles.button,
            {
              backgroundColor: colors.primary,
              opacity: busy || code.length !== 6 ? 0.7 : 1,
            },
          ]}
        >
          {busy ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={[styles.buttonLabel, { color: colors.primaryForeground }]}>
              Verify
            </Text>
          )}
        </Pressable>

        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          style={styles.backButton}
        >
          <Text style={[styles.backLabel, { color: colors.mutedForeground }]}>
            Back to sign in
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main sign-in screen
// ---------------------------------------------------------------------------

/**
 * Sign-in screen — email/password + inline 2FA challenge.
 *
 * When `signIn.email()` returns `{ twoFactorRedirect: true }`, we render
 * the TOTP code entry inline (not via route navigation) to avoid racing
 * with the auth layout guard. On success, the session activates and the
 * guard redirects to the protected shell.
 */
export default function SignInScreen() {
  const { colors } = useTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [showTwoFactor, setShowTwoFactor] = useState(false);

  async function signIn() {
    setError(null);

    const errs = validateSignIn(email, password);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    setBusy(true);
    try {
      const res = await authClient.signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? "Sign-in failed");
      } else if ((res.data as Record<string, unknown>)?.twoFactorRedirect) {
        setTwoFactorPending(true);
        setShowTwoFactor(true);
      } else {
        // Session activated — auth guard handles redirect.
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // ── 2FA challenge (inline) ──────────────────────────────────────────────
  if (showTwoFactor) {
    return (
      <Screen edges={["top", "bottom", "left", "right"]}>
        <KeyboardAvoidingView
          style={styles.fill}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <TwoFactorChallenge
              colors={colors}
              onBack={() => {
                setTwoFactorPending(false);
                setShowTwoFactor(false);
              }}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    );
  }

  // ── Sign-in form ────────────────────────────────────────────────────────
  return (
    <Screen edges={["top", "bottom", "left", "right"]}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.container}>
            {/* Brand */}
            <View style={styles.brand}>
              <Feather name="command" size={36} color={colors.primary} />
              <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>
                ACCESS
              </Text>
              <Text style={[styles.title, { color: colors.foreground }]}>Coomander</Text>
              <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
                Sign in to your account
              </Text>
            </View>

            {/* Email/password form */}
            <View style={styles.form}>
              <View>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.card,
                      borderColor: fieldErrors.email ? colors.destructive : colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  placeholder="Email"
                  placeholderTextColor={colors.mutedForeground}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  value={email}
                  onChangeText={setEmail}
                  editable={!busy}
                />
                {fieldErrors.email ? (
                  <Text style={[styles.fieldError, { color: colors.destructive }]}>
                    {fieldErrors.email}
                  </Text>
                ) : null}
              </View>

              <View>
                <TextInput
                  style={[
                    styles.input,
                    {
                      backgroundColor: colors.card,
                      borderColor: fieldErrors.password ? colors.destructive : colors.border,
                      color: colors.foreground,
                    },
                  ]}
                  placeholder="Password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  autoComplete="password"
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                />
                {fieldErrors.password ? (
                  <Text style={[styles.fieldError, { color: colors.destructive }]}>
                    {fieldErrors.password}
                  </Text>
                ) : null}
              </View>

              {/* General error */}
              {error ? (
                <Text style={[styles.error, { color: colors.destructive }]}>{error}</Text>
              ) : null}

              {/* Submit */}
              <Pressable
                onPress={signIn}
                disabled={busy}
                accessibilityRole="button"
                style={[
                  styles.button,
                  { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 },
                ]}
              >
                {busy ? (
                  <ActivityIndicator color={colors.primaryForeground} />
                ) : (
                  <Text style={[styles.buttonLabel, { color: colors.primaryForeground }]}>
                    Sign in
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  scrollContent: { flexGrow: 1, justifyContent: "center" },
  container: { flex: 1, justifyContent: "center", padding: 24, gap: 24 },
  brand: { alignItems: "center", gap: 8 },
  eyebrow: {
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: { fontSize: 28, fontWeight: "700" },
  subtitle: { fontSize: 15 },
  form: { gap: 12 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
  },
  fieldError: { fontSize: 13, marginTop: 4, marginLeft: 4 },
  error: { fontSize: 14 },
  button: {
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  buttonLabel: { fontSize: 16, fontWeight: "600" },
  // 2FA inline
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  codeInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 16,
    fontSize: 24,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    letterSpacing: 8,
  },
  backButton: { alignItems: "center", paddingVertical: 8 },
  backLabel: { fontSize: 14 },
});
