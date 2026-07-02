"use client";

/**
 * WebSocket chat transport to the user's AppAgent (Cloudflare Agents SDK).
 *
 * This is the SINGLE chat transport for Coomander's in-app chat — the JSON
 * `POST /api/coomander/chat` SEND path was removed in Phase D (#203). The chat
 * page uses this hook to hold a live WebSocket to the agents sidecar Worker; the
 * agent runs the model, streams tokens back, and persists both turns through the
 * web API (so history survives reconnect — the page still LOADS it via
 * `GET /api/coomander/chat`). The agents Worker (apps/agents) is REQUIRED for chat.
 *
 * The connection is same-origin: Caddy routes `/agents/*` to the agents Worker
 * in dev, so the Better Auth session cookie flows automatically and `useAgent`'s
 * default URL construction (`/agents/app-agent/<name>`) reaches the right place.
 * The Worker IGNORES the client-supplied instance name and routes by the
 * validated session user id, so the literal `name` below is cosmetic.
 *
 * Protocol (mirrors apps/agents/src/chat.ts):
 *   send:    { type: "chat", conversationId, message, userContext? }
 *   receive: { type: "conversation", conversationId }
 *            { type: "token", text }
 *            { type: "done", conversationId, fullText }
 *            { type: "error", message }
 *
 * NOTE (#222): agent-initiated proactive/scheduled messages no longer arrive
 * on this socket. AppAgent.deliverProactive() now publishes to the user's
 * `user:{id}` realtime channel (apps/agents/src/channel) instead of
 * broadcasting a `proactive` frame here — subscribe via
 * `useRealtime("user:<id>", ...)` in the chat page for those.
 */

import { useCallback, useEffect, useRef } from "react";
import { useAgent } from "agents/react";

export interface AgentChatCallbacks {
  /** A new/confirmed conversation id (emitted once per turn, early). */
  onConversation: (conversationId: string) => void;
  /** A streamed token delta (already includes any tags; strip for display). */
  onToken: (text: string) => void;
  /** Turn finished — fullText is tag-stripped and persisted. */
  onDone: (conversationId: string, fullText: string) => void;
  /** A user-safe error message. */
  onError: (message: string) => void;
  /** Socket connection state changed. */
  onStatusChange?: (status: "connecting" | "open" | "closed") => void;
}

export interface AgentChatHandle {
  /** True while the socket is open. */
  ready: () => boolean;
  /** Send a user turn over the socket. */
  send: (args: { conversationId: string | null; message: string; userContext?: string }) => boolean;
}

type ServerFrame =
  | { type: "conversation"; conversationId: string }
  | { type: "token"; text: string }
  | { type: "done"; conversationId: string; fullText: string }
  | { type: "error"; message: string };

/**
 * Open a WebSocket to the AppAgent and return a stable handle. The socket
 * always connects — it is the single chat transport (#203).
 */
export function useAgentChat(callbacks: AgentChatCallbacks): AgentChatHandle {
  const cbRef = useRef(callbacks);
  // Keep the latest callbacks in a ref so the stable socket handlers below
  // always invoke the current ones. Assigned in an effect (not during render)
  // so we never write a ref mid-render — the handlers only fire async after
  // commit, so the effect timing is fine.
  useEffect(() => {
    cbRef.current = callbacks;
  });
  const openRef = useRef(false);

  const agent = useAgent({
    agent: "AppAgent",
    // Cosmetic — the Worker routes by validated session, not this name.
    name: "me",
    onOpen: () => {
      openRef.current = true;
      cbRef.current.onStatusChange?.("open");
    },
    onClose: () => {
      openRef.current = false;
      cbRef.current.onStatusChange?.("closed");
    },
    onError: () => {
      cbRef.current.onError("Connection error. Please try again.");
    },
    onMessage: (event: MessageEvent) => {
      if (typeof event.data !== "string") return;
      let frame: ServerFrame;
      try {
        frame = JSON.parse(event.data) as ServerFrame;
      } catch {
        return;
      }
      switch (frame.type) {
        case "conversation":
          cbRef.current.onConversation(frame.conversationId);
          break;
        case "token":
          cbRef.current.onToken(frame.text);
          break;
        case "done":
          cbRef.current.onDone(frame.conversationId, frame.fullText);
          break;
        case "error":
          cbRef.current.onError(frame.message);
          break;
      }
    },
  });

  const send = useCallback<AgentChatHandle["send"]>(
    ({ conversationId, message, userContext }) => {
      if (!openRef.current) return false;
      agent.send(
        JSON.stringify({ type: "chat", conversationId, message, userContext })
      );
      return true;
    },
    [agent]
  );

  const ready = useCallback(() => openRef.current, []);

  return { ready, send };
}
