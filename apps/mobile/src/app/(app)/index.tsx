import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Keyboard,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Feather, Ionicons } from "@expo/vector-icons";
import * as Speech from "expo-speech";
import { useRouter } from "expo-router";

import { getThread, type CoomanderMessage } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { Screen } from "@/components/screen";
import { ApiError } from "@coomander/core";
import {
  useAgentSocket,
  type SocketStatus,
} from "@/lib/use-agent-socket";
import {
  reduce,
  resetTurn,
  initialStreamState,
  COOMANDER_CONVERSATION_ID,
  type ServerFrame,
  type StreamState,
} from "@/lib/agent-socket-protocol";

// How long to wait for the WebSocket to open before surfacing an error to the
// user (the socket auto-connects on mount and reconnects with backoff; this just
// bounds a single send so a turn is never silently dropped).
const SOCKET_READY_TIMEOUT_MS = 8000;

// ---------------------------------------------------------------------------
// Tag stripping (matches the web's stripTags)
// ---------------------------------------------------------------------------

function stripTags(text: string): string {
  return text.replace(/\[TAG:\w+=[^\]]+\]/g, "").trim();
}

// ---------------------------------------------------------------------------
// Simple markdown-ish renderer for React Native (ported from geology)
// ---------------------------------------------------------------------------

function MessageText({
  content,
  colors,
  isUser,
}: {
  content: string;
  colors: ReturnType<typeof useTheme>["colors"];
  isUser: boolean;
}) {
  const textColor = isUser ? "#fff" : colors.foreground;
  const lines = stripTags(content).split("\n");

  return (
    <View>
      {lines.map((line, i) => {
        // Headings
        const headingMatch = line.match(/^(#{1,3})\s+(.+)/);
        if (headingMatch) {
          const level = headingMatch[1].length;
          return (
            <Text
              key={i}
              style={[
                styles.msgText,
                { color: textColor, fontWeight: "700", fontSize: 18 - level * 2 },
                i > 0 && { marginTop: 8 },
              ]}
            >
              {headingMatch[2]}
            </Text>
          );
        }

        // Bullet points
        if (line.match(/^\s*[-*•]\s/)) {
          return (
            <Text key={i} style={[styles.msgText, { color: textColor }]}>
              {"  •  "}
              {formatInline(line.replace(/^\s*[-*•]\s+/, ""), textColor)}
            </Text>
          );
        }

        // Numbered lists
        const numMatch = line.match(/^\s*(\d+)\.\s+(.+)/);
        if (numMatch) {
          return (
            <Text key={i} style={[styles.msgText, { color: textColor }]}>
              {"  "}
              {numMatch[1]}. {formatInline(numMatch[2], textColor)}
            </Text>
          );
        }

        // Code fences — skip the fence lines
        if (line.startsWith("```")) {
          return null;
        }

        // Empty lines
        if (line.trim() === "") {
          return <View key={i} style={{ height: 8 }} />;
        }

        // Regular text with inline formatting
        return (
          <Text key={i} style={[styles.msgText, { color: textColor }]}>
            {formatInline(line, textColor)}
          </Text>
        );
      })}
    </View>
  );
}

/** Apply inline bold/code formatting. */
function formatInline(text: string, color: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <Text key={i} style={{ fontWeight: "700", color }}>
          {part.slice(2, -2)}
        </Text>
      );
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return (
        <Text
          key={i}
          style={{
            fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
            color,
            fontSize: 13,
          }}
        >
          {part.slice(1, -1)}
        </Text>
      );
    }
    return part;
  });
}

// ---------------------------------------------------------------------------
// Main chat screen — the Coomander agent
// ---------------------------------------------------------------------------

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

let tmpSeq = 0;
function tmpId(prefix: string): string {
  tmpSeq += 1;
  return `${prefix}-${Date.now()}-${tmpSeq}`;
}

export default function CoomanderChatScreen() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const flatListRef = useRef<FlatList<UIMessage>>(null);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  // ── Agents-worker WebSocket transport — the SINGLE chat transport (#203) ──
  // The socket always connects on mount (no flag gate, no POST/SSE fallback).
  // `stream` is the live WebSocket turn state (folded from server frames via the
  // pure `reduce`); wsTurnRef marks a turn in flight so a mid-turn drop cleans up
  // the optimistic bubble + spinner and restores the input. wsResolveRef resolves
  // the in-flight send promise on done/error/close.
  const [stream, setStream] = useState<StreamState>(initialStreamState);
  const wsTurnRef = useRef<{ userMsgId: string; text: string } | null>(null);
  const wsResolveRef = useRef<(() => void) | null>(null);
  const proactiveProcessedRef = useRef(0);

  // Reload the canonical unified thread (real ids, ordering, tool side effects).
  // Used on mount and after a WS turn finishes / a persisted proactive arrives.
  const loadThread = useCallback(async () => {
    const thread = await getThread();
    setEnabled(thread.enabled);
    setMessages(
      thread.messages.map((m: CoomanderMessage) => ({
        id: m.id,
        role: m.role,
        content: m.content,
      })),
    );
  }, []);

  // ── Load the unified thread on mount ──────────────────────────────────
  useEffect(() => {
    let active = true;
    loadThread()
      .catch((e) => {
        if (!active) return;
        setError(
          e instanceof ApiError ? e.message : "Couldn't load your conversation.",
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [loadThread]);

  // Fold every server frame into the pure stream state. The effects below react
  // to the resulting `done` / `error` / `proactive` transitions.
  const onFrame = useCallback((frame: ServerFrame) => {
    setStream((s) => reduce(s, frame));
  }, []);

  const onStatusChange = useCallback((status: SocketStatus) => {
    // A mid-turn disconnect would otherwise leave the spinner forever. Roll back
    // the optimistic bubble, restore the input so the user can retry, reset the
    // stream, and show the reconnecting message — the turn is never silently
    // dropped (#203, WS-only — no SSE fallback).
    if (status === "closed" && wsTurnRef.current) {
      const { userMsgId, text } = wsTurnRef.current;
      wsTurnRef.current = null;
      setThinking(false);
      setStream(resetTurn);
      setMessages((prev) => prev.filter((m) => m.id !== userMsgId));
      setInput((cur) => (cur.length === 0 ? text : cur));
      setError("Chat is reconnecting — please try again in a moment.");
      wsResolveRef.current?.();
      wsResolveRef.current = null;
    }
  }, []);

  const { ready, send } = useAgentSocket({
    onFrame,
    onStatusChange,
  });

  // First streamed token means the model is producing — drop the "Thinking…" bar.
  useEffect(() => {
    if (stream.streamingText) setThinking(false);
  }, [stream.streamingText]);

  // Turn finished: reload the canonical thread, then drop the live bubble. The
  // bubble shows finalText until the reload replaces it → no flicker. wsTurnRef
  // is cleared synchronously so a post-done close isn't mistaken for a drop.
  useEffect(() => {
    if (!stream.done) return;
    wsTurnRef.current = null;
    setThinking(false);
    wsResolveRef.current?.();
    wsResolveRef.current = null;
    let active = true;
    (async () => {
      await loadThread().catch(() => {});
      if (active) setStream(resetTurn);
    })();
    return () => {
      active = false;
    };
  }, [stream.done, loadThread]);

  // Error frame: surface it, keep the optimistic user bubble, clear the stream.
  useEffect(() => {
    if (!stream.error) return;
    setError(stream.error);
    setThinking(false);
    wsTurnRef.current = null;
    setStream(resetTurn);
    wsResolveRef.current?.();
    wsResolveRef.current = null;
  }, [stream.error]);

  // Proactive (agent-initiated) messages. Persisted ones (carry a
  // conversationId) are already in the thread server-side → reload to render in
  // place; standalone ones are appended directly. A processed-index ref drains
  // the append-only queue exactly once.
  useEffect(() => {
    if (stream.proactive.length <= proactiveProcessedRef.current) return;
    const fresh = stream.proactive.slice(proactiveProcessedRef.current);
    proactiveProcessedRef.current = stream.proactive.length;
    if (fresh.some((p) => p.conversationId)) {
      loadThread().catch(() => {});
    }
    const standalone = fresh.filter((p) => !p.conversationId);
    if (standalone.length > 0) {
      setMessages((prev) => [
        ...prev,
        ...standalone.map((p) => ({
          id: tmpId("proactive"),
          role: "assistant" as const,
          content: p.message,
        })),
      ]);
    }
  }, [stream.proactive, loadThread]);

  // ── Auto-scroll to the bottom on new content ──────────────────────────
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length, thinking]);

  /**
   * Resolve once the WebSocket is open, or reject after a timeout. The socket
   * auto-connects on mount and reconnects with backoff, so a "not ready yet"
   * state is usually transient — we poll briefly rather than dropping the turn.
   * Mirrors the web client's `waitForSocket`.
   */
  function waitForSocket(timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (ready()) {
        resolve();
        return;
      }
      const start = Date.now();
      const interval = setInterval(() => {
        if (ready()) {
          clearInterval(interval);
          resolve();
        } else if (Date.now() - start >= timeoutMs) {
          clearInterval(interval);
          reject(new Error("socket-not-ready"));
        }
      }, 100);
    });
  }

  // ── Send one chat turn over the agents WebSocket (#203) ───────────────────
  // The agent WebSocket is the SINGLE chat transport — the POST/SSE fallback was
  // removed. The agent owns conversation persistence (the same unified thread as
  // web + Telegram); we render the user turn optimistically and the live assistant
  // bubble streams from `stream` (rendered in the FlatList footer). onFrame folds
  // frames into `stream`; the effects above reload the canonical thread on done /
  // surface errors. If the socket isn't open we await readiness (~8s poll); on
  // timeout or a send-time drop we roll back the optimistic bubble, restore the
  // input, and show the reconnecting message — the turn is never silently dropped.
  async function handleSend() {
    const text = input.trim();
    if (!text || thinking) return;

    Keyboard.dismiss();
    setInput("");
    setError(null);

    // Optimistic user bubble (the assistant bubble streams from `stream`).
    const wsUserMsg: UIMessage = { id: tmpId("u"), role: "user", content: text };
    setMessages((prev) => [...prev, wsUserMsg]);
    setStream(resetTurn);
    setThinking(true);

    // Roll back the optimistic bubble + restore input so the user can retry.
    const rollback = () => {
      wsTurnRef.current = null;
      setThinking(false);
      setMessages((prev) => prev.filter((m) => m.id !== wsUserMsg.id));
      setInput((cur) => (cur.length === 0 ? text : cur));
    };

    // Await socket readiness rather than falling back to a (now-removed) SSE path.
    try {
      await waitForSocket(SOCKET_READY_TIMEOUT_MS);
    } catch {
      console.error("[CoomanderChat] socket not ready — chat unavailable");
      rollback();
      setError("Chat is reconnecting — please try again in a moment.");
      return;
    }

    // The send promise resolves when a done/error/close transition fires (the
    // effects + onStatusChange above set wsResolveRef and reset thinking/stream).
    try {
      await new Promise<void>((resolve) => {
        wsResolveRef.current = resolve;
        const ok = send({ conversationId: COOMANDER_CONVERSATION_ID, message: text });
        if (ok) {
          wsTurnRef.current = { userMsgId: wsUserMsg.id, text };
        } else {
          // Socket dropped between the readiness check and the send — bail cleanly.
          wsResolveRef.current = null;
          rollback();
          setError("Chat is reconnecting — please try again in a moment.");
          resolve();
        }
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Message failed to send.");
      setThinking(false);
    }
  }

  // ── TTS (expo-speech, ported from geology) ────────────────────────────
  function speakMessage(id: string, content: string) {
    if (speakingId === id) {
      Speech.stop();
      setSpeakingId(null);
      return;
    }
    Speech.stop();
    setSpeakingId(id);
    Speech.speak(stripTags(content), {
      language: "en-US",
      onDone: () => setSpeakingId(null),
      onStopped: () => setSpeakingId(null),
      onError: () => setSpeakingId(null),
    });
  }

  // ── Render a single message bubble ────────────────────────────────────
  const renderMessage = useCallback(
    ({ item }: { item: UIMessage }) => {
      const isUser = item.role === "user";
      return (
        <View
          style={[styles.msgRow, isUser ? styles.msgRowUser : styles.msgRowAssistant]}
        >
          <View
            style={[
              styles.msgBubble,
              isUser
                ? [styles.msgBubbleUser, { backgroundColor: colors.primary }]
                : [
                    styles.msgBubbleAssistant,
                    { backgroundColor: colors.card, borderColor: colors.border },
                  ],
            ]}
          >
            <MessageText content={item.content} colors={colors} isUser={isUser} />
          </View>
          {!isUser && item.content ? (
            <Pressable
              onPress={() => speakMessage(item.id, item.content)}
              hitSlop={8}
              style={styles.speakBtn}
              accessibilityLabel={speakingId === item.id ? "Stop reading" : "Read aloud"}
            >
              <Ionicons
                name={speakingId === item.id ? "stop-circle" : "volume-medium"}
                size={16}
                color={colors.mutedForeground}
              />
            </Pressable>
          ) : null}
        </View>
      );
    },
    [colors, speakingId],
  );

  // The in-progress WebSocket assistant bubble: streamingText while tokens
  // arrive, then finalText for the brief window before the canonical reload
  // replaces it (no flicker). Null when no WS turn is streaming.
  const wsLiveText = stream.streamingText ?? stream.finalText;

  return (
    <Screen>
      {/* Header — brand + sign out */}
      <View
        style={[
          styles.header,
          { backgroundColor: colors.card, borderBottomColor: colors.border },
        ]}
      >
        <View style={styles.brand}>
          <Ionicons name="sparkles" size={20} color={colors.primary} />
          <Text style={[styles.brandName, { color: colors.foreground }]}>Coomander</Text>
        </View>
        <Pressable
          onPress={() => router.push("/settings")}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Settings"
        >
          <Feather name="settings" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
        {/* Messages / loading / empty */}
        {loading ? (
          <View style={styles.empty}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="chatbubbles-outline" size={48} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              Talk to Coomander
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              {enabled
                ? "Ask a question or tell Coomander what to do — it's one conversation across web, phone, and Telegram."
                : "Ops isn't enabled on your account yet, but you can still chat."}
            </Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={renderMessage}
            contentContainerStyle={styles.msgList}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() =>
              flatListRef.current?.scrollToEnd({ animated: true })
            }
            ListFooterComponent={
              wsLiveText && wsLiveText.length > 0 ? (
                <View style={[styles.msgRow, styles.msgRowAssistant]}>
                  <View
                    style={[
                      styles.msgBubble,
                      styles.msgBubbleAssistant,
                      { backgroundColor: colors.card, borderColor: colors.border },
                    ]}
                  >
                    <MessageText content={wsLiveText} colors={colors} isUser={false} />
                  </View>
                </View>
              ) : null
            }
          />
        )}

        {/* Thinking indicator — POST in flight, or WS turn before its first token. */}
        {thinking && !wsLiveText ? (
          <View style={[styles.typingBar, { borderTopColor: colors.border }]}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.typingText, { color: colors.mutedForeground }]}>
              Thinking…
            </Text>
          </View>
        ) : null}

        {/* Inline error */}
        {error ? (
          <View style={[styles.errorBar, { backgroundColor: colors.destructive + "18" }]}>
            <Feather name="alert-circle" size={14} color={colors.destructive} />
            <Text style={[styles.errorText, { color: colors.destructive }]}>{error}</Text>
          </View>
        ) : null}

        {/* Input bar */}
        <View
          style={[
            styles.inputBar,
            {
              backgroundColor: colors.card,
              borderTopColor: colors.border,
              paddingBottom: Math.max(insets.bottom, 8),
            },
          ]}
        >
          <TextInput
            style={[
              styles.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.input,
                color: colors.foreground,
              },
            ]}
            placeholder="Message Coomander…"
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={setInput}
            multiline
            maxLength={4000}
            editable={!thinking}
            returnKeyType="default"
          />
          <Pressable
            onPress={handleSend}
            disabled={thinking || !input.trim()}
            style={[
              styles.sendBtn,
              {
                backgroundColor: colors.primary,
                opacity: thinking || !input.trim() ? 0.5 : 1,
              },
            ]}
            accessibilityLabel="Send message"
          >
            <Feather name="send" size={18} color="#fff" />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

// ---------------------------------------------------------------------------
// Styles (ported from geology's chat screen)
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  fill: { flex: 1 },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandName: { fontSize: 17, fontWeight: "700" },

  // Empty / loading state
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: "600" },
  emptyBody: { fontSize: 14, textAlign: "center", lineHeight: 20 },

  // Messages
  msgList: { paddingVertical: 12, paddingHorizontal: 12 },
  msgRow: { marginBottom: 8 },
  msgRowUser: { alignItems: "flex-end" },
  msgRowAssistant: { alignItems: "flex-start" },
  msgBubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, maxWidth: "85%" },
  msgBubbleUser: { borderBottomRightRadius: 4 },
  msgBubbleAssistant: { borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  msgText: { fontSize: 15, lineHeight: 22 },
  speakBtn: { marginTop: 4, marginLeft: 4 },

  // Typing indicator
  typingBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  typingText: { fontSize: 13 },

  // Error bar
  errorBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: { fontSize: 13, flex: 1 },

  // Input bar
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 15,
    maxHeight: 120,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
});
