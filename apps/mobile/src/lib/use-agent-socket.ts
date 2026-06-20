/**
 * Raw React Native WebSocket transport to the user's AppAgent (#199).
 *
 * This is the mobile counterpart to apps/web/lib/use-agent-chat.ts. The web uses
 * `agents/react` (partysocket) because browsers send the Better Auth session
 * cookie automatically — but the browser WebSocket API cannot set request
 * headers. The agents Worker authenticates the WS UPGRADE with the session
 * cookie, so on mobile we MUST use a raw `WebSocket` whose 3rd options arg
 * injects `Cookie: authClient.getCookie()`. partysocket would add a
 * browser-oriented dep and still couldn't set that header — hence a plain socket.
 *
 * Routing facts that make a plain raw socket work (no partysocket query params):
 *   - partyserver's router generates a connection id when `_pk` is absent, so a
 *     bare upgrade to /agents/app-agent/<name> routes to the DO and fires
 *     onConnect.
 *   - The Worker ignores the client name and routes by validated session userId;
 *     "me" is cosmetic.
 *
 * The hook stays thin: it parses each frame with `parseServerFrame` and forwards
 * it via `onFrame` (the screen folds frames into StreamState with `reduce`). It
 * is the SINGLE mobile chat transport (#203) — the POST/SSE fallback was removed,
 * so the socket always connects on mount.
 */

import { useCallback, useEffect, useRef } from "react";

import { authClient, API_URL } from "./auth-client";
import {
  buildWsUrl,
  encodeChatFrame,
  parseServerFrame,
  type ServerFrame,
} from "./agent-socket-protocol";

export type SocketStatus = "connecting" | "open" | "closed";

export interface UseAgentSocketArgs {
  /** Invoked with every parsed server frame. */
  onFrame: (frame: ServerFrame) => void;
  /** Invoked on connection lifecycle transitions. */
  onStatusChange?: (status: SocketStatus) => void;
}

export interface AgentSocketHandle {
  /** True while the socket is open and ready to send. */
  ready: () => boolean;
  /** Send a user turn over the socket; false if the socket isn't open. */
  send: (args: {
    conversationId: string | null;
    message: string;
    userContext?: string;
  }) => boolean;
}

/** Capped exponential backoff for reconnects. */
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/** WebSocket close code the agents Worker uses for auth failures (#199). */
const WS_CLOSE_AUTH = 1008;

/**
 * RN's WebSocket constructor accepts a 3rd `options` arg with `headers`
 * (lib.dom's type only declares 2 args), so widen it locally. The instance is
 * still the lib.dom WebSocket type, which covers our event/handler usage.
 */
const RNWebSocket = WebSocket as unknown as {
  new (
    url: string,
    protocols: string | string[] | null,
    options: { headers: Record<string, string> },
  ): WebSocket;
};

export function useAgentSocket({
  onFrame,
  onStatusChange,
}: UseAgentSocketArgs): AgentSocketHandle {
  // Keep the latest callbacks in refs so the socket handlers always call the
  // current ones without making the connect effect depend on (and tear down for)
  // changing callback identities.
  const onFrameRef = useRef(onFrame);
  const onStatusRef = useRef(onStatusChange);
  useEffect(() => {
    onFrameRef.current = onFrame;
  });
  useEffect(() => {
    onStatusRef.current = onStatusChange;
  });

  const socketRef = useRef<WebSocket | null>(null);
  const openRef = useRef(false);

  useEffect(() => {
    // The socket always connects on mount — it is the single chat transport
    // (#203). Auth is still gated inside `connect()`: with no session cookie we
    // mark stopped and a later mount (after sign-in) re-runs this effect.
    let cancelled = false;
    let attempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    // Set when an auth close (1008) tells us not to keep hammering the Worker.
    let stopped = false;

    const clearTimer = () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    };

    const scheduleReconnect = () => {
      if (cancelled || stopped) return;
      const delay = Math.min(
        BASE_RECONNECT_DELAY_MS * 2 ** attempt,
        MAX_RECONNECT_DELAY_MS,
      );
      attempt += 1;
      clearTimer();
      reconnectTimer = setTimeout(connect, delay);
    };

    function connect() {
      if (cancelled || stopped) return;

      const cookie = authClient.getCookie();
      if (!cookie) {
        // Not signed in (or cookie not yet stored) — don't attempt a doomed
        // upgrade; the POST/SSE path stays the fallback. A later mount (after
        // sign-in) re-runs this effect.
        stopped = true;
        return;
      }

      let ws: WebSocket;
      try {
        onStatusRef.current?.("connecting");
        ws = new RNWebSocket(buildWsUrl(API_URL), null, {
          // Cookie ONLY — no Origin. The Worker validates the session with a GET
          // to /api/auth/get-session, which Better Auth does NOT CSRF-check, so
          // the upgrade needs only the cookie (sending Origin is explicitly out
          // of scope per #199).
          headers: { Cookie: cookie },
        });
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = ws;

      ws.onopen = () => {
        if (cancelled) {
          try {
            ws.close();
          } catch {
            // ignore
          }
          return;
        }
        openRef.current = true;
        attempt = 0;
        onStatusRef.current?.("open");
      };

      ws.onmessage = (event: MessageEvent) => {
        const frame = parseServerFrame(event.data);
        if (frame) onFrameRef.current(frame);
      };

      // onerror is followed by onclose in RN; do the cleanup/reconnect there so
      // we don't double-schedule.
      ws.onerror = () => {};

      ws.onclose = (event: CloseEvent) => {
        openRef.current = false;
        if (socketRef.current === ws) socketRef.current = null;
        onStatusRef.current?.("closed");
        if (event?.code === WS_CLOSE_AUTH) {
          // Session invalid/expired — reconnecting would just loop. Stop until
          // the effect re-runs (e.g. flag/ops toggled or screen remount).
          stopped = true;
          return;
        }
        scheduleReconnect();
      };
    }

    connect();

    return () => {
      cancelled = true;
      stopped = true;
      clearTimer();
      openRef.current = false;
      const ws = socketRef.current;
      socketRef.current = null;
      if (ws) {
        // Detach handlers so a late close/message can't fire callbacks after
        // unmount, then close.
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
    // Connect once on mount; reconnection is handled internally with backoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = useCallback<AgentSocketHandle["send"]>((args) => {
    const ws = socketRef.current;
    if (!openRef.current || !ws) return false;
    try {
      ws.send(encodeChatFrame(args));
      return true;
    } catch {
      return false;
    }
  }, []);

  const ready = useCallback(() => openRef.current, []);

  return { ready, send };
}
