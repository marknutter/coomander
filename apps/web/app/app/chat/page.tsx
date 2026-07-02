"use client";

/**
 * In-app Coomander chat (#169, epic #168).
 *
 * The real Coomander agent in the browser — NOT the generic template bot. It
 * renders the unified `coomander_message_log` thread (the SAME thread as
 * Telegram, so web + phone are one continuous conversation), streams turns over
 * the agents WebSocket — the SINGLE chat transport (#203) — to the user's
 * AppAgent (Coomander converses OR takes a domain action, grounded in the live
 * TodayModel), and shows an "enable Coomander" prompt instead of a dead chat
 * when ops isn't on yet. The thread is still LOADED via `GET /api/coomander/chat`.
 *
 * One assistant, not two: this replaces the old `/app/chat` template chatbot.
 */

import { useState, useEffect, useRef, useCallback, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import {
  Bot, Send, Mic, MicOff, Loader2, Sparkles, CheckCircle2,
} from "lucide-react";
import { ChatMessageContent } from "@/components/chat-message";
import { useVoice } from "@/lib/use-voice";
import { stripTags } from "@/lib/chat-tags";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/use-toast";
import { authClient } from "@/lib/auth-client";
import { useRealtime, type RealtimeEvent } from "@/lib/use-realtime";
import type { AgentChatCallbacks, AgentChatHandle } from "@/lib/use-agent-chat";

// Lazy bridge to the WebSocket Coomander transport (Cloudflare Agents SDK).
// It is the SINGLE chat transport (#203) — the POST /api/coomander/chat SEND
// path was removed, so the agents Worker is REQUIRED for chat. Loaded via
// next/dynamic({ ssr: false }) so the agent client only loads client-side, but
// it is ALWAYS mounted (no flag gate).
const AgentChatBridge = dynamic(() => import("@/components/agent-chat-bridge"), {
  ssr: false,
});

// How long to wait for the WebSocket to open before surfacing an error to the
// user (the socket auto-connects on mount and reconnects with backoff; this just
// bounds a single send so a turn is never silently dropped).
const SOCKET_READY_TIMEOUT_MS = 8000;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt?: number;
  /** Local-only marker: this turn took a domain action (logged a drop, etc.). */
  acted?: boolean;
}

const POLL_INTERVAL_MS = 12_000;
const SUGGESTIONS = [
  "What should I focus on today?",
  "What's my content cushion?",
  "Posted the gym reel",
];

function CoomanderChat() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [enabling, setEnabling] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [audioEnabled, setAudioEnabled] = useState(false);
  // Session user id — used only to subscribe to this user's realtime channel
  // (agent-initiated proactive/scheduled messages, #222). Fetched once on
  // mount, mirroring components/notification-bell.tsx.
  const [userId, setUserId] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);
  // Mirror audioEnabled + speak into refs so the memoized WS callbacks read the
  // live values (they're memoized on [loadThread], and speak is declared after
  // them — refs avoid both a stale closure and a temporal-dead-zone reference).
  const audioEnabledRef = useRef(false);
  useEffect(() => { audioEnabledRef.current = audioEnabled; }, [audioEnabled]);
  const speakRef = useRef<((text: string) => Promise<void>) | null>(null);

  // ── Agents-chat (WebSocket) transport — the SINGLE chat transport (#203) ──
  // The bridge (and thus the socket) is always mounted once ops is enabled.
  // streamText is the live streaming assistant bubble (null = no WS turn in
  // flight); wsTurnRef marks a turn in flight over the socket so a mid-turn
  // disconnect cleans up the optimistic bubble + spinner. wsResolveRef resolves
  // the in-flight send promise on done/error.
  const [streamText, setStreamText] = useState<string | null>(null);
  const wsTurnRef = useRef(false);
  const wsResolveRef = useRef<(() => void) | null>(null);
  const agentHandleRef = useRef<AgentChatHandle | null>(null);
  const setAgentHandle = useCallback((h: AgentChatHandle | null) => {
    agentHandleRef.current = h;
  }, []);
  // Socket lifecycle: drive a connecting/reconnecting indicator and gate
  // sending until the socket is actually open (composing stays available).
  const [socketStatus, setSocketStatus] = useState<"connecting" | "open" | "closed">("connecting");
  // Whether the socket has ever opened — picks "Connecting…" vs "Reconnecting…".
  const hasConnectedRef = useRef(false);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Hydrate the unified thread (oldest-first) + ops-enabled state.
  const loadThread = useCallback(async () => {
    const res = await fetch("/api/coomander/chat");
    if (!res.ok) throw new Error(`thread load failed: ${res.status}`);
    const data = (await res.json()) as {
      enabled: boolean;
      messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: number }>;
    };
    setEnabled(data.enabled);
    setMessages(data.messages ?? []);
  }, []);

  useEffect(() => {
    loadThread()
      .catch((err) => {
        console.error("[Coomander chat]", err);
        toast.error("Couldn't load your Coomander thread.");
      })
      .finally(() => {
        setLoading(false);
        setTimeout(scrollToBottom, 100);
      });
  }, [loadThread, scrollToBottom]);

  // Fetch the session user id so we can subscribe to this user's realtime
  // channel below (agent-initiated proactive/scheduled messages, #222).
  useEffect(() => {
    authClient.getSession().then(({ data }) => {
      const session = data as { user?: { id?: string } } | null;
      if (session?.user?.id) setUserId(session.user.id);
    });
  }, []);

  /**
   * Handle an agent-initiated message pushed OUTSIDE any user turn — e.g. a
   * `schedule_followup` reminder fired by the AppAgent. AppAgent.deliverProactive
   * (apps/agents/src/index.ts) now publishes `{ type: "agent-message", message,
   * conversationId }` to this user's `user:<id>` realtime channel (#222)
   * instead of broadcasting a `proactive` frame down the chat socket — see the
   * useRealtime subscription below. When it carries the thread id, the message
   * was already persisted server-side, so reload the canonical thread (real
   * id, ordering, tool side effects) rather than client-appending it. With no
   * conversationId, fall back to a transient bubble. Behavior is unchanged from
   * the old onProactive callback.
   */
  const handleAgentMessage = useCallback(
    (message: string, conversationId?: string) => {
      if (conversationId) {
        loadThread().catch(() => {});
      } else {
        setMessages((m) => [
          ...m,
          { id: `proactive-${Date.now()}`, role: "assistant", content: message },
        ]);
      }
    },
    [loadThread],
  );

  useRealtime(
    userId ? `user:${userId}` : null,
    useCallback(
      (event: RealtimeEvent) => {
        if (event.type === "agent-message") {
          handleAgentMessage(
            event.message as string,
            event.conversationId as string | undefined,
          );
        }
      },
      [handleAgentMessage],
    ),
  );

  // Callbacks the WebSocket bridge invokes. Coomander has one unified thread, so
  // the conversation id is always the "coomander" sentinel and there's nothing
  // to track per turn — on done/proactive we reload the canonical thread (real
  // ids, ordering, tool side effects), matching the POST path's refresh.
  const agentCallbacks = useMemo<AgentChatCallbacks>(
    () => ({
      onConversation: () => {},
      onToken: (text) => setStreamText((prev) => (prev ?? "") + text),
      onDone: async (_conversationId, fullText) => {
        wsTurnRef.current = false;
        setSending(false);
        sendingRef.current = false;
        await loadThread().catch(() => {});
        setStreamText(null);
        const clean = stripTags(fullText);
        if (audioEnabledRef.current && clean) speakRef.current?.(clean).catch(() => {});
        wsResolveRef.current?.();
        wsResolveRef.current = null;
      },
      onError: (message) => {
        const turnWasActive = wsTurnRef.current || sendingRef.current;
        wsTurnRef.current = false;
        setStreamText(null);
        setSending(false);
        sendingRef.current = false;
        // Socket reconnects happen in the background. Only render an error as
        // part of the conversation when a user turn was actually in flight.
        if (turnWasActive) {
          setMessages((m) => [
            ...m,
            { id: `err-${Date.now()}`, role: "assistant", content: message },
          ]);
        }
        wsResolveRef.current?.();
        wsResolveRef.current = null;
      },
      // Agent-initiated messages outside any user turn now arrive via the
      // useRealtime("user:<id>") subscription + handleAgentMessage above, not
      // this WS callback object (#222) — see lib/use-agent-chat.ts.
      onStatusChange: (status) => {
        setSocketStatus(status);
        if (status === "open") {
          hasConnectedRef.current = true;
        }
        // A mid-turn disconnect would otherwise leave the spinner forever.
        if (status === "closed" && wsTurnRef.current) {
          wsTurnRef.current = false;
          setStreamText(null);
          setSending(false);
          sendingRef.current = false;
          wsResolveRef.current?.();
          wsResolveRef.current = null;
        }
      },
    }),
    [loadThread]
  );

  // Light polling so a message sent on Telegram appears here without a manual
  // refresh (and vice versa). Skipped while a turn is in flight to avoid
  // clobbering the optimistic user bubble.
  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => {
      if (sendingRef.current) return;
      fetch("/api/coomander/chat")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.messages) return;
          setMessages((prev) => {
            // Only adopt the server thread if it has new rows we don't show yet.
            if (data.messages.length === prev.length) return prev;
            return data.messages as Message[];
          });
        })
        .catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [enabled]);

  // Auto-scroll on new messages (and as WS tokens stream in).
  useEffect(() => { scrollToBottom(); }, [messages, sending, streamText, scrollToBottom]);

  // Auto-resize the textarea.
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 150) + "px";
    }
  }, [input]);

  // Voice: speak transcripts as turns; optionally read replies aloud. Declared
  // before handleSend; `onTurnEnd` calls the hoisted handleSend below.
  const {
    voiceState, currentTranscript, toggleListening, speak,
    isSupported: isVoiceSupported, audioRef,
  } = useVoice({
    onTurnEnd: (transcript) => { void handleSend(transcript); },
    onError: (err) => console.error("[Voice]", err),
  });
  // Keep speakRef pointing at the live speak fn for the memoized WS callbacks.
  useEffect(() => { speakRef.current = speak; }, [speak]);

  /**
   * Resolve once the WebSocket is open, or reject after a timeout. The socket
   * auto-connects on mount and reconnects with backoff, so a "not ready yet"
   * state is usually transient — we poll briefly rather than dropping the turn.
   */
  function waitForSocket(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (agentHandleRef.current?.ready()) {
        resolve();
        return;
      }
      const start = Date.now();
      const interval = setInterval(() => {
        if (agentHandleRef.current?.ready()) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start >= timeoutMs) {
          clearInterval(interval);
          reject(new Error("socket-not-ready"));
        }
      }, 100);
    });
  }

  // Hoisted function declaration so useVoice (above) and the seed effect (below)
  // can both reference it without a temporal-dead-zone problem.
  //
  // The agents WebSocket is the SINGLE chat transport (#203) — the legacy
  // POST /api/coomander/chat SEND path was removed. The agent owns conversation
  // persistence (the same unified thread as Telegram); we render the user turn
  // optimistically and `onDone` reloads the canonical thread to reconcile ids +
  // tool side effects. If the socket isn't open we await readiness (~8s poll)
  // rather than dropping the turn; on timeout (or a send-time socket drop) we
  // roll back the optimistic bubble, restore the input, and surface a
  // "reconnecting" toast — the turn is never silently dropped.
  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || sendingRef.current) return;

    const optimistic: Message = { id: `local-${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);
    sendingRef.current = true;
    setStreamText("");

    // Roll back the optimistic bubble + restore the input so the user can retry.
    const rollback = () => {
      wsTurnRef.current = false;
      setStreamText(null);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
      setSending(false);
      sendingRef.current = false;
    };

    // Await socket readiness rather than falling back to a (now-removed) POST
    // path. If it never connects, undo the optimistic bubble and toast.
    try {
      await waitForSocket(SOCKET_READY_TIMEOUT_MS);
    } catch {
      console.error("[Coomander chat] socket not ready — chat unavailable");
      rollback();
      toast.error("Coomander is reconnecting — try again in a moment.");
      return;
    }

    // The send promise resolves when a done/error/close frame arrives (the
    // memoized WS callbacks set wsResolveRef + reset sending/streamText).
    try {
      await new Promise<void>((resolve) => {
        wsResolveRef.current = resolve;
        const ok =
          agentHandleRef.current?.send({ conversationId: "coomander", message: text }) ?? false;
        if (ok) {
          wsTurnRef.current = true;
        } else {
          // Socket dropped between the readiness check and send — bail cleanly.
          wsResolveRef.current = null;
          rollback();
          toast.error("Coomander is reconnecting — try again in a moment.");
          resolve();
        }
      });
    } catch (err) {
      console.error("[Coomander chat] send failed", err);
    }
  }

  // Seed the composer from a ?q= deep-link (quick actions on the home page).
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current || loading || !enabled) return;
    const q = searchParams.get("q");
    if (q) {
      seededRef.current = true;
      void handleSend(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, enabled, searchParams]);

  async function enableCoomander() {
    setEnabling(true);
    try {
      const res = await fetch("/api/coomander/enable", { method: "POST" });
      if (!res.ok) throw new Error(`enable failed: ${res.status}`);
      await loadThread();
      toast.success("Coomander is on. Say hi 👋");
    } catch (err) {
      console.error("[Coomander enable]", err);
      toast.error("Couldn't enable Coomander. Try again.");
    } finally {
      setEnabling(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-4">
        <Skeleton className="h-16 w-3/4" />
        <Skeleton className="h-16 w-2/3 ml-auto" />
        <Skeleton className="h-16 w-3/4" />
      </div>
    );
  }

  // ── Enable prompt (ops off) — not a dead chat ────────────────────────────────
  if (enabled === false) {
    return (
      <div className="max-w-xl mx-auto px-4 py-16">
        <div className="text-center">
          <div className="flex items-center justify-center w-16 h-16 bg-accent rounded-2xl mx-auto mb-5">
            <Bot className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            Meet Coomander
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-6">
            Coomander is your AI operations manager — it keeps your content cadence on
            track, logs what you ship in plain language, and flags blockers before they
            cost you. Turn it on to seed your starter playbook and start the conversation
            (here and on Telegram — it&apos;s one thread).
          </p>
          <Button
            variant="primary"
            size="lg"
            loading={enabling}
            icon={<Sparkles className="w-4 h-4" />}
            onClick={enableCoomander}
          >
            Enable Coomander
          </Button>
        </div>
      </div>
    );
  }

  // ── The chat ─────────────────────────────────────────────────────────────────
  const isDisabled = sending || voiceState === "listening" || voiceState === "speaking";
  // Sending is additionally gated on an open socket — the textarea stays
  // editable while connecting so the user can compose; only the send fires
  // once the socket is ready. `handleSend` still awaits readiness internally
  // (~8s poll) as a second line of defense against a race at the boundary.
  const socketReady = socketStatus === "open";

  return (
    <div className="flex flex-col h-[calc(100dvh-3.5rem)]">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-2xl mx-auto space-y-4">
          {messages.length === 0 && !sending && (
            <div className="text-center py-16">
              <Bot className="w-10 h-10 text-primary/70 mx-auto mb-3" />
              <p className="text-gray-700 dark:text-gray-200 font-medium">
                Coomander is ready.
              </p>
              <p className="text-gray-400 dark:text-gray-500 text-xs mt-1">
                Ask what to work on, or tell it what you shipped.
              </p>
              <div className="flex flex-wrap justify-center gap-2 mt-5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => void handleSend(s)}
                    className="px-3 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-xs text-gray-600 dark:text-gray-300 hover:border-primary hover:text-primary transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
                  msg.role === "user"
                    ? "bg-primary text-white"
                    : "bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                }`}
              >
                <ChatMessageContent content={msg.content} role={msg.role} />
                {msg.acted && (
                  <div className="flex items-center gap-1 mt-1.5 text-xs text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="w-3 h-3" />
                    <span>Logged to Cadence</span>
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Live streaming assistant bubble (WebSocket path, #192). */}
          {streamText !== null && streamText.length > 0 && (
            <div className="flex justify-start">
              <div className="max-w-[80%] rounded-2xl px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-gray-100">
                <ChatMessageContent content={streamText} role="assistant" />
              </div>
            </div>
          )}

          {/* Thinking indicator — suppressed once tokens stream over the WS. */}
          {sending && !streamText && (
            <div className="flex justify-start">
              <div className="rounded-2xl px-4 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700">
                <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
              </div>
            </div>
          )}

          {/* Live voice transcript */}
          {voiceState === "listening" && currentTranscript && (
            <div className="flex justify-end">
              <div className="max-w-[80%] rounded-2xl px-4 py-2.5 border-2 border-dashed border-primary text-accent-foreground text-sm">
                {currentTranscript}
                <span className="inline-block w-0.5 h-3.5 bg-primary animate-pulse ml-0.5" />
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Hidden audio element for TTS */}
      <audio ref={audioRef} className="hidden" />

      {/* WebSocket transport bridge — the SINGLE chat transport (#203). Mounted
          once ops is enabled (no flag gate). This is the only thing that opens
          the agent WebSocket; the agents Worker is REQUIRED for chat. */}
      {enabled && !loading && (
        <AgentChatBridge callbacks={agentCallbacks} onHandle={setAgentHandle} />
      )}

      {/* Composer */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        {/* Persistent connecting/reconnecting indicator */}
        {!socketReady && (
          <div className="max-w-2xl mx-auto mb-2 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400" role="status">
            <Loader2 className="w-3 h-3 animate-spin" />
            {hasConnectedRef.current ? "Reconnecting to Coomander…" : "Connecting to Coomander…"}
          </div>
        )}
        <form
          onSubmit={(e) => { e.preventDefault(); if (socketReady) void handleSend(); }}
          className="max-w-2xl mx-auto flex items-end gap-2"
        >
          {isVoiceSupported && (
            <button
              type="button"
              onClick={() => void toggleListening()}
              disabled={sending || voiceState === "speaking"}
              className={`p-2 rounded-lg transition-colors ${
                voiceState === "listening"
                  ? "bg-red-500 text-white animate-pulse"
                  : "text-gray-400 hover:text-primary"
              }`}
              title={voiceState === "listening" ? "Stop" : "Speak"}
            >
              {voiceState === "listening" ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
          )}

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (socketReady) void handleSend(); } }}
            placeholder={voiceState === "listening" ? "Listening…" : "Message Coomander…"}
            disabled={isDisabled}
            rows={1}
            className="flex-1 resize-none border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-[150px]"
          />

          <button
            type="submit"
            disabled={isDisabled || !socketReady || !input.trim()}
            className="p-2 text-white bg-primary hover:bg-primary/90 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Send"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
        <div className="max-w-2xl mx-auto mt-2 flex items-center justify-between">
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            One thread across web &amp; Telegram.
          </p>
          {isVoiceSupported && (
            <label className="flex items-center gap-1.5 text-[11px] text-gray-400 dark:text-gray-500 cursor-pointer">
              <input
                type="checkbox"
                checked={audioEnabled}
                onChange={(e) => setAudioEnabled(e.target.checked)}
                className="rounded border-gray-300 dark:border-gray-600"
              />
              Read replies aloud
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CoomanderChatPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[calc(100dvh-3.5rem)] items-center justify-center">
          <Skeleton circle width="w-8" height="h-8" />
        </div>
      }
    >
      <CoomanderChat />
    </Suspense>
  );
}
