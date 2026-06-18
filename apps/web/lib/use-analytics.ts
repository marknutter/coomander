/**
 * Client-side analytics hook.
 *
 * Sends events to /api/analytics/track (server-side proxy) to keep
 * API keys off the client. Also fires client-side provider scripts
 * if loaded (PostHog JS, Plausible, etc.).
 *
 * Usage:
 *   const { track } = useAnalytics();
 *   track("button.clicked", { buttonId: "signup" });
 */

"use client";

import { useCallback } from "react";

interface TrackOptions {
  /** Skip the server-side proxy call (client-only tracking) */
  clientOnly?: boolean;
}

export function useAnalytics() {
  const track = useCallback(
    async (event: string, properties?: Record<string, unknown>, options?: TrackOptions) => {
      // Client-side: fire PostHog/Plausible if loaded
      if (typeof window !== "undefined") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const w = window as any;

        // PostHog JS SDK
        if (w.posthog?.capture) {
          w.posthog.capture(event, properties);
        }

        // Plausible
        if (typeof w.plausible === "function") {
          w.plausible(event, properties ? { props: properties } : undefined);
        }
      }

      // Server-side proxy (keeps API keys off the client)
      if (!options?.clientOnly) {
        try {
          await fetch("/api/analytics/track", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ event, properties }),
          });
        } catch {
          // Silent failure — analytics should never break the app
        }
      }
    },
    []
  );

  return { track };
}
