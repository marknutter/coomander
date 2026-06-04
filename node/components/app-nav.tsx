"use client";

/**
 * App navigation shell (#171, epic #168).
 *
 * Persistent top nav across the authed `/app` surfaces, branded "Coomander"
 * (the product/agent identity). The agent is the spine; Cadence + Insights are
 * the visual detail behind it. Rendered once from app/app/layout.tsx so every
 * /app page shares it.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bot, Home, Sparkles, ListChecks, MessageSquare, Settings, LogOut, Star } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Badge } from "@/components/ui/badge";

const LINKS = [
  { href: "/app", label: "Home", icon: Home, exact: true },
  { href: "/app/cadence", label: "Cadence", icon: ListChecks },
  { href: "/app/insights", label: "Insights", icon: Sparkles },
  { href: "/app/chat", label: "Coomander", icon: MessageSquare },
];

export function AppNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [isPro, setIsPro] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    fetch("/api/stripe/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIsPro((d?.plan ?? "free") === "pro"))
      .catch(() => {});
  }, []);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  const signOut = async () => {
    await authClient.signOut();
    router.push("/auth");
  };

  const manageSubscription = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch("/api/stripe/portal");
      if (res.ok) {
        const data = await res.json();
        if (data.url) window.location.href = data.url;
      }
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-10">
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-2">
        <Link href="/app" className="flex items-center gap-2 mr-2 shrink-0">
          <Bot className="w-6 h-6 text-primary" />
          <span className="font-bold text-gray-900 dark:text-gray-100">Coomander</span>
        </Link>

        <nav className="flex items-center gap-1 overflow-x-auto">
          {LINKS.map((l) => {
            const Icon = l.icon;
            const active = isActive(l.href, l.exact);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-sm transition-colors whitespace-nowrap ${
                  active
                    ? "bg-accent text-primary font-semibold"
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700/60"
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden sm:inline">{l.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3 ml-auto shrink-0">
          {isPro && (
            <>
              <Badge variant="pro" icon={<Star className="w-3 h-3" />}>Pro</Badge>
              <button
                onClick={manageSubscription}
                disabled={portalLoading}
                className="text-xs text-gray-400 dark:text-gray-500 hover:text-primary/80 underline transition-colors hidden md:block"
              >
                {portalLoading ? "Loading…" : "Manage"}
              </button>
            </>
          )}
          <NotificationBell />
          <ThemeToggle compact />
          <Link href="/settings" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" title="Settings">
            <Settings className="w-4 h-4" />
          </Link>
          <button onClick={signOut} className="text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors" title="Sign out">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
}
