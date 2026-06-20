"use client";

/**
 * Lazy bridge to the WebSocket chat transport (Cloudflare Agents SDK).
 *
 * This is the ONLY value-import of `@/lib/use-agent-chat` (→ `agents/react` →
 * `partysocket`). It is loaded via `next/dynamic({ ssr: false })` so the agent
 * client only loads client-side, but it is ALWAYS mounted — the WebSocket is the
 * single chat transport (#203, no POST/SSE fallback).
 *
 * It renders nothing; it just runs the `useAgentChat` hook and hands the
 * resulting `{ ready, send }` handle up to the chat page via `onHandle`.
 */

import { useEffect } from "react";
import {
  useAgentChat,
  type AgentChatCallbacks,
  type AgentChatHandle,
} from "@/lib/use-agent-chat";

export default function AgentChatBridge({
  callbacks,
  onHandle,
}: {
  callbacks: AgentChatCallbacks;
  onHandle: (handle: AgentChatHandle | null) => void;
}) {
  const handle = useAgentChat(callbacks);

  useEffect(() => {
    onHandle(handle);
    return () => onHandle(null);
  }, [handle, onHandle]);

  return null;
}
