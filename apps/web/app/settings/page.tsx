"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import {
  Sprout,
  ChevronLeft,
  Shield,
  Download,
  AlertTriangle,
  User,
  CreditCard,
  Trash2,
  Loader2,
  Star,
  ExternalLink,
  Mail,
  Calendar,
  CheckCircle2,
  XCircle,
  Palette,
  Bell,
  Webhook,
  Plus,
  X,
  TestTube2,
  Upload,
  LogOut,
} from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AiModelPreference } from "@/components/settings/ai-model-preference";
import { toast } from "@/lib/use-toast";

// ─── Provider label helper ──────────────────────────────────────────────────
function providerLabel(provider: string) {
  switch (provider) {
    case "google":
      return "Google";
    case "github":
      return "GitHub";
    default:
      return "Email";
  }
}

// ─── Delete Account Modal ───────────────────────────────────────────────────
function DeleteModalContent({
  onDismiss,
  onConfirm,
  loading,
}: {
  onDismiss: () => void;
  onConfirm: (value: string) => void;
  loading: boolean;
}) {
  const [value, setValue] = useState("");

  return (
    <>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
        This will permanently delete your account and all associated data. This action cannot be
        undone.
      </p>
      <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
        Type <span className="font-mono font-semibold text-red-600 dark:text-red-400">DELETE</span> to confirm.
      </p>

      <Input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Type DELETE"
        className="mb-4"
      />

      <div className="flex gap-3">
        <Button variant="secondary" onClick={onDismiss} className="flex-1">
          Cancel
        </Button>
        <Button
          variant="danger"
          onClick={() => onConfirm(value)}
          loading={loading}
          disabled={value !== "DELETE"}
          className="flex-1"
        >
          Delete Account
        </Button>
      </div>
    </>
  );
}

// ─── Main Settings Page ─────────────────────────────────────────────────────
export default function SettingsPage() {
  const router = useRouter();

  // Account
  const [accountLoading, setAccountLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [provider, setProvider] = useState("credential");
  const [emailVerified, setEmailVerified] = useState(false);
  const [createdAt, setCreatedAt] = useState("");

  // Plan
  const [plan, setPlan] = useState("free");

  // MFA
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [disablePassword, setDisablePassword] = useState("");
  const [enrollmentStep, setEnrollmentStep] = useState<"idle" | "qr" | "verify">("idle");
  const [mfaLoading, setMfaLoading] = useState(false);

  // Data & privacy
  const [exportLoading, setExportLoading] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);

  // Subscription portal
  const [portalLoading, setPortalLoading] = useState(false);

  // Notifications preferences
  const [notifEnabled, setNotifEnabled] = useState(true);

  // Webhooks
  const [webhooks, setWebhooks] = useState<Array<{ id: string; url: string; events: string; active: number; createdAt: number }>>([]);
  const [newWebhookUrl, setNewWebhookUrl] = useState("");
  const [newWebhookEvents, setNewWebhookEvents] = useState("");
  const [webhookLoading, setWebhookLoading] = useState(false);
  const [showDeliveries, setShowDeliveries] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Array<{ id: string; event: string; responseStatus: number | null; success: number; createdAt: number }>>([]);

  // Avatar
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  const isPro = plan === "pro";
  const isLifetime = plan === "lifetime";
  const hasPaidPlan = isPro || isLifetime;

  // ─── Data loading ───────────────────────────────────────────────────────
  const loadAccount = useCallback(async () => {
    try {
      const res = await fetch("/api/settings/account");
      if (res.ok) {
        const data = await res.json();
        setEmail(data.email);
        setProvider(data.provider);
        setEmailVerified(data.emailVerified);
        setCreatedAt(data.createdAt);
        if (data.image) setAvatarUrl(data.image);
      }
    } catch {
      // silent
    }
  }, []);

  const loadPlan = useCallback(async () => {
    try {
      const res = await fetch("/api/stripe/status");
      if (res.ok) {
        const data = await res.json();
        setPlan(data.plan ?? "free");
      }
    } catch {
      // silent
    }
  }, []);

  const loadMFA = useCallback(async () => {
    try {
      const { data: session } = await authClient.getSession();
      if (session?.user) {
        setMfaEnabled(!!session.user.twoFactorEnabled);
      }
    } catch {
      // silent
    }
  }, []);

  const loadWebhooks = useCallback(async () => {
    try {
      const res = await fetch("/api/webhooks");
      if (res.ok) {
        const data = await res.json();
        setWebhooks(data.webhooks || []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    async function init() {
      await Promise.all([loadAccount(), loadPlan(), loadMFA(), loadWebhooks()]);
      setAccountLoading(false);
    }
    init();
  }, [loadAccount, loadPlan, loadMFA, loadWebhooks]);

  // ─── MFA handlers ──────────────────────────────────────────────────────
  const startEnrollment = async () => {
    if (!password) {
      toast.error("Please enter your password");
      return;
    }
    setMfaLoading(true);

    try {
      const { data, error: enableError } = await authClient.twoFactor.enable({ password });
      if (enableError) throw new Error(enableError.message || "Failed to start enrollment");

      if (data?.totpURI) {
        const qrDataUrl = await QRCode.toDataURL(data.totpURI);
        setQrCodeDataUrl(qrDataUrl);
        const uriMatch = data.totpURI.match(/secret=([^&]+)/);
        setSecret(uriMatch ? uriMatch[1] : null);
      }
      if (data?.backupCodes) setBackupCodes(data.backupCodes);
      setEnrollmentStep("qr");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to start enrollment");
    } finally {
      setMfaLoading(false);
    }
  };

  const verifyEnrollment = async () => {
    if (!verificationCode) {
      toast.error("Please enter a verification code");
      return;
    }
    setMfaLoading(true);

    try {
      const { error: verifyError } = await authClient.twoFactor.verifyTotp({
        code: verificationCode,
      });
      if (verifyError) throw new Error(verifyError.message || "Verification failed");

      toast.success("MFA enabled successfully!");
      setMfaEnabled(true);
      setEnrollmentStep("idle");
      setVerificationCode("");
      setPassword("");
      setQrCodeDataUrl(null);
      setSecret(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setMfaLoading(false);
    }
  };

  const disableMFA = async () => {
    if (!disablePassword) {
      toast.error("Please enter your password");
      return;
    }
    setMfaLoading(true);

    try {
      const { error: disableError } = await authClient.twoFactor.disable({
        password: disablePassword,
      });
      if (disableError) throw new Error(disableError.message || "Failed to disable MFA");

      toast.success("MFA disabled successfully");
      setMfaEnabled(false);
      setDisablePassword("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to disable MFA");
    } finally {
      setMfaLoading(false);
    }
  };

  const downloadBackupCodes = () => {
    const appName = process.env.NEXT_PUBLIC_APP_NAME || "Coomander";
    const text = backupCodes.join("\n");
    const blob = new Blob(
      [`${appName} Backup Codes\n\n${text}\n\nSave these codes in a safe place!`],
      { type: "text/plain" }
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${appName.toLowerCase()}-backup-codes.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Webhook handlers ──────────────────────────────────────────────────
  const handleCreateWebhook = async () => {
    if (!newWebhookUrl.trim()) return;
    setWebhookLoading(true);
    try {
      const events = newWebhookEvents.split(",").map((e) => e.trim()).filter(Boolean);
      const res = await fetch("/api/webhooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: newWebhookUrl.trim(), events }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create webhook");
      }
      setNewWebhookUrl("");
      setNewWebhookEvents("");
      toast.success("Webhook created");
      loadWebhooks();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to create webhook");
    } finally {
      setWebhookLoading(false);
    }
  };

  const handleDeleteWebhook = async (id: string) => {
    try {
      await fetch(`/api/webhooks/${id}`, { method: "DELETE" });
      loadWebhooks();
      toast.success("Webhook deleted");
    } catch {
      toast.error("Failed to delete webhook");
    }
  };

  const handleTestWebhook = async (id: string) => {
    try {
      const res = await fetch(`/api/webhooks/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.delivery?.success) {
        toast.success("Test webhook delivered successfully");
      } else {
        toast.error(data.error || "Test webhook failed");
      }
    } catch {
      toast.error("Test webhook failed");
    }
  };

  const handleViewDeliveries = async (webhookId: string) => {
    if (showDeliveries === webhookId) {
      setShowDeliveries(null);
      return;
    }
    try {
      const res = await fetch(`/api/webhooks/${webhookId}/deliveries`);
      if (res.ok) {
        const data = await res.json();
        setDeliveries(data.deliveries || []);
        setShowDeliveries(webhookId);
      }
    } catch {
      toast.error("Failed to load deliveries");
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const uploadRes = await fetch("/api/files", { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      const uploadData = await uploadRes.json();
      const imageUrl = uploadData.url;

      // Save the avatar URL to the user profile
      const updateRes = await fetch("/api/settings/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageUrl }),
      });
      if (!updateRes.ok) throw new Error("Failed to save avatar");

      setAvatarUrl(imageUrl);
      toast.success("Avatar updated");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setAvatarUploading(false);
    }
  };

  // ─── Data & privacy handlers ────────────────────────────────────────────
  const handleExport = async () => {
    setExportLoading(true);
    try {
      const res = await fetch("/api/settings/export");
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `coomander-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Data exported successfully");
    } catch {
      toast.error("Failed to export data");
    } finally {
      setExportLoading(false);
    }
  };

  const handleDeleteAccount = async (confirmation: string) => {
    setDeleteLoading(true);
    try {
      const res = await fetch("/api/settings/delete-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete account");
      }
      router.push("/auth");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to delete account");
      setDeleteLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal");
      if (res.ok) {
        const data = await res.json();
        if (data.url) window.location.href = data.url;
      } else {
        toast.error("Could not open subscription portal");
      }
    } catch {
      toast.error("Could not open subscription portal");
    } finally {
      setPortalLoading(false);
    }
  };

  const handleUpgrade = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/create-checkout", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.url) window.location.href = data.url;
      }
    } catch {
      toast.error("Could not start checkout");
    } finally {
      setPortalLoading(false);
    }
  };

  // ─── Loading state ─────────────────────────────────────────────────────
  if (accountLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Skeleton circle width="w-8" height="h-8" />
      </div>
    );
  }

  // ─── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Delete Account Modal */}
      <Modal
        open={showDeleteModal}
        onClose={() => setShowDeleteModal(false)}
        title="Delete Account"
        titleIcon={<Trash2 className="w-5 h-5 text-red-600 dark:text-red-400" />}
      >
        <DeleteModalContent
          onDismiss={() => setShowDeleteModal(false)}
          onConfirm={handleDeleteAccount}
          loading={deleteLoading}
        />
      </Modal>

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => router.push("/app")}
            className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            <Sprout className="w-5 h-5 text-primary" />
            <span className="font-bold text-gray-900 dark:text-gray-100">Coomander</span>
          </button>
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Settings</h1>
            <button
              type="button"
              onClick={async () => {
                await authClient.signOut();
                router.push("/auth?tab=login");
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
              aria-label="Sign out"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">

        {/* ── Account ───────────────────────────────────────────────────── */}
        <Card icon={<User className="w-4 h-4 text-primary" />} title="Account">
          {/* Avatar upload */}
          <div className="flex items-center gap-4 mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            {avatarUrl ? (
              <img src={avatarUrl} alt="Avatar" className="w-12 h-12 rounded-full object-cover" />
            ) : (
              <div className="w-12 h-12 bg-accent rounded-full flex items-center justify-center text-primary font-bold text-lg">
                {email ? email[0].toUpperCase() : "?"}
              </div>
            )}
            <div className="flex-1">
              <p className="text-sm font-medium text-gray-900 dark:text-gray-100">Profile Photo</p>
              <p className="text-xs text-gray-500 dark:text-gray-400">Upload an avatar image</p>
            </div>
            <label className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors cursor-pointer">
              {avatarUploading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              Upload
              <input type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
            </label>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3">
              <Mail className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5" />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Email</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{email}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Shield className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5" />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Auth Provider</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{providerLabel(provider)}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Calendar className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5" />
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Member Since</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {createdAt
                    ? new Date(createdAt).toLocaleDateString("en-US", {
                        month: "long",
                        day: "numeric",
                        year: "numeric",
                      })
                    : "-"}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              {emailVerified ? (
                <CheckCircle2 className="w-4 h-4 text-primary mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5" />
              )}
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400">Email Verification</p>
                <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {emailVerified ? "Verified" : "Not verified"}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* ── Appearance ──────────────────────────────────────────────── */}
        <Card icon={<Palette className="w-4 h-4 text-primary" />} title="Appearance">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Theme</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Choose between light, dark, or system preference.
              </p>
            </div>
            <ThemeToggle />
          </div>
        </Card>

        {/* ── AI Chat Model ─────────────────────────────────────────────── */}
        <AiModelPreference />

        {/* ── Subscription & Billing ────────────────────────────────────── */}
        <Card icon={<CreditCard className="w-4 h-4 text-primary" />} title="Subscription &amp; Billing">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 dark:text-gray-400">Current plan</span>
              {isLifetime ? (
                <Badge variant="pro" icon={<Star className="w-3 h-3" />}>Lifetime</Badge>
              ) : isPro ? (
                <Badge variant="pro" icon={<Star className="w-3 h-3" />}>Pro</Badge>
              ) : (
                <Badge variant="default">Free</Badge>
              )}
            </div>

            {isLifetime ? (
              <span className="text-sm text-gray-500 dark:text-gray-400">Lifetime access — no billing</span>
            ) : isPro ? (
              <Button
                variant="primary"
                loading={portalLoading}
                icon={<ExternalLink className="w-4 h-4" />}
                onClick={handleManageSubscription}
              >
                Manage Subscription
              </Button>
            ) : (
              <Button
                variant="primary"
                loading={portalLoading}
                icon={<Star className="w-4 h-4" />}
                onClick={handleUpgrade}
              >
                Upgrade to Pro
              </Button>
            )}
          </div>
        </Card>

        {/* ── Security (MFA) ────────────────────────────────────────────── */}
        <Card icon={<Shield className="w-4 h-4 text-primary" />} title="Security">
          {/* MFA idle state */}
          {enrollmentStep === "idle" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div>
                  <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    Two-Factor Authentication
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {mfaEnabled
                      ? "Your account is protected with authenticator app codes."
                      : "Add an extra layer of security with TOTP codes."}
                  </p>
                </div>
                {mfaEnabled ? (
                  <Badge variant="success">Enabled</Badge>
                ) : (
                  <Badge variant="default">Disabled</Badge>
                )}
              </div>

              {!mfaEnabled ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Enter your password to enable MFA:</p>
                  <Input
                    type="password"
                    placeholder="Your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <Button
                    variant="primary"
                    loading={mfaLoading}
                    disabled={!password}
                    onClick={startEnrollment}
                    className="w-full"
                  >
                    Enable MFA
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600 dark:text-gray-400">Enter your password to disable MFA:</p>
                  <Input
                    type="password"
                    placeholder="Your password"
                    value={disablePassword}
                    onChange={(e) => setDisablePassword(e.target.value)}
                  />
                  <Button
                    variant="danger"
                    loading={mfaLoading}
                    disabled={!disablePassword}
                    onClick={disableMFA}
                    className="w-full"
                  >
                    Disable MFA
                  </Button>
                </div>
              )}
            </div>
          )}

          {/* MFA enrollment: QR */}
          {enrollmentStep === "qr" && qrCodeDataUrl && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Scan QR Code</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Use an authenticator app (Google Authenticator, Authy, 1Password, etc.) to scan this
                code:
              </p>
              <div className="flex justify-center">
                <img src={qrCodeDataUrl} alt="MFA QR Code" className="w-48 h-48" />
              </div>
              {secret && (
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                  Or enter manually:{" "}
                  <code className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded text-xs">{secret}</code>
                </p>
              )}

              {backupCodes.length > 0 && (
                <Alert variant="warning">
                  <h4 className="text-sm font-semibold mb-1 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4" />
                    Save Your Backup Codes
                  </h4>
                  <p className="text-xs mb-3">
                    These codes can be used if you lose access to your authenticator app.
                  </p>
                  <div className="bg-white dark:bg-gray-800 p-3 rounded border border-amber-200 dark:border-amber-800 mb-3 font-mono text-xs">
                    {backupCodes.map((code, i) => (
                      <div key={i}>{code}</div>
                    ))}
                  </div>
                  <button
                    onClick={downloadBackupCodes}
                    className="flex items-center gap-2 text-xs font-medium hover:opacity-80"
                  >
                    <Download className="w-3 h-3" />
                    Download Codes
                  </button>
                </Alert>
              )}

              <Button variant="primary" onClick={() => setEnrollmentStep("verify")} className="w-full">
                Continue to Verification
              </Button>
            </div>
          )}

          {/* MFA enrollment: verify */}
          {enrollmentStep === "verify" && (
            <div className="space-y-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Verify Setup</h3>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Enter the 6-digit code from your authenticator app:
              </p>
              <input
                type="text"
                placeholder="000000"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-lg px-3 py-2 text-center text-2xl tracking-widest font-mono focus:ring-2 focus:ring-ring focus:border-transparent text-gray-900 dark:text-gray-100"
                maxLength={6}
                autoFocus
              />
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setEnrollmentStep("qr")} className="flex-1">
                  Back
                </Button>
                <Button
                  variant="primary"
                  loading={mfaLoading}
                  disabled={verificationCode.length !== 6}
                  onClick={verifyEnrollment}
                  className="flex-1"
                >
                  Verify &amp; Enable
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* ── Notifications ─────────────────────────────────────────────── */}
        <Card icon={<Bell className="w-4 h-4 text-primary" />} title="Notifications">
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <div>
              <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">In-App Notifications</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Receive notifications about account activity and updates.
              </p>
            </div>
            <button
              onClick={() => setNotifEnabled(!notifEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                notifEnabled ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  notifEnabled ? "translate-x-6" : "translate-x-1"
                }`}
              />
            </button>
          </div>
        </Card>

        {/* ── Webhooks ────────────────────────────────────────────────────── */}
        <Card icon={<Webhook className="w-4 h-4 text-primary" />} title="Webhooks">
          <div className="space-y-4">
            {/* Create webhook */}
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  type="url"
                  placeholder="https://your-server.com/webhook"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  className="flex-1"
                />
                <Button
                  variant="primary"
                  size="sm"
                  loading={webhookLoading}
                  disabled={!newWebhookUrl.trim()}
                  icon={<Plus className="w-4 h-4" />}
                  onClick={handleCreateWebhook}
                >
                  Add
                </Button>
              </div>
              <Input
                type="text"
                placeholder="Events (comma-separated, e.g. item.created,item.deleted or * for all)"
                value={newWebhookEvents}
                onChange={(e) => setNewWebhookEvents(e.target.value)}
              />
            </div>

            {/* Webhook list */}
            {webhooks.length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-2">
                No webhooks configured.
              </p>
            ) : (
              webhooks.map((wh) => (
                <div key={wh.id} className="space-y-2">
                  <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{wh.url}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Events: {(() => { try { const e = JSON.parse(wh.events); return e.length === 0 ? "all" : e.join(", "); } catch { return "all"; } })()}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={() => handleTestWebhook(wh.id)}
                        className="p-1.5 text-gray-400 hover:text-primary/80 transition-colors"
                        title="Send test"
                      >
                        <TestTube2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleViewDeliveries(wh.id)}
                        className="p-1.5 text-gray-400 hover:text-blue-500 transition-colors"
                        title="View deliveries"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteWebhook(wh.id)}
                        className="p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Delivery log */}
                  {showDeliveries === wh.id && (
                    <div className="ml-4 space-y-1">
                      {deliveries.length === 0 ? (
                        <p className="text-xs text-gray-500 dark:text-gray-400 py-2">No deliveries yet.</p>
                      ) : (
                        deliveries.map((d) => (
                          <div key={d.id} className="flex items-center gap-2 text-xs p-2 bg-gray-50 dark:bg-gray-700/30 rounded">
                            <span className={d.success ? "text-green-500" : "text-red-500"}>
                              {d.success ? "OK" : "FAIL"}
                            </span>
                            <span className="text-gray-500">{d.event}</span>
                            <span className="text-gray-400">{d.responseStatus || "-"}</span>
                            <span className="text-gray-400 ml-auto">
                              {new Date(d.createdAt * 1000).toLocaleString()}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </Card>

        {/* ── Data & Privacy ────────────────────────────────────────────── */}
        <Card icon={<Download className="w-4 h-4 text-primary" />} title="Data &amp; Privacy">
          <div className="space-y-4">
            {/* Export */}
            <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div>
                <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">Export Your Data</h3>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Download a JSON file with your account info and items.
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                loading={exportLoading}
                icon={<Download className="w-4 h-4" />}
                onClick={handleExport}
              >
                Export
              </Button>
            </div>

            {/* Delete */}
            <div className="flex items-center justify-between p-3 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-100 dark:border-red-900/50">
              <div>
                <h3 className="text-sm font-medium text-red-900 dark:text-red-300">Delete Account</h3>
                <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                  Permanently remove your account and all data.
                </p>
              </div>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 className="w-4 h-4" />}
                onClick={() => setShowDeleteModal(true)}
              >
                Delete
              </Button>
            </div>
          </div>
        </Card>

        {/* Bottom padding */}
        <div className="pb-8" />
      </main>
    </div>
  );
}
