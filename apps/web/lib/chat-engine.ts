/**
 * Core AI chat engine using Anthropic Claude.
 *
 * Provides streaming chat with context window management.
 * Domain-agnostic — customize via chat-config.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { CHAT_CONFIG, buildSystemPrompt } from "./chat-config";
import { extractAndProcessTags } from "./chat-tags";

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    _client = new Anthropic();
  }
  return _client;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{
    name: string;
    type: string;
    size: number;
    data: string; // base64
  }>;
}

/**
 * Build Anthropic message params from chat messages.
 * Converts attachments to proper content blocks.
 */
function buildMessageParams(
  messages: ChatMessage[]
): Anthropic.MessageParam[] {
  return messages.map((msg) => {
    if (msg.role === "user" && msg.attachments?.length) {
      const contentBlocks: Anthropic.ContentBlockParam[] = [];

      for (const att of msg.attachments) {
        if (att.type === "application/pdf") {
          contentBlocks.push({
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: att.data,
            },
          });
        } else if (att.type.startsWith("image/")) {
          const mediaType = att.type as "image/jpeg" | "image/png" | "image/gif" | "image/webp";
          contentBlocks.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: att.data,
            },
          });
        } else {
          // Text-based files included as text blocks
          const text = Buffer.from(att.data, "base64").toString("utf-8");
          contentBlocks.push({
            type: "text",
            text: `[File: ${att.name}]\n${text}`,
          });
        }
      }

      // Add the user's text message
      if (msg.content.trim()) {
        contentBlocks.push({ type: "text", text: msg.content });
      }

      return { role: "user" as const, content: contentBlocks };
    }

    return { role: msg.role, content: msg.content };
  });
}

/**
 * Apply context window: keep last N messages, summarize older ones.
 */
function applyContextWindow(messages: ChatMessage[]): ChatMessage[] {
  const maxRecent = CHAT_CONFIG.contextWindowSize;

  if (messages.length <= maxRecent) {
    return messages;
  }

  const older = messages.slice(0, messages.length - maxRecent);
  const recent = messages.slice(messages.length - maxRecent);

  // Build a summary of older messages
  const summaryParts: string[] = [];
  for (const msg of older) {
    const role = msg.role === "user" ? "User" : "Assistant";
    const preview = msg.content.slice(0, 200);
    summaryParts.push(`${role}: ${preview}${msg.content.length > 200 ? "..." : ""}`);
  }

  const summaryMessage: ChatMessage = {
    role: "user",
    content: `[Conversation context - ${older.length} earlier messages summarized]\n${summaryParts.join("\n")}`,
  };

  return [summaryMessage, ...recent];
}

export interface StreamCallbacks {
  onToken: (text: string) => void;
  onDone: (fullText: string) => void;
  onError: (error: Error) => void;
}

/**
 * Stream a chat response from Claude.
 *
 * @param messages - Conversation history
 * @param userId - For tag processing
 * @param userContext - Optional context injected into system prompt
 * @param callbacks - Streaming callbacks
 */
export async function streamChat(
  messages: ChatMessage[],
  userId: string,
  userContext: string = "",
  callbacks: StreamCallbacks
): Promise<void> {
  const client = getClient();
  const systemPrompt = buildSystemPrompt(userContext);
  const contextMessages = applyContextWindow(messages);
  const messageParams = buildMessageParams(contextMessages);

  let fullText = "";

  try {
    const stream = client.messages.stream({
      model: CHAT_CONFIG.model,
      max_tokens: CHAT_CONFIG.maxTokens,
      system: systemPrompt,
      messages: messageParams,
    });

    stream.on("text", (text) => {
      fullText += text;
      callbacks.onToken(text);
    });

    await stream.finalMessage();

    // Post-process: extract tags
    const { cleanText } = await extractAndProcessTags(fullText, userId);

    callbacks.onDone(cleanText);
  } catch (error) {
    callbacks.onError(error as Error);
  }
}
