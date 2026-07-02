"use client";

/**
 * React hook for subscribing to a realtime channel over a WebSocket.
 *
 * The socket connects same-origin to `/realtime/<channel>`, which Caddy proxies
 * to the agents Worker in dev (tailscale/Caddyfile) and the wrangler route
 * pattern serves in prod (apps/agents/wrangler.toml `[env.production]`).
 * Because it's same-origin, the Better Auth session cookie rides along on the
 * upgrade, so the Worker gate can authenticate + authorize the channel before
 * any DO is touched (see apps/agents/src/channel/routing.ts authorizeChannel).
 *
 * Replaces the old SSE/EventSource transport (the in-process pub/sub it talked
 * to was removed — it only worked single-process and was broken on Workers).
 * The public signature is unchanged so call sites (e.g. NotificationBell) don't
 * change.
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

/** Heartbeat ping cadence. The DO only revalidates the session on inbound
 *  frames, so a periodic ping both keeps the session warm and keeps the socket
 *  alive through idle proxies. */
const HEARTBEAT_INTERVAL = 25_000;

/** Reconnect backoff bounds (exponential 1s → 30s, reset on a clean open). */
const INITIAL_RETRY_DELAY = 1_000;
const MAX_RETRY_DELAY = 30_000;

/** Agents Worker close code for a rejected/expired session — don't reconnect
 *  (mirrors the mobile hook). Reconnecting would just be refused again, and each
 *  attempt forces the Worker to run a full session revalidation. */
const AUTH_CLOSE_CODE = 1008;

/**
 * Connect to a realtime channel over a WebSocket and invoke `onEvent` for each
 * message. Sends a `{type:"ping"}` heartbeat while open, reconnects with
 * exponential backoff on loss, and re-establishes immediately when the tab
 * returns to the foreground. Tears everything down on unmount / channel change /
 * `channel === null` with no leaked sockets, timers, or handlers.
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

    const ch = channel;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
    let retryDelay = INITIAL_RETRY_DELAY;
    let cancelled = false;

    function clearHeartbeat() {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function clearReconnect() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function scheduleReconnect() {
      if (cancelled || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, retryDelay);
      // Exponential backoff: 1s, 2s, 4s, 8s, … capped at 30s.
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    }

    function connect() {
      if (cancelled) return;
      // Never open a second socket while one is already connecting or open. A
      // reconnect/visibility race (e.g. foregrounding the tab mid-connect) could
      // otherwise leave DUPLICATE live sockets — each receiving (and the caller
      // double-handling) every broadcast. The dropped socket's onclose nulls
      // `ws`, so a genuine reconnect still proceeds.
      if (
        ws &&
        (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
      ) {
        return;
      }

      const wsProto = location.protocol === "https:" ? "wss" : "ws";
      const url = `${wsProto}://${location.host}/realtime/${encodeURIComponent(ch)}`;

      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        // Construction can throw (e.g. bad URL / blocked) — retry with backoff.
        scheduleReconnect();
        return;
      }
      ws = socket;

      socket.onopen = () => {
        if (cancelled) {
          socket.close();
          return;
        }
        // Reset backoff on a successful connection.
        retryDelay = INITIAL_RETRY_DELAY;
        // Start the heartbeat. The DO revalidates the session on inbound frames,
        // so this also keeps an authenticated socket from being closed for
        // staleness.
        clearHeartbeat();
        heartbeatTimer = setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            try {
              socket.send(JSON.stringify({ type: "ping" }));
            } catch {
              // Send can throw if the socket flipped to closing — ignore; the
              // onclose handler will drive the reconnect.
            }
          }
        }, HEARTBEAT_INTERVAL);
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as RealtimeEvent;
          // Ignore the server's heartbeat reply; deliver everything else.
          if (data?.type === "pong") return;
          onEventRef.current(data);
        } catch {
          // Ignore non-JSON frames (heartbeats / comments).
        }
      };

      socket.onerror = () => {
        // Let onclose own the reconnect — onerror is always followed by onclose.
        // Closing here makes the close deterministic.
        try {
          socket.close();
        } catch {
          // already closing/closed
        }
      };

      socket.onclose = (event) => {
        clearHeartbeat();
        if (ws === socket) ws = null;
        if (cancelled) return;
        // Session rejected/expired — the Worker closes with 1008. Reconnecting
        // would just be refused again (and re-run a full session validation on
        // the Worker each cycle), so stop. Mirrors the mobile hook.
        if (event?.code === AUTH_CLOSE_CODE) return;
        scheduleReconnect();
      };
    }

    // When the tab returns to the foreground, re-establish immediately if the
    // socket isn't open (mobile/background browsers freeze or drop sockets).
    function onVisibilityChange() {
      if (cancelled) return;
      if (document.visibilityState !== "visible") return;
      // Treat CONNECTING as "live" too — don't kick off a duplicate connect()
      // while one is already in flight (connect() also guards, belt + braces).
      const live =
        ws &&
        (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING);
      if (live) return;
      // Reset backoff and reconnect now rather than waiting out a long timer.
      clearReconnect();
      retryDelay = INITIAL_RETRY_DELAY;
      connect();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    connect();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      clearReconnect();
      clearHeartbeat();
      if (ws) {
        // Detach handlers so a late close/error can't fire a reconnect after
        // teardown, then close the socket.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          // already closing/closed
        }
        ws = null;
      }
    };
  }, [channel]);
}
