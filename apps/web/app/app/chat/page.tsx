"use client";

/**
 * In-app Coomander chat (#169, epic #168).
 *
 * The real Coomander agent in the browser — NOT the generic template bot. It
 * renders the unified `coomander_message_log` thread (the SAME thread as
 * Telegram, so web + phone are one continuous conversation), posts turns to
 * `POST /api/coomander/chat` (Coomander converses OR takes a domain action,
 * grounded in the live TodayModel), and shows an "enable Coomander" prompt
 * instead of a dead chat when ops isn't on yet.
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
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/use-toast";
import type { AgentChatCallbacks, AgentChatHandle } from "@/lib/use-agent-chat";

// Lazy bridge to the WebSocket Coomander transport (Cloudflare Agents SDK, #192).
// Loaded via next/dynamic({ ssr: false }) and mounted ONLY when the
// `coomander-agents-chat` flag is on, so flag-off users never bundle or load the
// agent client — the POST /api/coomander/chat path stays byte-for-byte as it was.
const AgentChatBridge = dynamic(() => import("@/components/agent-chat-bridge"), {
  ssr: false,
});

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

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sendingRef = useRef(false);

  // ── Agents-chat (WebSocket) transport, flag-gated (#192) ──────────────────
  // wsEnabled mirrors the `coomander-agents-chat` flag; the bridge (and thus
  // the socket) only mounts while flag-on + ops enabled. streamText is the live
  // streaming assistant bubble (null = no WS turn in flight); wsTurnRef marks a
  // turn sent over the socket so a mid-turn disconnect cleans up without
  // touching POST-path turns.
  const [wsEnabled, setWsEnabled] = useState(false);
  const [streamText, setStreamText] = useState<string | null>(null);
  const wsTurnRef = useRef(false);
  const agentHandleRef = useRef<AgentChatHandle | null>(null);
  const setAgentHandle = useCallback((h: AgentChatHandle | null) => {
    agentHandleRef.current = h;
  }, []);

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

  // Resolve the coomander-agents-chat flag once on mount (#192). The agent
  // socket only connects after this resolves true AND ops is enabled. Flag-off
  // (the default until the agents Worker is deployed) keeps the POST path.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/flags")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setWsEnabled(Boolean(d?.flags?.["coomander-agents-chat"]));
      })
      .catch(() => {
        // Flag endpoint unavailable — stay on the POST path.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Callbacks the WebSocket bridge invokes. Coomander has one unified thread, so
  // the conversation id is always the "coomander" sentinel and there's nothing
  // to track per turn — on done/proactive we reload the canonical thread (real
  // ids, ordering, tool side effects), matching the POST path's refresh.
  const agentCallbacks = useMemo<AgentChatCallbacks>(
    () => ({
      onConversation: () => {},
      onToken: (text) => setStreamText((prev) => (prev ?? "") + text),
      onDone: async () => {
        wsTurnRef.current = false;
        setSending(false);
        sendingRef.current = false;
        await loadThread().catch(() => {});
        setStreamText(null);
      },
      onError: (message) => {
        wsTurnRef.current = false;
        setStreamText(null);
        setSending(false);
        sendingRef.current = false;
        setMessages((m) => [
          ...m,
          { id: `err-${Date.now()}`, role: "assistant", content: message },
        ]);
      },
      // An agent-initiated message outside any user turn (a schedule_followup
      // reminder). When it carries the thread id it was already persisted
      // server-side — reload so it renders in place and survives refresh.
      onProactive: (_message, conversationId) => {
        if (conversationId) {
          loadThread().catch(() => {});
        } else {
          setMessages((m) => [
            ...m,
            { id: `proactive-${Date.now()}`, role: "assistant", content: _message },
          ]);
        }
      },
      onStatusChange: (status) => {
        // A mid-turn disconnect would otherwise leave the spinner forever.
        if (status === "closed" && wsTurnRef.current) {
          wsTurnRef.current = false;
          setStreamText(null);
          setSending(false);
          sendingRef.current = false;
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

  // Hoisted function declaration so useVoice (above) and the seed effect (below)
  // can both reference it without a temporal-dead-zone problem.
  async function handleSend(overrideText?: string) {
    const text = (overrideText ?? input).trim();
    if (!text || sendingRef.current) return;

    const optimistic: Message = { id: `local-${Date.now()}`, role: "user", content: text };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");
    setSending(true);
    sendingRef.current = true;

    // Flag-on path: stream the turn over the WebSocket to the user's AppAgent
    // (#192). Falls through to the POST path whenever the socket isn't open
    // (flag off, pre-connect window, prod before the agents Worker route is
    // live, or a reconnect in progress) — the POST path stays the universal
    // fallback. onDone/onError reset sending + reload the canonical thread.
    if (wsEnabled && enabled && agentHandleRef.current?.ready()) {
      const ok = agentHandleRef.current.send({ conversationId: "coomander", message: text });
      if (ok) {
        wsTurnRef.current = true;
        setStreamText("");
        return;
      }
    }

    try {
      const res = await fetch("/api/coomander/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      if (!res.ok) throw new Error(`chat turn failed: ${res.status}`);
      const data = (await res.json()) as { reply: string; acted: boolean };

      setMessages((prev) => [
        ...prev,
        { id: `reply-${Date.now()}`, role: "assistant", content: data.reply, acted: data.acted },
      ]);

      if (audioEnabled && data.reply) {
        speak(data.reply).catch(() => {});
      }
    } catch (err) {
      console.error("[Coomander chat]", err);
      toast.error("Coomander couldn't respond. Try again.");
      // Roll back the optimistic user bubble so the thread stays truthful.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(text);
    } finally {
      setSending(false);
      sendingRef.current = false;
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

      {/* WebSocket transport bridge (#192) — mounted only when the
          coomander-agents-chat flag is on AND ops is enabled. This is the only
          thing that ever opens the agent WebSocket; flag-off users never load
          it and the POST /api/coomander/chat path is unchanged. */}
      {wsEnabled && enabled && !loading && (
        <AgentChatBridge callbacks={agentCallbacks} onHandle={setAgentHandle} />
      )}

      {/* Composer */}
      <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
        <form
          onSubmit={(e) => { e.preventDefault(); void handleSend(); }}
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
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void handleSend(); } }}
            placeholder={voiceState === "listening" ? "Listening…" : "Message Coomander…"}
            disabled={isDisabled}
            rows={1}
            className="flex-1 resize-none border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 rounded-xl px-3 py-2 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50 max-h-[150px]"
          />

          <button
            type="submit"
            disabled={isDisabled || !input.trim()}
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
