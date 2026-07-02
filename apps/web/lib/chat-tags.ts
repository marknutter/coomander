/**
 * Extensible tag extraction from AI responses.
 *
 * The AI can include tags like [TAG:key=value] in responses.
 * These are parsed server-side, processed by registered handlers,
 * and stripped from the displayed response.
 *
 * Usage:
 *   registerTagHandler("PROFILE", async (key, value, userId) => {
 *     await saveProfileField(userId, key, value);
 *   });
 *
 *   const { cleanText, extracted } = await extractAndProcessTags(text, userId);
 */

export type TagHandler = (key: string, value: string, userId: string) => Promise<void>;

const tagHandlers = new Map<string, TagHandler>();

/**
 * Register a handler for a tag prefix.
 * e.g., registerTagHandler("PROFILE", handler) handles [PROFILE:key=value]
 */
export function registerTagHandler(prefix: string, handler: TagHandler): void {
  tagHandlers.set(prefix.toUpperCase(), handler);
}

/**
 * Extract tags from text, call handlers, and return cleaned text.
 */
export async function extractAndProcessTags(
  text: string,
  userId: string
): Promise<{ cleanText: string; extracted: Array<{ prefix: string; key: string; value: string }> }> {
  const tagRegex = /\[([A-Z_]+):([^\]=]+)=([^\]]+)\]/g;
  const extracted: Array<{ prefix: string; key: string; value: string }> = [];

  let match;
  while ((match = tagRegex.exec(text)) !== null) {
    const [, prefix, key, value] = match;
    extracted.push({ prefix, key, value: value.trim() });
  }

  // Process handlers
  for (const tag of extracted) {
    const handler = tagHandlers.get(tag.prefix);
    if (handler) {
      try {
        await handler(tag.key, tag.value, userId);
      } catch (err) {
        console.error(`[chat-tags] Handler error for ${tag.prefix}:${tag.key}:`, err);
      }
    }
  }

  // Strip all tags from displayed text
  const cleanText = text.replace(/\[[A-Z_]+:[^\]]+\]/g, "").trim();

  return { cleanText, extracted };
}

/**
 * Strip backend system tags ([PROFILE:]/[STEP_*:]) for display, but PRESERVE
 * [CHART:]/[IMAGE:] rich-block markers so inline charts/images render while a
 * reply streams and after reload. Delegates to the single shared
 * implementation in @coomander/core. (Use `stripAllTags` from @coomander/core
 * where blocks must also go — user-message echo, mobile, TTS.)
 */
export { stripSystemTags as stripTags } from "@coomander/core";
