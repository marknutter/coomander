"use client";

/**
 * Lazy bridge to the WebSocket chat transport (Cloudflare Agents SDK).
 *
 * This is the ONLY value-import of `@/lib/use-agent-chat` (→ `agents/react` →
 * `partysocket`). It is loaded via `next/dynamic({ ssr: false })` and mounted
 * ONLY when the `coomander-agents-chat` flag is on, so flag-off users never bundle or
 * load the agent client — the SSE path stays byte-for-byte as it was.
 *
 * It renders nothing; it just runs the `useAgentChat` hook (a hook can't be
 * called conditionally, but a component can be conditionally mounted) and hands
 * the resulting `{ ready, send }` handle up to the chat page via `onHandle`.
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
  // Always `enabled` here — the component is only mounted when the flag is on.
  const handle = useAgentChat(true, callbacks);

  useEffect(() => {
    onHandle(handle);
    return () => onHandle(null);
  }, [handle, onHandle]);

  return null;
}
