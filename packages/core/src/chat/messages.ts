/**
 * Provider-neutral chat message shaping shared by both chat engines (web SSE +
 * agent WebSocket) — epic #483. Two concerns live here:
 *
 *   1. `applyContextWindow` — model-aware context trimming sized to the entry's
 *      `contextWindow` (so a small Workers AI window can't overflow).
 *   2. `buildModelMessages` — capability-gated multimodal message building:
 *      images/PDFs are only included when the model supports them, otherwise a
 *      visible text note replaces them; text files are decoded to text.
 *
 * ## Why this is in @coomander/core
 * Both engines must gate attachments and trim context identically — otherwise
 * switching transports (SSE ↔ WS) would change behaviour. The logic is pure, so
 * it moves here verbatim. The pieces that are NOT pure stay per-worker:
 *   - provider-client wiring (createAnthropic / createWorkersAI, env access)
 *   - office-document parsing (mammoth/xlsx/officeparser need Node libs that
 *     don't run in workerd) — passed in via the optional `parseOffice` hook so
 *     the web app keeps full parsing while the agent degrades to a text note.
 *
 * ## Platform constraints (enforced by packages/core/tsconfig.json)
 * No `process.env`, no Node `Buffer`, no DOM. Base64 is decoded with the
 * universally-available `atob` + `Uint8Array` + `TextDecoder` instead of
 * `Buffer.from(b64, "base64")`.
 *
 * The returned message parts are structurally identical to the Vercel AI SDK's
 * `ModelMessage` text/image/file parts, so each engine casts the result to
 * `ModelMessage[]` and hands it straight to `streamText` — core never imports
 * `ai` (keeping the package free of a heavy, runtime-specific dependency).
 */

import type { ModelCatalogEntry } from "./model-catalog";

/**
 * A chat message as the chat ENGINES see it (a history turn + optional
 * attachments). Distinct from the API/DB `ChatMessage` in `schemas/chat.ts`
 * (which has `id`/`created_at`/`attachments_meta`) — this is the in-flight shape
 * fed to the model, hence the `Engine` qualifier to avoid a name clash.
 */
export interface ChatEngineMessage {
  role: "user" | "assistant";
  content: string;
  attachments?: Array<{
    name: string;
    type: string;
    size: number;
    data: string; // base64 (no data: prefix)
  }>;
}

/**
 * A single content part — a structural subset of the AI SDK `ModelMessage`
 * content-part union (text | image | file). Both engines cast `ModelMessageLike`
 * to `ModelMessage` at the `streamText` call site.
 */
export type ModelPart =
  | { type: "text"; text: string }
  | { type: "image"; image: string; mediaType: string }
  | { type: "file"; data: string; mediaType: string; filename?: string };

/** A built model message — `content` is either plain text or a parts array. */
export interface ModelMessageLike {
  role: "user" | "assistant";
  content: string | ModelPart[];
}

/**
 * Decode a base64 string to UTF-8 text using Web APIs only (no Node Buffer).
 * `atob` yields a binary string (one char per byte); we widen each char code to
 * a byte and let TextDecoder interpret the bytes as UTF-8.
 */
function base64ToUtf8(b64: string): string {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * True if the attachment is an office document (docx/xlsx/pptx/xls). Detection
 * by extension first (most reliable), then MIME type — browser `File.type` is
 * frequently empty or inconsistent for office docs. Mirrors the web's
 * `document-parser.isOfficeDocument` so gating is identical.
 */
export function isOfficeDocument(name: string, type: string): boolean {
  const lower = name.toLowerCase();
  if (/\.(xlsx|xls|docx|pptx)$/.test(lower)) return true;
  return (
    type.includes("spreadsheetml") ||
    type === "application/vnd.ms-excel" ||
    type.includes("wordprocessingml") ||
    type.includes("presentationml")
  );
}

/**
 * Rough token estimate for context trimming: ~4 chars/token (a reasonable
 * cross-model heuristic for English prose). Deliberately conservative — we'd
 * rather trim slightly early than overflow a small Workers AI window.
 */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Model-aware context trimming. Keeps the most recent messages that fit within
 * the model's context window (reserving room for the system prompt + the
 * response), and summarizes the older ones into a single leading message.
 *
 * @param maxOutputTokens reserved response headroom (the engine's max tokens).
 */
export function applyContextWindow(
  messages: ChatEngineMessage[],
  entry: ModelCatalogEntry,
  systemPrompt: string = "",
  maxOutputTokens: number = 1024,
): ChatEngineMessage[] {
  if (messages.length === 0) return messages;

  // Budget for conversation = context window − system prompt − response headroom.
  const systemTokens = estimateTokens(systemPrompt);
  // Keep a safety margin so the estimate's slack doesn't push us over.
  const budget = Math.max(
    1000,
    entry.contextWindow - systemTokens - maxOutputTokens - 512,
  );

  // Walk from the newest message backwards, accumulating until we'd exceed budget.
  const recent: ChatEngineMessage[] = [];
  let used = 0;
  let cutoff = 0; // number of older messages to summarize
  for (let i = messages.length - 1; i >= 0; i--) {
    const cost = estimateTokens(messages[i].content) + 8; // +overhead per message
    if (used + cost > budget && recent.length > 0) {
      cutoff = i + 1;
      break;
    }
    used += cost;
    recent.unshift(messages[i]);
  }

  // Everything fit (or only one huge message remains) — nothing to summarize.
  if (recent.length === messages.length) return messages;

  const older = messages.slice(0, cutoff);
  if (older.length === 0) return recent;

  const summaryParts: string[] = [];
  for (const msg of older) {
    const role = msg.role === "user" ? "User" : "Assistant";
    const preview = msg.content.slice(0, 200);
    summaryParts.push(`${role}: ${preview}${msg.content.length > 200 ? "..." : ""}`);
  }
  const summaryMessage: ChatEngineMessage = {
    role: "user",
    content: `[Conversation context - ${older.length} earlier messages summarized]\n${summaryParts.join("\n")}`,
  };

  return [summaryMessage, ...recent];
}

/** Options for {@link buildModelMessages}. */
export interface BuildModelMessagesOptions {
  /**
   * Optional office-document → text parser. Pure core can't parse OOXML (needs
   * Node libs), so the web app injects its `parseOfficeDocument` here for full
   * fidelity; the agent omits it and office docs degrade to a clear text note.
   */
  parseOffice?: (name: string, type: string, base64: string) => Promise<string>;
}

/**
 * Convert {@link ChatEngineMessage}s to provider-neutral {@link ModelMessageLike}s,
 * gating attachment types by the model's catalog capabilities:
 *   - images   → image part only when `entry.supportsImages`, else a text note
 *   - PDFs     → file part only when `entry.supportsPdf`, else a text note
 *   - office   → parsed to text via `opts.parseOffice` when provided, else a
 *                clear "omitted on this transport" note (agent / no parser)
 *   - other    → decoded to text
 * Attachments are never silently dropped and never crash the turn.
 *
 * Async because office docs are parsed to text first (when a parser is given).
 */
export async function buildModelMessages(
  messages: ChatEngineMessage[],
  entry: ModelCatalogEntry,
  opts: BuildModelMessagesOptions = {},
): Promise<ModelMessageLike[]> {
  return Promise.all(
    messages.map(async (msg): Promise<ModelMessageLike> => {
      if (msg.role === "user" && msg.attachments?.length) {
        const parts: ModelPart[] = [];

        for (const att of msg.attachments) {
          if (att.type === "application/pdf") {
            if (entry.supportsPdf) {
              parts.push({
                type: "file",
                data: att.data,
                mediaType: "application/pdf",
                filename: att.name,
              });
            } else {
              parts.push({
                type: "text",
                text: `[Attachment "${att.name}" omitted — the selected model "${entry.label}" can't read PDFs; switch to a Claude model for PDF analysis.]`,
              });
            }
          } else if (att.type.startsWith("image/")) {
            if (entry.supportsImages) {
              parts.push({ type: "image", image: att.data, mediaType: att.type });
            } else {
              parts.push({
                type: "text",
                text: `[Attachment "${att.name}" omitted — the selected model "${entry.label}" can't read images; switch to a vision-capable model to analyze this image.]`,
              });
            }
          } else if (isOfficeDocument(att.name, att.type)) {
            if (opts.parseOffice) {
              // Office docs are ZIP/OOXML archives — parse to text rather than
              // sending raw bytes. Degrade gracefully if a file is corrupt so a
              // single bad attachment doesn't fail the whole chat request.
              let text: string;
              try {
                text = await opts.parseOffice(att.name, att.type, att.data);
              } catch (error) {
                text = `(could not be parsed: ${
                  error instanceof Error ? error.message : "unknown error"
                })`;
              }
              parts.push({ type: "text", text: `[File: ${att.name}]\n${text}` });
            } else {
              // No parser injected (agent / workerd path): OOXML parsing needs
              // Node libs that don't run here, so degrade to a visible note.
              parts.push({
                type: "text",
                text: `[Attachment "${att.name}" received but office-document parsing is not available on this chat transport. Ask the user to paste the relevant text, or re-upload as a PDF or plain-text file.]`,
              });
            }
          } else {
            // Text-based files included as text (Web-API base64 decode).
            const text = base64ToUtf8(att.data);
            parts.push({ type: "text", text: `[File: ${att.name}]\n${text}` });
          }
        }

        if (msg.content.trim()) {
          parts.push({ type: "text", text: msg.content });
        }

        return { role: "user", content: parts };
      }

      return { role: msg.role, content: msg.content };
    }),
  );
}
