"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import { Sprout, LogOut, Star, ExternalLink, Lock, Settings, Sun, Moon, Monitor, MessageSquare, Sparkles, ArrowRight } from "lucide-react";
import { NotificationBell } from "@/components/notification-bell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { toast } from "@/lib/use-toast";
import { commandRegistry } from "@/lib/commands";
import { Onboarding } from "@/components/onboarding";

// ─── Insights Card ────────────────────────────────────────────────────────────
function InsightsCard({ state }: { state: InsightsState }) {
  if (state.kind === "loading") {
    return (
      <Card title="Insights" headerAction={<Sparkles className="w-4 h-4 text-primary" />}>
        <Skeleton className="h-12 w-full" />
      </Card>
    );
  }

  if (state.kind === "no-connection") {
    return (
      <Card title="Insights" headerAction={<Sparkles className="w-4 h-4 text-primary" />}>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          MaddieHQ analyzes your Instagram posts with Claude vision and Whisper, then
          surfaces the non-obvious patterns driving your engagement — visual style,
          hook type, on-camera energy, and audience demographics, all cross-referenced
          against your reach and saves.
        </p>
        <Link
          href="/app/insights"
          className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Connect Instagram
          <ArrowRight className="w-4 h-4" />
        </Link>
      </Card>
    );
  }

  if (state.kind === "connected-no-report") {
    return (
      <Card title="Insights" headerAction={<Sparkles className="w-4 h-4 text-primary" />}>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
          Instagram is connected
          {state.postCount != null ? ` (${state.postCount} posts` : ""}
          {state.followerCount != null ? `, ${formatCount(state.followerCount)} followers)` : state.postCount != null ? ")" : ""}.
        </p>
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          You haven&apos;t run an analysis yet. Head to insights to generate your first
          report — patterns, recommendations, and per-post breakdowns.
        </p>
        <Link
          href="/app/insights"
          className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
        >
          Open insights
          <ArrowRight className="w-4 h-4" />
        </Link>
      </Card>
    );
  }

  return (
    <Card title="Insights" headerAction={<Sparkles className="w-4 h-4 text-primary" />}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <SummaryStat label="Followers" value={formatCount(state.followerCount)} />
        <SummaryStat label="Posts synced" value={formatCount(state.postCount)} />
        <SummaryStat label="Posts analyzed" value={String(state.postsAnalyzed)} />
        <SummaryStat label="Last run" value={formatRelative(state.generatedAt)} />
      </div>
      {state.topPattern ? (
        <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
          <span className="text-gray-500 dark:text-gray-400">Top pattern:</span>{" "}
          <span className="font-medium text-gray-900 dark:text-gray-100">
            {state.topPattern}
          </span>
        </p>
      ) : null}
      <Link
        href="/app/insights"
        className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        Open insights
        <ArrowRight className="w-4 h-4" />
      </Link>
    </Card>
  );
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50 px-3 py-2">
      <div className="text-xs uppercase tracking-wider text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

function formatCount(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "—";
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  return `${days}d ago`;
}

// ─── Coomander Card ───────────────────────────────────────────────────────────
function CoomanderCard() {
  return (
    <Card title="Coomander" headerAction={<MessageSquare className="w-4 h-4 text-primary" />}>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
        Your AI operations manager. Coomander keeps you on cadence across reels, wall
        content, lives, and PPV, and pings you on Telegram to stay on track. Reply in
        plain language and it logs what you shipped, flags blockers, and tracks
        procurement for you.
      </p>
      <Link
        href="/app/coomander"
        className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        Open Coomander
        <ArrowRight className="w-4 h-4" />
      </Link>
    </Card>
  );
}

// ─── Upgrade Modal ────────────────────────────────────────────────────────────
function UpgradeModalContent({ onDismiss }: { onDismiss: () => void }) {
  const [loading, setLoading] = useState(false);

  const handleUpgrade = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/stripe/create-checkout", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data.url) window.location.href = data.url;
      }
    } catch {
      toast.error("Could not start checkout");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <ul className="space-y-3 mb-6">
        {[
          { icon: "\u221E", text: "Unlimited access to all features" },
          { icon: "\uD83D\uDE80", text: "Priority support" },
          { icon: "\u2728", text: "Early access to new features" },
        ].map((f) => (
          <li key={f.text} className="flex items-center gap-3">
            <span className="w-7 h-7 bg-accent text-primary rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
              {f.icon}
            </span>
            <span className="text-sm text-gray-700 dark:text-gray-300">{f.text}</span>
          </li>
        ))}
      </ul>

      <Button
        variant="primary"
        size="lg"
        loading={loading}
        icon={<ExternalLink className="w-4 h-4" />}
        onClick={handleUpgrade}
        className="w-full mb-3"
      >
        Upgrade now
      </Button>
      <button
        onClick={onDismiss}
        className="w-full text-gray-400 dark:text-gray-500 text-sm hover:text-gray-600 dark:hover:text-gray-400 transition-colors"
      >
        Maybe later
      </button>
    </>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────
type InsightsState =
  | { kind: "loading" }
  | { kind: "no-connection" }
  | { kind: "connected-no-report"; followerCount: number | null; postCount: number | null }
  | {
      kind: "report";
      followerCount: number | null;
      postCount: number | null;
      postsAnalyzed: number;
      generatedAt: string;
      topPattern: string | null;
    };

export default function AppPage() {
  const router = useRouter();
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeBannerDismissed, setUpgradeBannerDismissed] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [verifiedBanner, setVerifiedBanner] = useState(false);
  const [insightsState, setInsightsState] = useState<InsightsState>({ kind: "loading" });

  const isPro = plan === "pro";

  const loadPlanStatus = useCallback(async () => {
    const res = await fetch("/api/stripe/status");
    if (res.ok) {
      const data = await res.json();
      setPlan(data.plan ?? "free");
    }
  }, []);

  const loadInsightsSummary = useCallback(async () => {
    try {
      const [accountRes, reportRes] = await Promise.all([
        fetch("/api/platforms/instagram/account"),
        fetch("/api/analyze/instagram"),
      ]);

      const account = accountRes.ok ? await accountRes.json() : null;
      const report = reportRes.ok ? await reportRes.json() : null;

      if (!account || !account.connected) {
        setInsightsState({ kind: "no-connection" });
        return;
      }

      const followerCount = account.snapshot?.follower_count ?? null;
      const postCount = account.snapshot?.media_count ?? null;

      if (report?.report) {
        setInsightsState({
          kind: "report",
          followerCount,
          postCount,
          postsAnalyzed: report.report.postsAnalyzed,
          generatedAt: report.report.generatedAt,
          topPattern: report.report.patterns?.[0]?.title ?? null,
        });
      } else {
        setInsightsState({ kind: "connected-no-report", followerCount, postCount });
      }
    } catch {
      setInsightsState({ kind: "no-connection" });
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const { data: session } = await authClient.getSession();
        if (!session) {
          router.push("/auth");
          return;
        }
        setUserEmail(session.user.email);
        await loadPlanStatus();
        loadInsightsSummary();
      } catch {
        router.push("/auth");
      } finally {
        setAuthLoading(false);
      }
    }
    init();
  }, [router, loadPlanStatus, loadInsightsSummary]);

  // Register commands
  useEffect(() => {
    const commands = [
      {
        id: "nav-dashboard",
        label: "Dashboard",
        category: "Navigation",
        icon: <Sprout className="w-4 h-4" />,
        keywords: ["home", "main"],
        action: () => router.push("/app"),
      },
      {
        id: "nav-settings",
        label: "Settings",
        category: "Navigation",
        icon: <Settings className="w-4 h-4" />,
        keywords: ["preferences", "account"],
        action: () => router.push("/settings"),
      },
      {
        id: "action-signout",
        label: "Sign Out",
        category: "Actions",
        icon: <LogOut className="w-4 h-4" />,
        keywords: ["logout", "exit"],
        action: async () => {
          await authClient.signOut();
          router.push("/auth");
        },
      },
      {
        id: "action-theme-light",
        label: "Switch to Light Mode",
        category: "Actions",
        icon: <Sun className="w-4 h-4" />,
        keywords: ["theme", "appearance"],
        action: () => {
          localStorage.setItem("maddiehq-theme", "light");
          document.documentElement.classList.remove("dark", "light");
          document.documentElement.classList.add("light");
          window.location.reload();
        },
      },
      {
        id: "action-theme-dark",
        label: "Switch to Dark Mode",
        category: "Actions",
        icon: <Moon className="w-4 h-4" />,
        keywords: ["theme", "appearance"],
        action: () => {
          localStorage.setItem("maddiehq-theme", "dark");
          document.documentElement.classList.remove("dark", "light");
          document.documentElement.classList.add("dark");
          window.location.reload();
        },
      },
      {
        id: "action-theme-system",
        label: "Use System Theme",
        category: "Actions",
        icon: <Monitor className="w-4 h-4" />,
        keywords: ["theme", "appearance", "auto"],
        action: () => {
          localStorage.setItem("maddiehq-theme", "system");
          window.location.reload();
        },
      },
    ];

    commandRegistry.registerAll(commands);
    return () => commands.forEach((c) => commandRegistry.unregister(c.id));
  }, [router]);

  // Detect ?upgraded=1 and ?verified=1 params
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("upgraded") === "1") {
      loadPlanStatus();
      toast.success("Welcome to Pro! Your upgrade is complete.");
      window.history.replaceState({}, "", "/app");
    }
    if (params.get("verified") === "1") {
      setVerifiedBanner(true);
      window.history.replaceState({}, "", "/app");
    }
  }, [loadPlanStatus]);

  const handleLogout = async () => {
    await authClient.signOut();
    router.push("/auth");
  };

  const handleManageSubscription = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal");
      if (res.ok) {
        const data = await res.json();
        if (data.url) window.location.href = data.url;
      }
    } catch {
      toast.error("Could not open subscription portal");
    } finally {
      setPortalLoading(false);
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <Skeleton circle width="w-8" height="h-8" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      {/* Onboarding for new users */}
      <Onboarding plan={isPro ? "pro" : "free"} />

      {/* Upgrade Modal */}
      <Modal
        open={showUpgradeModal}
        onClose={() => setShowUpgradeModal(false)}
        title="Upgrade to Pro"
        titleIcon={<Star className="w-5 h-5 text-primary" />}
      >
        <UpgradeModalContent onDismiss={() => setShowUpgradeModal(false)} />
      </Modal>

      {/* Header */}
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sprout className="w-6 h-6 text-primary" />
            <span className="font-bold text-gray-900 dark:text-gray-100">MaddieHQ</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs text-gray-500 dark:text-gray-400 hidden sm:block">{userEmail}</span>
            {isPro && (
              <Badge variant="pro" icon={<Star className="w-3 h-3" />}>
                Pro
              </Badge>
            )}
            {isPro && (
              <button
                onClick={handleManageSubscription}
                disabled={portalLoading}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-primary/80 underline transition-colors hidden sm:block"
              >
                {portalLoading ? "Loading\u2026" : "Manage subscription"}
              </button>
            )}
            <button
              onClick={() => router.push("/app/chat")}
              className="text-gray-400 hover:text-primary/80 transition-colors"
              title="AI Chat"
            >
              <MessageSquare className="w-4 h-4" />
            </button>
            <NotificationBell />
            <ThemeToggle compact />
            <button
              onClick={() => router.push("/settings")}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Email verified banner */}
        {verifiedBanner && (
          <Alert variant="success" onDismiss={() => setVerifiedBanner(false)}>
            Your email has been verified. Welcome aboard!
          </Alert>
        )}

        {/* Free plan upgrade banner */}
        {!isPro && !upgradeBannerDismissed && (
          <Alert variant="info" onDismiss={() => setUpgradeBannerDismissed(true)}>
            <span>
              You&apos;re on the free plan.{" "}
              <button
                onClick={() => setShowUpgradeModal(true)}
                className="font-semibold underline hover:text-primary/80"
              >
                Upgrade to Pro &rarr;
              </button>
            </span>
          </Alert>
        )}

        {/* Welcome */}
        <Card padding="lg">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
            Welcome back{userEmail ? `, ${userEmail}` : ""}!
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            You&apos;re signed in and ready to build.{" "}
            {isPro ? (
              <span className="text-primary font-medium">You have Pro access.</span>
            ) : (
              <button
                onClick={() => setShowUpgradeModal(true)}
                className="text-primary font-medium hover:text-primary/80 underline"
              >
                Upgrade to Pro
              </button>
            )}
          </p>
        </Card>

        {/* Coomander — AI ops manager (primary feature) */}
        <CoomanderCard />

        {/* Pro-gated feature example */}
        <Card
          title="Pro Feature Example"
          headerAction={
            !isPro ? (
              <Badge variant="default" icon={<Lock className="w-3 h-3" />}>
                Pro only
              </Badge>
            ) : undefined
          }
        >
          {isPro ? (
            <div className="bg-accent rounded-xl p-4 text-center">
              <p className="text-accent-foreground font-medium text-sm">
                This is your Pro feature. Replace this with your actual Pro content.
              </p>
            </div>
          ) : (
            <div className="text-center py-8">
              <Lock className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                This feature requires a Pro subscription.
              </p>
              <Button
                variant="primary"
                icon={<Star className="w-4 h-4" />}
                onClick={() => setShowUpgradeModal(true)}
              >
                Upgrade to Pro
              </Button>
            </div>
          )}
        </Card>

        {/* Insights card */}
        <InsightsCard state={insightsState} />

        {/* Bottom padding */}
        <div className="pb-8" />
      </main>
    </div>
  );
}
