"use client";

/**
 * React hook for subscribing to SSE channels with auto-reconnect.
 *
 * Usage:
 *   useRealtime("notifications:userId", (event) => {
 *     console.log("Got event:", event);
 *   });
 */

import { useEffect, useRef } from "react";

export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * Connect to an SSE channel and invoke `onEvent` for each message.
 * Automatically reconnects on connection loss with exponential backoff.
 */
export function useRealtime(
  channel: string | null,
  onEvent: (event: RealtimeEvent) => void,
): void {
  const onEventRef = useRef(onEvent);
  // Keep the ref in sync with the latest callback so the effect below can call
  // the most recent version without resubscribing on every render.
  useEffect(() => {
    onEventRef.current = onEvent;
  });

  useEffect(() => {
    if (!channel) return;

    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let retryDelay = 1000;
    let cancelled = false;

    const ch = channel;

    function connect() {
      if (cancelled) return;

      es = new EventSource(`/api/realtime/${encodeURIComponent(ch)}`);

      es.onopen = () => {
        // Reset backoff on successful connection
        retryDelay = 1000;
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as RealtimeEvent;
          onEventRef.current(data);
        } catch {
          // Ignore non-JSON messages (e.g. heartbeat comments)
        }
      };

      es.onerror = () => {
        // Close the broken connection
        es?.close();
        es = null;

        if (cancelled) return;

        // Exponential backoff: 1s, 2s, 4s, 8s, max 30s
        reconnectTimer = setTimeout(() => {
          connect();
        }, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 30000);
      };
    }

    connect();

    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [channel]);
}
