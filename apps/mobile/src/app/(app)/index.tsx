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

import { getThread, sendMessage, type CoomanderMessage } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { useTheme } from "@/lib/theme";
import { Screen } from "@/components/screen";
import { ApiError } from "@coomander/core";

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
  const flatListRef = useRef<FlatList<UIMessage>>(null);

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [thinking, setThinking] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [speakingId, setSpeakingId] = useState<string | null>(null);

  // ── Load the unified thread on mount ──────────────────────────────────
  useEffect(() => {
    let active = true;
    getThread()
      .then((thread) => {
        if (!active) return;
        setEnabled(thread.enabled);
        setMessages(
          thread.messages.map((m: CoomanderMessage) => ({
            id: m.id,
            role: m.role,
            content: m.content,
          })),
        );
      })
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
  }, []);

  // ── Auto-scroll to the bottom on new content ──────────────────────────
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messages.length, thinking]);

  // ── Send one chat turn (request/response, no streaming) ───────────────
  async function handleSend() {
    const text = input.trim();
    if (!text || thinking) return;

    Keyboard.dismiss();
    setInput("");
    setError(null);

    // Optimistic user bubble.
    const userMsg: UIMessage = { id: tmpId("u"), role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setThinking(true);

    try {
      const { reply } = await sendMessage(text);
      setMessages((prev) => [
        ...prev,
        { id: tmpId("a"), role: "assistant", content: reply },
      ]);
    } catch (e) {
      // Surface an inline error and roll the optimistic message back so the
      // user can retry their text.
      setMessages((prev) => prev.filter((m) => m.id !== userMsg.id));
      setInput(text);
      setError(e instanceof ApiError ? e.message : "Message failed to send.");
    } finally {
      setThinking(false);
    }
  }

  // ── Sign out ──────────────────────────────────────────────────────────
  function signOut() {
    Speech.stop();
    authClient.signOut();
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
          onPress={signOut}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Feather name="log-out" size={20} color={colors.mutedForeground} />
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.fill}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
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
          />
        )}

        {/* Thinking indicator (no streaming — POST is in flight) */}
        {thinking ? (
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
