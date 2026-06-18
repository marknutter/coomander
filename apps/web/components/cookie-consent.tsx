"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Cookie, X } from "lucide-react";
import { cn } from "@/lib/cn";

const COOKIE_CONSENT_KEY = "coomander-cookie-consent";

export type CookiePreference = "all" | "essential" | null;

/**
 * Get the stored cookie consent preference.
 */
export function getCookieConsent(): CookiePreference {
  if (typeof window === "undefined") return null;
  const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
  if (stored === "all" || stored === "essential") return stored;
  return null;
}

/**
 * GDPR-compliant cookie consent banner.
 * Appears on first visit, remembers preference in localStorage.
 * Preference is also stored as a cookie for server-side reading.
 *
 * @example
 * ```tsx
 * // Add to layout.tsx inside ThemeProvider:
 * <CookieConsent />
 * ```
 */
export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Show banner if no preference has been set
    const consent = getCookieConsent();
    if (!consent) {
      // Small delay so it doesn't flash immediately on load
      const timer = setTimeout(() => setVisible(true), 1000);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = (preference: "all" | "essential") => {
    localStorage.setItem(COOKIE_CONSENT_KEY, preference);
    // Also set as a cookie so the server can read it
    document.cookie = `${COOKIE_CONSENT_KEY}=${preference};path=/;max-age=31536000;SameSite=Lax`;
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6",
        "animate-in slide-in-from-bottom"
      )}
    >
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 rounded-2xl shadow-xl border border-gray-200 dark:border-gray-700 p-5 sm:p-6">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          {/* Icon & Text */}
          <div className="flex items-start gap-3 flex-1">
            <Cookie className="w-5 h-5 text-primary mt-0.5 shrink-0" />
            <div>
              <p className="text-sm text-gray-700 dark:text-gray-200 font-medium mb-1">
                We use cookies
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                We use essential cookies for authentication and preferences. Optional
                analytics cookies help us improve the service.{" "}
                <Link
                  href="/privacy-policy#cookies"
                  className="text-primary hover:underline"
                >
                  Learn more
                </Link>
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
            <button
              onClick={() => accept("essential")}
              className="flex-1 sm:flex-none text-sm font-medium text-gray-600 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 px-4 py-2 rounded-lg transition-colors"
            >
              Essential only
            </button>
            <button
              onClick={() => accept("all")}
              className="flex-1 sm:flex-none text-sm font-semibold text-white bg-primary hover:bg-primary/90 px-4 py-2 rounded-lg transition-colors"
            >
              Accept all
            </button>
            <button
              onClick={() => accept("essential")}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors sm:hidden"
              aria-label="Dismiss"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
