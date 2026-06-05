"use client";

/**
 * Agent-first home (#170, epic #168).
 *
 * Coomander leads: a today greeting + "what's on the table today" grounded in
 * the live TodayModel + Day 1-6 ramp, quick actions that seed the chat, and a
 * recent-thread snippet. Cadence + Insights are demoted to the supporting
 * "detail behind the agent" (#172). New users land in the conversational
 * "meet Coomander" onboarding (#173) instead of a feature-card grid.
 */

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import Link from "next/link";
import {
  Bot, LogOut, Star, ArrowRight, Settings, Sun, Moon, Monitor,
  MessageSquare, Sparkles, ListChecks, Send, CheckCircle2, AlertTriangle, Flame,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/alert";
import { Modal } from "@/components/ui/modal";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/lib/use-toast";
import { commandRegistry } from "@/lib/commands";
import { CoomanderOnboarding, ONBOARDING_DISMISSED_KEY } from "@/components/coomander-onboarding";

// ── Types mirroring GET /api/coomander/home ─────────────────────────────────────
interface HomeBeatLine {
  beatId: string;
  name: string;
  pillar: string;
  expectedToday: number;
  actualToday: number;
  status: string;
  detail?: string;
}
interface HomeBrief {
  date: string;
  rampDay: number | null;
  inRamp: boolean;
  overallState: "green" | "yellow" | "red";
  dayQuality: "good" | "bad" | null;
  contentCushionDays: number;
  shippedToday: number;
  headline: string;
  onTheTable: HomeBeatLine[];
  urgentProcurement: string[];
}
interface RecentMessage { id: string; role: "user" | "assistant"; content: string; createdAt: number }
interface HomeData {
  enabled: boolean;
  seeded: boolean;
  brief: HomeBrief | null;
  recentMessages: RecentMessage[];
}

const QUICK_ACTIONS = [
  "What should I focus on today?",
  "Log a reel",
  "What's my content cushion?",
  "What's blocking me?",
];

const ATTENTION = new Set(["behind", "untouched", "buffer_low"]);

function statusDot(status: string): string {
  if (ATTENTION.has(status)) return "bg-amber-500";
  if (status === "ahead" || status === "completed" || status === "buffer_healthy") return "bg-emerald-500";
  return "bg-gray-300 dark:bg-gray-600"; // on_pace / neutral
}

function overallPill(state: "green" | "yellow" | "red"): { label: string; cls: string } {
  switch (state) {
    case "red": return { label: "Needs attention", cls: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" };
    case "yellow": return { label: "On watch", cls: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300" };
    case "green": default: return { label: "On track", cls: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
  }
}

// ── Agent hero ───────────────────────────────────────────────────────────────
function AgentHero({ brief, onAction }: { brief: HomeBrief; onAction: (q: string) => void }) {
  const pill = overallPill(brief.overallState);
  return (
    <Card padding="lg">
      <div className="flex items-start gap-3 mb-4">
        <div className="flex items-center justify-center w-11 h-11 bg-accent rounded-xl shrink-0">
          <Bot className="w-6 h-6 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-bold text-gray-900 dark:text-gray-100">Coomander</span>
            <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${pill.cls}`}>{pill.label}</span>
            {brief.inRamp && brief.rampDay != null && (
              <Badge variant="default" icon={<Flame className="w-3 h-3" />}>Ramp day {brief.rampDay}</Badge>
            )}
          </div>
          <p className="text-sm text-gray-700 dark:text-gray-200 leading-relaxed">{brief.headline}</p>
        </div>
      </div>

      {/* On the table today */}
      <div className="rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-100 dark:divide-gray-700/60 mb-4">
        <div className="px-4 py-2 text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          On the table today
        </div>
        {brief.onTheTable.length === 0 ? (
          <div className="px-4 py-4 text-sm text-gray-500 dark:text-gray-400 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            Nothing outstanding today — nice. Bank some buffer if you can.
          </div>
        ) : (
          brief.onTheTable.slice(0, 6).map((b) => (
            <div key={b.beatId} className="px-4 py-2.5 flex items-center gap-3">
              <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(b.status)}`} />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-900 dark:text-gray-100 truncate">{b.name}</div>
                <div className="text-xs text-gray-400 dark:text-gray-500 truncate">{b.pillar}</div>
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 text-right shrink-0">
                {b.detail ? b.detail : `${b.actualToday}/${b.expectedToday} today`}
              </div>
            </div>
          ))
        )}
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
        <MiniStat label="Cushion" value={`${brief.contentCushionDays}d`} warn={brief.contentCushionDays < 2} />
        <MiniStat label="Shipped today" value={String(brief.shippedToday)} />
        {brief.urgentProcurement.length > 0 && (
          <MiniStat label="Urgent prep" value={String(brief.urgentProcurement.length)} warn />
        )}
      </div>

      {/* Quick actions seed the chat */}
      <div className="flex flex-wrap gap-2 mb-4">
        {QUICK_ACTIONS.map((q) => (
          <button
            key={q}
            onClick={() => onAction(q)}
            className="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:border-primary hover:text-primary transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      <Link
        href="/app/chat"
        className="inline-flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 transition-colors"
      >
        <MessageSquare className="w-4 h-4" />
        Open chat
      </Link>
    </Card>
  );
}

function MiniStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${warn ? "border-amber-300 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-900/20" : "border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50"}`}>
      <div className="text-[11px] uppercase tracking-wider text-gray-500 dark:text-gray-400 flex items-center gap-1">
        {warn && <AlertTriangle className="w-3 h-3" />}{label}
      </div>
      <div className="mt-0.5 text-lg font-semibold text-gray-900 dark:text-gray-100">{value}</div>
    </div>
  );
}

// ── Recent thread snippet ────────────────────────────────────────────────────
function RecentThread({ messages }: { messages: RecentMessage[] }) {
  if (!messages.length) return null;
  return (
    <Card title="Recent conversation" headerAction={<MessageSquare className="w-4 h-4 text-primary" />}>
      <div className="space-y-2 mb-3">
        {messages.slice(-3).map((m) => (
          <div key={m.id} className="flex gap-2 text-sm">
            <span className={`shrink-0 text-xs font-medium ${m.role === "assistant" ? "text-primary" : "text-gray-400 dark:text-gray-500"}`}>
              {m.role === "assistant" ? "Coomander" : "You"}
            </span>
            <span className="text-gray-600 dark:text-gray-300 line-clamp-2">{m.content}</span>
          </div>
        ))}
      </div>
      <Link href="/app/chat" className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium">
        Open full chat <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </Card>
  );
}

// ── Secondary surfaces (the detail behind the agent, #172) ───────────────────
function SecondarySurfaces() {
  return (
    <div>
      <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2 px-1">
        The detail behind the agent
      </h2>
      <div className="grid sm:grid-cols-2 gap-4">
        <SurfaceCard
          href="/app/cadence"
          icon={<ListChecks className="w-4 h-4 text-primary" />}
          title="Cadence"
          body="The detailed manager view — your pillars, beats, and weekly review. Coomander keeps it updated; open it to see and adjust the plan."
          cta="Open Cadence"
        />
        <SurfaceCard
          href="/app/insights"
          icon={<Sparkles className="w-4 h-4 text-primary" />}
          title="Insights"
          body="The analytics surface — Instagram patterns, reach, and per-post breakdowns that ground Coomander's advice in your real numbers."
          cta="Open Insights"
        />
      </div>
    </div>
  );
}

function SurfaceCard({ href, icon, title, body, cta }: { href: string; icon: React.ReactNode; title: string; body: string; cta: string }) {
  return (
    <Card title={title} headerAction={icon}>
      <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">{body}</p>
      <Link href={href} className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 font-medium">
        {cta} <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </Card>
  );
}

// ── New-user empty state ─────────────────────────────────────────────────────
function MeetCoomanderHero({ onStart }: { onStart: () => void }) {
  return (
    <Card padding="lg">
      <div className="text-center py-6">
        <div className="flex items-center justify-center w-16 h-16 bg-accent rounded-2xl mx-auto mb-5">
          <Bot className="w-8 h-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">Meet Coomander</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed max-w-md mx-auto mb-6">
          Your AI operations manager. It sets up your content cadence, keeps you on track,
          and logs what you ship when you just tell it — here or on Telegram, one thread.
          Let&apos;s get you set up.
        </p>
        <Button variant="primary" size="lg" icon={<Sparkles className="w-4 h-4" />} onClick={onStart}>
          Set up Coomander
        </Button>
      </div>
    </Card>
  );
}

// ── Upgrade modal ────────────────────────────────────────────────────────────
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
          { icon: "∞", text: "Unlimited access to all features" },
          { icon: "🚀", text: "Priority support" },
          { icon: "✨", text: "Early access to new features" },
        ].map((f) => (
          <li key={f.text} className="flex items-center gap-3">
            <span className="w-7 h-7 bg-accent text-primary rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">{f.icon}</span>
            <span className="text-sm text-gray-700 dark:text-gray-300">{f.text}</span>
          </li>
        ))}
      </ul>
      <Button variant="primary" size="lg" loading={loading} icon={<Send className="w-4 h-4" />} onClick={handleUpgrade} className="w-full mb-3">
        Upgrade now
      </Button>
      <button onClick={onDismiss} className="w-full text-gray-400 dark:text-gray-500 text-sm hover:text-gray-600 dark:hover:text-gray-400 transition-colors">
        Maybe later
      </button>
    </>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export default function AppPage() {
  const router = useRouter();
  const [authLoading, setAuthLoading] = useState(true);
  const [home, setHome] = useState<HomeData | null>(null);
  const [plan, setPlan] = useState<string>("free");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [upgradeBannerDismissed, setUpgradeBannerDismissed] = useState(false);
  const [verifiedBanner, setVerifiedBanner] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);

  const isPro = plan === "pro";

  const loadHome = useCallback(async () => {
    const res = await fetch("/api/coomander/home");
    if (!res.ok) throw new Error(`home load failed: ${res.status}`);
    const data = (await res.json()) as HomeData;
    setHome(data);
    return data;
  }, []);

  const loadPlanStatus = useCallback(async () => {
    const res = await fetch("/api/stripe/status");
    if (res.ok) {
      const data = await res.json();
      setPlan(data.plan ?? "free");
    }
  }, []);

  useEffect(() => {
    async function init() {
      try {
        const { data: session } = await authClient.getSession();
        if (!session) { router.push("/auth"); return; }
        await loadPlanStatus();
        const data = await loadHome();
        // New users who haven't dismissed setup land straight in onboarding.
        const dismissed = (() => { try { return localStorage.getItem(ONBOARDING_DISMISSED_KEY) === "true"; } catch { return false; } })();
        if (!data.enabled && !dismissed) setOnboardingOpen(true);
      } catch {
        router.push("/auth");
      } finally {
        setAuthLoading(false);
      }
    }
    init();
  }, [router, loadPlanStatus, loadHome]);

  // Command palette entries (kept consistent with the nav IA).
  useEffect(() => {
    const commands = [
      { id: "nav-dashboard", label: "Home", category: "Navigation", icon: <Bot className="w-4 h-4" />, keywords: ["home", "coomander"], action: () => router.push("/app") },
      { id: "nav-cadence", label: "Cadence", category: "Navigation", icon: <ListChecks className="w-4 h-4" />, keywords: ["ops", "plan", "beats", "pillars"], action: () => router.push("/app/cadence") },
      { id: "nav-insights", label: "Insights", category: "Navigation", icon: <Sparkles className="w-4 h-4" />, keywords: ["analytics", "instagram", "reports"], action: () => router.push("/app/insights") },
      { id: "nav-coomander-chat", label: "Chat with Coomander", category: "Navigation", icon: <MessageSquare className="w-4 h-4" />, keywords: ["agent", "assistant", "chat"], action: () => router.push("/app/chat") },
      { id: "nav-settings", label: "Settings", category: "Navigation", icon: <Settings className="w-4 h-4" />, keywords: ["preferences", "account"], action: () => router.push("/settings") },
      { id: "action-signout", label: "Sign Out", category: "Actions", icon: <LogOut className="w-4 h-4" />, keywords: ["logout", "exit"], action: async () => { await authClient.signOut(); router.push("/auth"); } },
      { id: "action-theme-light", label: "Switch to Light Mode", category: "Actions", icon: <Sun className="w-4 h-4" />, keywords: ["theme"], action: () => { localStorage.setItem("maddiehq-theme", "light"); document.documentElement.classList.remove("dark", "light"); document.documentElement.classList.add("light"); window.location.reload(); } },
      { id: "action-theme-dark", label: "Switch to Dark Mode", category: "Actions", icon: <Moon className="w-4 h-4" />, keywords: ["theme"], action: () => { localStorage.setItem("maddiehq-theme", "dark"); document.documentElement.classList.remove("dark", "light"); document.documentElement.classList.add("dark"); window.location.reload(); } },
      { id: "action-theme-system", label: "Use System Theme", category: "Actions", icon: <Monitor className="w-4 h-4" />, keywords: ["theme", "auto"], action: () => { localStorage.setItem("maddiehq-theme", "system"); window.location.reload(); } },
    ];
    commandRegistry.registerAll(commands);
    return () => commands.forEach((c) => commandRegistry.unregister(c.id));
  }, [router]);

  // ?upgraded / ?verified handling.
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

  const seedChat = (q: string) => router.push(`/app/chat?q=${encodeURIComponent(q)}`);

  if (authLoading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <Skeleton circle width="w-8" height="h-8" />
      </div>
    );
  }

  return (
    <>
      <CoomanderOnboarding
        open={onboardingOpen}
        onClose={() => setOnboardingOpen(false)}
        onComplete={() => { loadHome().catch(() => {}); }}
      />

      <Modal open={showUpgradeModal} onClose={() => setShowUpgradeModal(false)} title="Upgrade to Pro" titleIcon={<Star className="w-5 h-5 text-primary" />}>
        <UpgradeModalContent onDismiss={() => setShowUpgradeModal(false)} />
      </Modal>

      <main className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {verifiedBanner && (
          <Alert variant="success" onDismiss={() => setVerifiedBanner(false)}>
            Your email has been verified. Welcome aboard!
          </Alert>
        )}

        {!isPro && !upgradeBannerDismissed && (
          <Alert variant="info" onDismiss={() => setUpgradeBannerDismissed(true)}>
            <span>
              You&apos;re on the free plan.{" "}
              <button onClick={() => setShowUpgradeModal(true)} className="font-semibold underline hover:text-primary/80">
                Upgrade to Pro &rarr;
              </button>
            </span>
          </Alert>
        )}

        {home?.enabled && home.brief ? (
          <>
            <AgentHero brief={home.brief} onAction={seedChat} />
            <RecentThread messages={home.recentMessages} />
            <SecondarySurfaces />
          </>
        ) : (
          <>
            <MeetCoomanderHero onStart={() => setOnboardingOpen(true)} />
            <SecondarySurfaces />
          </>
        )}

        <div className="pb-8" />
      </main>
    </>
  );
}
