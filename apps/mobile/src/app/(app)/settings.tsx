import { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Modal,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  StyleSheet,
} from "react-native";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";

import { authClient, API_URL } from "@/lib/auth-client";
import { resendVerificationEmail } from "@/lib/resend-verification";
import { useTheme, type Theme } from "@/lib/theme";
import { Screen } from "@/components/screen";

type Colors = ReturnType<typeof useTheme>["colors"];

// ---------------------------------------------------------------------------
// Header (inline — mirrors the chat screen's header style with a back chevron)
// ---------------------------------------------------------------------------

function SettingsHeader({ colors }: { colors: Colors }) {
  const router = useRouter();
  return (
    <View
      style={[styles.header, { backgroundColor: colors.card, borderBottomColor: colors.border }]}
    >
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
        style={styles.headerBack}
      >
        <Feather name="chevron-left" size={24} color={colors.foreground} />
        <Text style={[styles.headerTitle, { color: colors.foreground }]}>Settings</Text>
      </Pressable>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------

function Section({
  label,
  colors,
  children,
}: {
  label: string;
  colors: Colors;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.section}>
      <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {children}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

function SettingRow({
  label,
  value,
  colors,
  onPress,
  icon,
  destructive,
  trailing,
}: {
  label: string;
  value?: string;
  colors: Colors;
  onPress?: () => void;
  icon?: keyof typeof Feather.glyphMap;
  destructive?: boolean;
  trailing?: React.ReactNode;
}) {
  const textColor = destructive ? colors.destructive : colors.foreground;
  const Wrapper = onPress ? Pressable : View;

  return (
    <Wrapper onPress={onPress} accessibilityRole={onPress ? "button" : undefined} style={styles.row}>
      <View style={styles.rowLeft}>
        {icon ? (
          <Feather name={icon} size={18} color={textColor} style={styles.rowIcon} />
        ) : null}
        <View style={styles.rowText}>
          <Text style={[styles.rowLabel, { color: textColor }]}>{label}</Text>
          {value ? (
            <Text style={[styles.rowValue, { color: colors.mutedForeground }]} numberOfLines={1}>
              {value}
            </Text>
          ) : null}
        </View>
      </View>
      {trailing ??
        (onPress ? <Feather name="chevron-right" size={16} color={colors.mutedForeground} /> : null)}
    </Wrapper>
  );
}

function Divider({ colors }: { colors: Colors }) {
  return <View style={[styles.divider, { backgroundColor: colors.border }]} />;
}

// ---------------------------------------------------------------------------
// Theme picker
// ---------------------------------------------------------------------------

function ThemePicker({
  theme,
  setTheme,
  colors,
}: {
  theme: Theme;
  setTheme: (t: Theme) => void;
  colors: Colors;
}) {
  const options: Array<{ value: Theme; label: string; icon: keyof typeof Feather.glyphMap }> = [
    { value: "light", label: "Light", icon: "sun" },
    { value: "dark", label: "Dark", icon: "moon" },
    { value: "system", label: "System", icon: "smartphone" },
  ];

  return (
    <View style={styles.themePicker}>
      {options.map((opt) => {
        const active = theme === opt.value;
        return (
          <Pressable
            key={opt.value}
            onPress={() => setTheme(opt.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            style={[
              styles.themeOption,
              {
                backgroundColor: active ? colors.accent : "transparent",
                borderColor: active ? colors.primary : colors.border,
              },
            ]}
          >
            <Feather
              name={opt.icon}
              size={16}
              color={active ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={[styles.themeLabel, { color: active ? colors.primary : colors.mutedForeground }]}
            >
              {opt.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// 2FA enable modal — password → enable → verify → backup codes
// ---------------------------------------------------------------------------

function TwoFactorEnableModal({
  visible,
  colors,
  onClose,
  onEnabled,
}: {
  visible: boolean;
  colors: Colors;
  onClose: () => void;
  onEnabled: () => void;
}) {
  const [step, setStep] = useState<"password" | "verify" | "backup">("password");
  const [password, setPassword] = useState("");
  const [secret, setSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setStep("password");
      setPassword("");
      setSecret(null);
      setBackupCodes([]);
      setCode("");
      setError(null);
    }
  }, [visible]);

  async function startEnrollment() {
    if (!password.trim()) {
      setError("Password is required");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { data, error: err } = await authClient.twoFactor.enable({ password });
      if (err) throw new Error(err.message ?? "Failed to start enrollment");
      if (data?.totpURI) {
        const match = data.totpURI.match(/secret=([^&]+)/);
        setSecret(match ? match[1] : null);
      }
      if (data?.backupCodes) setBackupCodes(data.backupCodes);
      setStep("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to enable 2FA");
    } finally {
      setBusy(false);
    }
  }

  async function verify() {
    if (code.length !== 6) {
      setError("Enter the 6-digit code");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await authClient.twoFactor.verifyTotp({ code });
      if (err) throw new Error(err.message ?? "Verification failed");
      setStep("backup");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    onEnabled();
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalFill}
        behavior="padding"
      >
        <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            {step === "password" && (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  Enable two-factor authentication
                </Text>
                <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                  Enter your password to begin setup.
                </Text>
                <TextInput
                  style={[
                    styles.modalInput,
                    { backgroundColor: colors.background, borderColor: error ? colors.destructive : colors.input, color: colors.foreground },
                  ]}
                  placeholder="Password"
                  placeholderTextColor={colors.mutedForeground}
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  editable={!busy}
                />
                {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
                <View style={styles.modalActions}>
                  <Pressable onPress={onClose} style={[styles.modalBtn, { borderColor: colors.border, borderWidth: 1 }]}>
                    <Text style={[styles.modalBtnLabel, { color: colors.foreground }]}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={startEnrollment} disabled={busy} style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}>
                    {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[styles.modalBtnLabel, { color: colors.primaryForeground }]}>Continue</Text>}
                  </Pressable>
                </View>
              </>
            )}

            {step === "verify" && (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>
                  Scan with your authenticator
                </Text>
                <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                  Add this account to your authenticator app (Google Authenticator, Authy, 1Password, etc.) using this key:
                </Text>
                {secret ? (
                  <View style={[styles.secretBox, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                    <Text style={[styles.secretText, { color: colors.foreground }]} selectable>
                      {secret}
                    </Text>
                    <Text style={[styles.secretHint, { color: colors.mutedForeground }]}>Long-press to copy</Text>
                  </View>
                ) : null}
                <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                  Then enter the 6-digit code from your app:
                </Text>
                <TextInput
                  style={[
                    styles.modalInput,
                    styles.codeInput,
                    { backgroundColor: colors.background, borderColor: error ? colors.destructive : colors.input, color: colors.foreground },
                  ]}
                  placeholder="000000"
                  placeholderTextColor={colors.mutedForeground}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                  editable={!busy}
                />
                {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
                <View style={styles.modalActions}>
                  <Pressable onPress={onClose} style={[styles.modalBtn, { borderColor: colors.border, borderWidth: 1 }]}>
                    <Text style={[styles.modalBtnLabel, { color: colors.foreground }]}>Cancel</Text>
                  </Pressable>
                  <Pressable onPress={verify} disabled={busy} style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}>
                    {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[styles.modalBtnLabel, { color: colors.primaryForeground }]}>Verify</Text>}
                  </Pressable>
                </View>
              </>
            )}

            {step === "backup" && (
              <>
                <Text style={[styles.modalTitle, { color: colors.foreground }]}>Save your backup codes</Text>
                <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
                  Store these codes in a safe place. Each code can be used once if you lose access to your authenticator.
                </Text>
                <View style={[styles.backupCodesBox, { backgroundColor: colors.accent, borderColor: colors.border }]}>
                  {backupCodes.map((c, i) => (
                    <Text key={i} style={[styles.backupCode, { color: colors.foreground }]} selectable>
                      {c}
                    </Text>
                  ))}
                </View>
                <Pressable onPress={finish} style={[styles.modalBtn, { backgroundColor: colors.primary, alignSelf: "stretch" }]}>
                  <Text style={[styles.modalBtnLabel, { color: colors.primaryForeground }]}>Done</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// 2FA disable modal
// ---------------------------------------------------------------------------

function TwoFactorDisableModal({
  visible,
  colors,
  onClose,
  onDisabled,
}: {
  visible: boolean;
  colors: Colors;
  onClose: () => void;
  onDisabled: () => void;
}) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setPassword("");
      setError(null);
    }
  }, [visible]);

  async function disable() {
    if (!password.trim()) {
      setError("Password is required");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await authClient.twoFactor.disable({ password });
      if (err) throw new Error(err.message ?? "Failed to disable 2FA");
      onDisabled();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disable 2FA");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalFill}
        behavior="padding"
      >
        <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Disable 2FA</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              Enter your password to disable two-factor authentication.
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                { backgroundColor: colors.background, borderColor: error ? colors.destructive : colors.input, color: colors.foreground },
              ]}
              placeholder="Password"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              editable={!busy}
            />
            {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable onPress={onClose} style={[styles.modalBtn, { borderColor: colors.border, borderWidth: 1 }]}>
                <Text style={[styles.modalBtnLabel, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={disable} disabled={busy} style={[styles.modalBtn, { backgroundColor: colors.destructive, opacity: busy ? 0.7 : 1 }]}>
                {busy ? <ActivityIndicator size="small" color={colors.destructiveForeground} /> : <Text style={[styles.modalBtnLabel, { color: colors.destructiveForeground }]}>Disable</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Delete account modal
// ---------------------------------------------------------------------------

function DeleteAccountModal({
  visible,
  colors,
  onClose,
  onDeleted,
}: {
  visible: boolean;
  colors: Colors;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setConfirmation("");
      setError(null);
    }
  }, [visible]);

  async function deleteAccount() {
    if (confirmation !== "DELETE") return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/delete-account`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: API_URL,
          Cookie: authClient.getCookie() ?? "",
        },
        body: JSON.stringify({ confirmation }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? "Failed to delete account");
      }
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalFill}
        behavior="padding"
      >
        <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.destructive }]}>Delete account</Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              This will permanently delete your account and all data. This cannot be undone.
            </Text>
            <Text style={[styles.modalBody, { color: colors.mutedForeground }]}>
              Type <Text style={{ fontWeight: "700", color: colors.destructive }}>DELETE</Text> to confirm.
            </Text>
            <TextInput
              style={[
                styles.modalInput,
                { backgroundColor: colors.background, borderColor: error ? colors.destructive : colors.input, color: colors.foreground },
              ]}
              placeholder="Type DELETE"
              placeholderTextColor={colors.mutedForeground}
              autoCapitalize="characters"
              value={confirmation}
              onChangeText={setConfirmation}
              editable={!busy}
            />
            {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable onPress={onClose} style={[styles.modalBtn, { borderColor: colors.border, borderWidth: 1 }]}>
                <Text style={[styles.modalBtnLabel, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={deleteAccount}
                disabled={busy || confirmation !== "DELETE"}
                style={[styles.modalBtn, { backgroundColor: colors.destructive, opacity: busy || confirmation !== "DELETE" ? 0.5 : 1 }]}
              >
                {busy ? <ActivityIndicator size="small" color={colors.destructiveForeground} /> : <Text style={[styles.modalBtnLabel, { color: colors.destructiveForeground }]}>Delete account</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Edit name modal
// ---------------------------------------------------------------------------

function EditNameModal({
  visible,
  currentName,
  colors,
  onClose,
  onSaved,
}: {
  visible: boolean;
  currentName: string;
  colors: Colors;
  onClose: () => void;
  onSaved: (name: string) => void;
}) {
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) {
      setName(currentName);
      setError(null);
    }
  }, [visible, currentName]);

  async function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Name is required");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const { error: err } = await authClient.updateUser({ name: trimmed });
      if (err) throw new Error(err.message ?? "Failed to update name");
      onSaved(trimmed);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update name");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalFill}
        behavior="padding"
      >
        <Pressable style={styles.modalOverlay} onPress={Keyboard.dismiss}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Text style={[styles.modalTitle, { color: colors.foreground }]}>Edit name</Text>
            <TextInput
              style={[
                styles.modalInput,
                { backgroundColor: colors.background, borderColor: error ? colors.destructive : colors.input, color: colors.foreground },
              ]}
              placeholder="Your name"
              placeholderTextColor={colors.mutedForeground}
              autoFocus
              value={name}
              onChangeText={setName}
              editable={!busy}
            />
            {error ? <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text> : null}
            <View style={styles.modalActions}>
              <Pressable onPress={onClose} style={[styles.modalBtn, { borderColor: colors.border, borderWidth: 1 }]}>
                <Text style={[styles.modalBtnLabel, { color: colors.foreground }]}>Cancel</Text>
              </Pressable>
              <Pressable onPress={save} disabled={busy} style={[styles.modalBtn, { backgroundColor: colors.primary, opacity: busy ? 0.7 : 1 }]}>
                {busy ? <ActivityIndicator size="small" color={colors.primaryForeground} /> : <Text style={[styles.modalBtnLabel, { color: colors.primaryForeground }]}>Save</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Main settings screen
// ---------------------------------------------------------------------------

/**
 * Settings screen — the native mirror of the web app's `/app/settings` page.
 * Sections: Profile (name / email / verification), Appearance (theme), Security
 * (2FA), Billing (read-only — checkout & portal open in the system browser),
 * Account (data export + delete), Legal, and Sign out.
 *
 * This restores the AppSeed/Coomander template settings screen. The chat screen
 * header's gear icon navigates here; sign-out now lives here (not on chat).
 */
export default function SettingsScreen() {
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const { colors, theme, setTheme } = useTheme();

  const [name, setName] = useState(session?.user.name ?? "");
  const [editNameVisible, setEditNameVisible] = useState(false);

  const emailVerified = session?.user.emailVerified ?? false;
  const [sendingVerify, setSendingVerify] = useState(false);
  const [verifyMsg, setVerifyMsg] = useState<string | null>(null);

  const [plan, setPlan] = useState<string>("free");
  const [billingLoading, setBillingLoading] = useState(true);

  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [enableModalVisible, setEnableModalVisible] = useState(false);
  const [disableModalVisible, setDisableModalVisible] = useState(false);

  const [deleteVisible, setDeleteVisible] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);

  useEffect(() => {
    if (session?.user.name) setName(session.user.name);
  }, [session?.user.name]);

  const loadData = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/stripe/status`, {
        headers: { Origin: API_URL, Cookie: authClient.getCookie() ?? "" },
      });
      if (res.ok) {
        const data = await res.json();
        setPlan(data.plan ?? "free");
      }
    } catch {
      // Billing status unavailable — show free.
    }

    try {
      const { data: sess } = await authClient.getSession();
      if (sess?.user) {
        setMfaEnabled(!!(sess.user as Record<string, unknown>).twoFactorEnabled);
      }
    } catch {
      // 2FA status unavailable.
    }

    setBillingLoading(false);
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function signOut() {
    try {
      await authClient.signOut();
    } finally {
      router.replace("/sign-in");
    }
  }

  async function openBillingPortal() {
    try {
      const res = await fetch(`${API_URL}/api/stripe/portal`, {
        headers: { Origin: API_URL, Cookie: authClient.getCookie() ?? "" },
      });
      if (res.ok) {
        const data = await res.json();
        if (data.url) await WebBrowser.openBrowserAsync(data.url);
      }
    } catch {
      Alert.alert("Error", "Could not open billing portal.");
    }
  }

  async function openCheckout() {
    try {
      const res = await fetch(`${API_URL}/api/stripe/create-checkout`, {
        method: "POST",
        headers: { "content-type": "application/json", Origin: API_URL, Cookie: authClient.getCookie() ?? "" },
        body: JSON.stringify({ type: "subscription" }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.url) {
        await WebBrowser.openBrowserAsync(data.url);
      } else {
        Alert.alert("Error", "Could not start checkout.");
      }
    } catch {
      Alert.alert("Error", "Could not start checkout.");
    }
  }

  async function requestDataExport() {
    setExportLoading(true);
    try {
      const res = await fetch(`${API_URL}/api/settings/export`, {
        headers: { Origin: API_URL, Cookie: authClient.getCookie() ?? "" },
      });
      if (!res.ok) throw new Error("Export failed");
      Alert.alert("Data export", "Your data export is ready. Use the web app to download the file.");
    } catch {
      Alert.alert("Error", "Failed to request data export.");
    } finally {
      setExportLoading(false);
    }
  }

  async function handleAccountDeleted() {
    await authClient.signOut();
    router.replace("/sign-in");
  }

  async function sendVerification() {
    if (!session) return;
    setSendingVerify(true);
    setVerifyMsg(null);
    const { ok } = await resendVerificationEmail(session.user.email);
    setVerifyMsg(
      ok ? "Verification email sent. Check your inbox." : "Couldn't send the email. Please try again.",
    );
    setSendingVerify(false);
  }

  const isPro = plan === "pro";

  return (
    <Screen edges={["top", "left", "right"]}>
      <SettingsHeader colors={colors} />
      <ScrollView contentContainerStyle={styles.content}>
        {/* ── Profile ────────────────────────────────────────── */}
        <Section label="Profile" colors={colors}>
          <SettingRow
            label="Name"
            value={name || "Not set"}
            icon="user"
            colors={colors}
            onPress={() => setEditNameVisible(true)}
          />
          <Divider colors={colors} />
          <SettingRow label="Email" value={session?.user.email ?? ""} icon="mail" colors={colors} />
          <Divider colors={colors} />
          <SettingRow
            label="Email verification"
            value={verifyMsg ?? (emailVerified ? undefined : "Not verified yet")}
            icon="shield"
            colors={colors}
            trailing={
              emailVerified ? (
                <View style={styles.verifiedBadge}>
                  <Feather name="check-circle" size={15} color={colors.primary} />
                  <Text style={[styles.verifiedText, { color: colors.primary }]}>Verified</Text>
                </View>
              ) : (
                <Pressable
                  onPress={sendVerification}
                  disabled={sendingVerify}
                  accessibilityRole="button"
                  accessibilityLabel="Send verification email"
                  style={[styles.verifyButton, { backgroundColor: colors.primary, opacity: sendingVerify ? 0.7 : 1 }]}
                >
                  {sendingVerify ? (
                    <ActivityIndicator size="small" color={colors.primaryForeground} />
                  ) : (
                    <Text style={[styles.verifyButtonText, { color: colors.primaryForeground }]}>Send email</Text>
                  )}
                </Pressable>
              )
            }
          />
        </Section>

        {/* ── Appearance ─────────────────────────────────────── */}
        <Section label="Appearance" colors={colors}>
          <Text style={[styles.rowLabel, { color: colors.foreground, marginBottom: 8 }]}>Theme</Text>
          <ThemePicker theme={theme} setTheme={setTheme} colors={colors} />
        </Section>

        {/* ── Security ───────────────────────────────────────── */}
        <Section label="Security" colors={colors}>
          <SettingRow
            label="Two-factor authentication"
            value={mfaEnabled ? "Enabled" : "Disabled"}
            icon="shield"
            colors={colors}
            onPress={() => (mfaEnabled ? setDisableModalVisible(true) : setEnableModalVisible(true))}
            trailing={
              <View style={[styles.badge, { backgroundColor: mfaEnabled ? colors.primary + "20" : colors.destructive + "20" }]}>
                <Text style={[styles.badgeText, { color: mfaEnabled ? colors.primary : colors.destructive }]}>
                  {mfaEnabled ? "On" : "Off"}
                </Text>
              </View>
            }
          />
        </Section>

        {/* ── Billing ────────────────────────────────────────── */}
        <Section label="Billing" colors={colors}>
          {billingLoading ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 8 }} />
          ) : (
            <>
              <SettingRow
                label="Plan"
                icon="credit-card"
                colors={colors}
                trailing={
                  <View style={[styles.badge, { backgroundColor: isPro ? colors.primary + "20" : colors.accent }]}>
                    <Text style={[styles.badgeText, { color: isPro ? colors.primary : colors.mutedForeground }]}>
                      {isPro ? "Pro" : "Free"}
                    </Text>
                  </View>
                }
              />
              {plan === "free" ? (
                <>
                  <Divider colors={colors} />
                  <SettingRow label="Upgrade to Pro" icon="zap" colors={colors} onPress={openCheckout} />
                </>
              ) : null}
              <Divider colors={colors} />
              <SettingRow label="Manage billing on the web" icon="external-link" colors={colors} onPress={openBillingPortal} />
            </>
          )}
        </Section>

        {/* ── Account ────────────────────────────────────────── */}
        <Section label="Account" colors={colors}>
          <SettingRow
            label="Export my data"
            icon="download"
            colors={colors}
            onPress={requestDataExport}
            trailing={
              exportLoading ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
              )
            }
          />
          <Divider colors={colors} />
          <SettingRow label="Delete account" icon="trash-2" colors={colors} destructive onPress={() => setDeleteVisible(true)} />
        </Section>

        {/* ── Legal ──────────────────────────────────────────── */}
        <Section label="Legal" colors={colors}>
          <SettingRow
            icon="file-text"
            label="Privacy Policy"
            colors={colors}
            onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/privacy-policy`)}
          />
          <Divider colors={colors} />
          <SettingRow
            icon="book-open"
            label="Terms of Service"
            colors={colors}
            onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/terms`)}
          />
        </Section>

        {/* ── Sign out ───────────────────────────────────────── */}
        <Pressable onPress={signOut} accessibilityRole="button" style={[styles.signOut, { borderColor: colors.border }]}>
          <Feather name="log-out" size={18} color={colors.destructive} />
          <Text style={[styles.signOutLabel, { color: colors.destructive }]}>Sign out</Text>
        </Pressable>

        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Modals */}
      <EditNameModal
        visible={editNameVisible}
        currentName={name}
        colors={colors}
        onClose={() => setEditNameVisible(false)}
        onSaved={setName}
      />
      <TwoFactorEnableModal
        visible={enableModalVisible}
        colors={colors}
        onClose={() => setEnableModalVisible(false)}
        onEnabled={() => setMfaEnabled(true)}
      />
      <TwoFactorDisableModal
        visible={disableModalVisible}
        colors={colors}
        onClose={() => setDisableModalVisible(false)}
        onDisabled={() => setMfaEnabled(false)}
      />
      <DeleteAccountModal
        visible={deleteVisible}
        colors={colors}
        onClose={() => setDeleteVisible(false)}
        onDeleted={handleAccountDeleted}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerBack: { flexDirection: "row", alignItems: "center", gap: 2 },
  headerTitle: { fontSize: 17, fontWeight: "700" },

  content: { padding: 16, gap: 24 },
  section: { gap: 8 },
  sectionLabel: { fontSize: 12, textTransform: "uppercase", letterSpacing: 0.5, paddingLeft: 4 },
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 16, padding: 16 },

  // Rows
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 4 },
  rowLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  rowIcon: { marginRight: 12 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: "500" },
  rowValue: { fontSize: 13, marginTop: 2 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 12 },

  // Theme picker
  themePicker: { flexDirection: "row", gap: 8 },
  themeOption: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
  },
  themeLabel: { fontSize: 13, fontWeight: "500" },

  // Badge
  badge: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: "600" },
  verifyButton: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 },
  verifyButtonText: { fontSize: 12, fontWeight: "600" },
  verifiedBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  verifiedText: { fontSize: 13, fontWeight: "600" },

  // Sign out
  signOut: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
  },
  signOutLabel: { fontSize: 16, fontWeight: "600" },

  // Modals
  modalFill: { flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.4)", alignItems: "center", justifyContent: "center", padding: 32 },
  modalCard: { width: "100%", borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 24, gap: 12 },
  modalTitle: { fontSize: 18, fontWeight: "700" },
  modalBody: { fontSize: 14, lineHeight: 20 },
  modalInput: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, fontSize: 16 },
  codeInput: { fontSize: 24, textAlign: "center", letterSpacing: 8, fontVariant: ["tabular-nums"] },
  errorText: { fontSize: 13 },
  modalActions: { flexDirection: "row", gap: 12, marginTop: 4 },
  modalBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: "center", justifyContent: "center" },
  modalBtnLabel: { fontSize: 15, fontWeight: "600" },

  // Secret / backup codes
  secretBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, alignItems: "center", gap: 4 },
  secretText: { fontSize: 14, fontWeight: "600", fontFamily: "monospace", letterSpacing: 1 },
  secretHint: { fontSize: 11 },
  backupCodesBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, padding: 12, flexDirection: "row", flexWrap: "wrap", gap: 8 },
  backupCode: { fontSize: 13, fontFamily: "monospace", width: "45%" },
});
