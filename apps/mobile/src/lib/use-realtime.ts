/**
 * React Native hook for subscribing to a realtime channel over a WebSocket.
 *
 * The mobile counterpart to the web's `apps/web/lib/use-realtime.ts` — same
 * public API (`useRealtime(channel, onEvent)`) and the same `RealtimeEvent`
 * type — adapted to React Native:
 *
 *   • The web socket connects same-origin so the browser attaches the Better
 *     Auth session cookie automatically. RN can't rely on that, so (mirroring
 *     `use-agent-socket.ts`) we inject `Cookie: authClient.getCookie()` on the
 *     upgrade via RN's 3-arg `new WebSocket(url, protocols, { headers })`. The
 *     URL is built same-origin with the API (`EXPO_PUBLIC_API_URL`) so it still
 *     reaches the agents Worker / DO; the cookie lets the Worker gate the
 *     channel (own-channel only — see apps/agents/src/channel/routing.ts
 *     `authorizeChannel`). NO Origin header — session validation is a GET, so
 *     no CSRF/Origin is needed.
 *
 *   • The web hook reconnects on `visibilitychange`; mobile OSes freeze/kill
 *     background sockets, so we use `AppState` instead: close + pause on
 *     background/inactive, reconnect immediately on active.
 *
 * The agent is a TENANT of the realtime layer (#222): proactive messages now
 * arrive as `{ type: "agent-message", ... }` on the user's `user:<id>` channel
 * rather than as a `proactive` frame on the chat socket. The chat screen
 * subscribes via this hook.
 */

import { useEffect, useRef } from "react";
import { AppState, type AppStateStatus } from "react-native";

import { authClient, API_URL } from "@/lib/auth-client";

export interface RealtimeEvent {
  type: string;
  [key: string]: unknown;
}

/**
 * RN's `WebSocket` accepts a third `options` arg with a `headers` map, but the
 * ambient DOM type only declares the 2-arg form. This alias re-types the
 * constructor to RN's real 3-arg shape so we can inject the `Cookie` header on
 * the upgrade without an `any` cast. (Same trick as `use-agent-socket.ts`.)
 */
type RNWebSocketCtor = new (
  url: string,
  protocols?: string | string[],
  options?: { headers?: Record<string, string> },
) => WebSocket;
const RNWebSocket = WebSocket as unknown as RNWebSocketCtor;

/** Heartbeat ping cadence. The DO only revalidates the session on inbound
 *  frames, so a periodic ping both keeps the session warm and keeps the socket
 *  alive through idle proxies. */
const HEARTBEAT_INTERVAL = 25_000;

/** Reconnect backoff bounds (exponential 1s → 30s, reset on a clean open). */
const INITIAL_RETRY_DELAY = 1_000;
const MAX_RETRY_DELAY = 30_000;

/** Agents Worker close code for a rejected/expired session — don't reconnect. */
const AUTH_CLOSE_CODE = 1008;

/**
 * Build the realtime WebSocket URL for `channel` from the HTTP API base URL.
 *
 * Same-origin with the API (so `/realtime/*` reaches the agents Worker): swaps
 * the scheme (`http→ws`, `https→wss`), drops any path/query/hash, and appends
 * `/realtime/<encoded channel>`. Mirrors `buildWsUrl` in
 * `agent-socket-protocol.ts`, but for the realtime route.
 *
 * @param apiUrl  `EXPO_PUBLIC_API_URL` (e.g. `https://app.example.com` or
 *                `http://localhost:3005`).
 * @param channel The channel name (e.g. `user:<id>`); URL-encoded into the path.
 */
export function buildRealtimeUrl(apiUrl: string, channel: string): string {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : url.protocol === "http:" ? "ws:" : url.protocol;
  url.pathname = `/realtime/${encodeURIComponent(channel)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/**
 * Connect to a realtime channel over a WebSocket and invoke `onEvent` for each
 * message. Sends a `{type:"ping"}` heartbeat while open, reconnects with capped
 * exponential backoff on loss, stops permanently on a `1008` (auth) close, and
 * — adapted from the web hook's `visibilitychange` — closes on `AppState`
 * background/inactive and reconnects immediately on `active`. Tears everything
 * down on unmount / channel change / `channel === null` with no leaked sockets,
 * timers, handlers, or subscriptions.
 *
 * @param channel The realtime channel, or `null` to subscribe to nothing.
 * @param onEvent Invoked with each parsed event. Held in a ref so the effect
 *                doesn't resubscribe on every render (matches the web hook).
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
    // True while the app is backgrounded — we pause the socket and suppress
    // reconnects rather than fighting the OS killing background connections.
    let paused = false;

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
      if (cancelled || paused || reconnectTimer) return;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, retryDelay);
      // Exponential backoff: 1s, 2s, 4s, 8s, … capped at 30s.
      retryDelay = Math.min(retryDelay * 2, MAX_RETRY_DELAY);
    }

    function connect() {
      if (cancelled || paused) return;
      // Never open a second socket while one is already connecting or open — a
      // reconnect race could otherwise leave DUPLICATE live sockets, each
      // double-handling every broadcast. (closeSocket() nulls `ws` on
      // background, so a genuine reconnect still proceeds.)
      if (
        ws &&
        (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)
      ) {
        return;
      }

      // Resolve the cookie per-connection so it always reflects the current
      // session (e.g. after a token refresh during a reconnect).
      const cookie = authClient.getCookie();
      const url = buildRealtimeUrl(API_URL, ch);

      let socket: WebSocket;
      try {
        // RN's WebSocket constructor accepts an options object with `headers` as
        // the 3rd arg — this is how we inject the auth cookie. NO Origin header.
        socket = new RNWebSocket(url, undefined, cookie ? { headers: { Cookie: cookie } } : undefined);
      } catch {
        // Construction can throw (e.g. bad URL) — retry with backoff.
        scheduleReconnect();
        return;
      }
      ws = socket;

      socket.onopen = () => {
        if (cancelled || paused) {
          try {
            socket.close();
          } catch {
            // already closing/closed
          }
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

      socket.onmessage = (event: WebSocketMessageEvent) => {
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

      socket.onclose = (event: WebSocketCloseEvent) => {
        clearHeartbeat();
        if (ws === socket) ws = null;
        if (cancelled || paused) return;
        if (event?.code === AUTH_CLOSE_CODE) {
          // Session rejected/expired — reconnecting would just be refused again.
          console.warn("[useRealtime] auth close (1008) — not reconnecting");
          return;
        }
        scheduleReconnect();
      };
    }

    // Tear down the current socket without ending the subscription (used when
    // backgrounding). Detaches handlers so a late close can't fire a reconnect.
    function closeSocket() {
      clearReconnect();
      clearHeartbeat();
      if (ws) {
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
    }

    // Mobile OSes freeze/kill background sockets, so pause on background/inactive
    // and reconnect immediately when the app returns to the foreground.
    function onAppStateChange(next: AppStateStatus) {
      if (cancelled) return;
      if (next === "active") {
        if (!paused) return;
        paused = false;
        // Reset backoff and reconnect now rather than waiting out a long timer.
        retryDelay = INITIAL_RETRY_DELAY;
        connect();
      } else {
        // background | inactive — close and stop reconnecting until active again.
        if (paused) return;
        paused = true;
        closeSocket();
      }
    }

    const appStateSub = AppState.addEventListener("change", onAppStateChange);
    // Seed `paused` from the current state so we don't open a socket that the OS
    // is about to suspend (e.g. mounting while backgrounded).
    paused = AppState.currentState !== "active";
    if (!paused) connect();

    return () => {
      cancelled = true;
      appStateSub.remove();
      closeSocket();
    };
  }, [channel]);
}
