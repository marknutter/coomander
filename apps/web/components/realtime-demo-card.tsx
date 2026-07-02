"use client";

import { useState, useEffect, useCallback } from "react";
import { Radio } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { useRealtime, type RealtimeEvent } from "@/lib/use-realtime";

/**
 * Realtime "ping" demo card — the runnable, end-to-end worked example of the
 * realtime layer (see content/docs/dev/realtime.mdx), shown on the user
 * dashboard (`/app`) alongside the other secondary surfaces (#222). It
 * exercises the full publish → DO → WebSocket → hook round trip with no
 * database row in between:
 *
 *   "Send ping" → POST /api/realtime-demo/ping
 *     → publish("user:<id>", { type: "demo-ping", ts })
 *     → agents Worker → RealtimeChannel DO broadcast
 *     → this widget's useRealtime("user:<id>") fires → counter ticks, no reload
 *
 * It subscribes only to the caller's OWN `user:` channel (all `authorizeChannel`
 * permits) and pings only that channel, so any signed-in user can run it safely.
 * Mirrors `notification-bell.tsx` for the client-side session fetch.
 */
export function RealtimeDemoCard() {
  const [userId, setUserId] = useState<string | null>(null);
  const [count, setCount] = useState(0);
  const [lastTs, setLastTs] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch the session to get the current user id for the realtime channel (same
  // approach as NotificationBell). The card only ever subscribes to the caller's
  // OWN `user:` channel, which is all `authorizeChannel` permits.
  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      const session = data as { user?: { id?: string } } | null;
      if (session?.user?.id) setUserId(session.user.id);
    });
  }, []);

  // Subscribe to the caller's own user channel and react to `demo-ping` events.
  useRealtime(
    userId ? `user:${userId}` : null,
    useCallback((event: RealtimeEvent) => {
      if (event.type === "demo-ping") {
        setCount((c) => c + 1);
        if (typeof event.ts === "number") setLastTs(event.ts);
      }
    }, []),
  );

  const sendPing = useCallback(async () => {
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/realtime-demo/ping", { method: "POST" });
      if (!res.ok) throw new Error(`Ping failed (${res.status})`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSending(false);
    }
  }, []);

  return (
    <Card
      title="Realtime ping demo"
      headerAction={<Radio className="w-4 h-4 text-primary" />}
    >
      <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        A live example of the realtime backbone. Clicking{" "}
        <strong>Send ping</strong> publishes a{" "}
        <code className="font-mono">demo-ping</code> to your own{" "}
        <code className="font-mono">user:&lt;id&gt;</code> channel; the agents
        Worker fans it out through a per-channel Durable Object and the counter
        below updates over the live WebSocket — no page reload.
      </p>

      <div className="flex flex-col items-center gap-5 py-6 text-center">
        <div>
          <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 mb-1">
            Pings received
          </p>
          <p
            data-testid="realtime-ping-count"
            className="text-5xl font-bold tabular-nums text-gray-900 dark:text-gray-100"
          >
            {count}
          </p>
        </div>

        <p className="text-sm text-gray-500 dark:text-gray-400 min-h-5">
          {lastTs !== null ? (
            <>
              Last ping at{" "}
              <span className="font-mono">
                {new Date(lastTs).toLocaleTimeString()}
              </span>
            </>
          ) : (
            "No pings received yet — click below."
          )}
        </p>

        <Button
          type="button"
          onClick={sendPing}
          loading={sending}
          disabled={!userId}
          data-testid="realtime-ping-send"
        >
          Send ping
        </Button>

        {!userId && (
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Connecting to your realtime channel…
          </p>
        )}

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
        )}
      </div>
    </Card>
  );
}
