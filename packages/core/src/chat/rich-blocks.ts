/**
 * Rich chat blocks — inline, non-markdown content the assistant can embed in a
 * reply. The model emits a JSON-carrying marker on its own:
 *
 *   [CHART:{"type":"bar","labels":["Jan","Feb"],"series":[{"name":"x","data":[1,2]}]}]
 *   [IMAGE:{"key":"ai-images/<id>.png","alt":"a mountain at sunrise"}]
 *
 * This module is the SINGLE shared parser/stripper, used on every surface so
 * they can't drift:
 *
 *   - Web render (chat-message.tsx): parse into text + block segments; render
 *     each block via a ChatBlock dispatcher.
 *   - Agents worker (persist + `done` frame): KEEP block markers (so charts /
 *     images survive persistence and re-render on reload) while stripping the
 *     [PROFILE:]/[STEP_*:] backend "system tags".
 *   - Mobile + TTS + user-message echo: strip EVERYTHING (no block renderer).
 *
 * Why a hand-written scanner and not a regex: a chart payload contains `]`
 * inside its data arrays (`"data":[1,2]`), so a naive `\[[A-Z_]+:[^\]]+\]`
 * regex mis-terminates at the first inner `]`. The scanner brace-balances the
 * JSON object (string-literal aware) and only then looks for the closing `]`.
 *
 * Pure + env-free: no DOM, no Node, no Workers APIs — safe in the browser, in
 * workerd (the agents worker), and in React Native (Expo).
 */

/** The closed set of rich-block marker prefixes. */
export const BLOCK_MARKER_PREFIXES = ["CHART", "IMAGE"] as const;
export type BlockType = "chart" | "image";

const PREFIX_TO_TYPE: Record<string, BlockType> = { CHART: "chart", IMAGE: "image" };

/** A system tag like `[PROFILE:key=value]` or `[STEP_DONE:x]` — stripped, never rendered. */
const SYSTEM_TAG_REGEX = /\[[A-Z_]+:[^\]]*\]/g;

const OPEN_RE = /\[(CHART|IMAGE):/;

export type RichSegment =
  | { kind: "text"; text: string }
  | { kind: "block"; type: BlockType; raw: string; json: string };

/**
 * Given the index of the first non-space char after `[CHART:` / `[IMAGE:`,
 * return the index of the marker's closing `]`, or -1 if the JSON object is
 * absent / unbalanced (e.g. a still-streaming partial marker).
 */
function findBlockClose(s: string, jsonStart: number): number {
  let j = jsonStart;
  while (j < s.length && /\s/.test(s[j]!)) j++;
  if (s[j] !== "{") return -1;
  // Bound the forward scan: a real chart/image payload is tiny (<2 KB), so cap
  // the search window. This stops adversarial unclosed markers from making the
  // overall parse O(n²) — an opener whose object isn't closed within the window
  // is simply treated as text.
  const maxEnd = Math.min(s.length, j + 16384);
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; j < maxEnd; j++) {
    const c = s[j]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        let k = j + 1;
        while (k < s.length && /\s/.test(s[k]!)) k++;
        return s[k] === "]" ? k : -1;
      }
    }
  }
  return -1;
}

/**
 * Split assistant text into ordered text + rich-block segments. Block markers
 * are returned verbatim (`raw`) plus their inner JSON (`json`); everything else
 * is text. An incomplete / malformed marker is left as ordinary text (the
 * caller hides a still-streaming trailing one via `stripTrailingPartialMarker`).
 */
export function parseRichSegments(input: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let i = 0;
  let textStart = 0;
  while (i < input.length) {
    if (input[i] === "[") {
      const m = OPEN_RE.exec(input.slice(i, i + 8));
      if (m) {
        const jsonStart = i + m[0].length;
        const close = findBlockClose(input, jsonStart);
        if (close !== -1) {
          if (i > textStart) segments.push({ kind: "text", text: input.slice(textStart, i) });
          segments.push({
            kind: "block",
            type: PREFIX_TO_TYPE[m[1]!]!,
            raw: input.slice(i, close + 1),
            json: input.slice(jsonStart, close + 1 - 1).trim(),
          });
          i = close + 1;
          textStart = i;
          continue;
        }
      }
    }
    i++;
  }
  if (textStart < input.length) segments.push({ kind: "text", text: input.slice(textStart) });
  return segments;
}

/**
 * While streaming, an unfinished `[CHART:{"ty` tail must not flash as raw text.
 * If the string ends with an unclosed block marker, trim from that marker on.
 */
export function stripTrailingPartialMarker(text: string): string {
  const chart = text.lastIndexOf("[CHART:");
  const image = text.lastIndexOf("[IMAGE:");
  const idx = Math.max(chart, image);
  if (idx === -1) return text;
  const m = OPEN_RE.exec(text.slice(idx, idx + 8));
  if (!m) return text;
  // Complete marker already? then nothing to suppress.
  if (findBlockClose(text, idx + m[0].length) !== -1) return text;
  return text.slice(0, idx);
}

/**
 * Strip backend "system tags" ([PROFILE:]/[STEP_*:]/etc.) but PRESERVE
 * [CHART:]/[IMAGE:] block markers. Used server-side for persistence + the
 * `done` frame, and for each text segment at render time.
 */
export function stripSystemTags(text: string): string {
  return parseRichSegments(text)
    .map((seg) => (seg.kind === "block" ? seg.raw : seg.text.replace(SYSTEM_TAG_REGEX, "")))
    .join("");
}

/**
 * Strip EVERYTHING — block markers and system tags — collapsing whitespace.
 * Used where there is no block renderer: user-message echo, mobile chat, TTS.
 */
export function stripAllTags(text: string): string {
  return parseRichSegments(text)
    .filter((seg): seg is Extract<RichSegment, { kind: "text" }> => seg.kind === "text")
    .map((seg) => seg.text.replace(SYSTEM_TAG_REGEX, ""))
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
