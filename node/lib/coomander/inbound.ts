/**
 * Inbound Telegram message handling for Coomander (#151).
 *
 * The creator replies to Coomander in plain language; we classify the message
 * with Anthropic tool-use. For the V1 infra landing the ONLY tool is the
 * placeholder `need_clarification`, so the full classify → resolve → persist
 * pipeline is exercisable end-to-end. The real domain tools (log_drop,
 * log_purchase, mark_blocker, add_procurement, ...) are domain-specific and
 * land with #152 — swap them into `tools()` then.
 *
 * The Anthropic call (classifyMessage) is isolated from the pure resolution of
 * its result (resolveToolUse), so the matching logic is unit-testable without
 * the network.
 *
 * Ported/simplified from ~/Code/geology/web/node/lib/geology/inbound.ts.
 */

import Anthropic from "@anthropic-ai/sdk";
import { logCoomanderUsage } from "./usage";
import type { PersonaMode } from "./settings";

const MODEL = process.env.COOMANDER_AGENT_MODEL || process.env.CHAT_MODEL || "claude-sonnet-4-6";

export const CLARIFY_TOOL = "need_clarification";

/** Generic fallback when the model returns no usable tool call. */
const FALLBACK_REPLY =
  "Got it. I can not action that yet, but I logged it. Once your content tracking is wired up I will be able to do more with messages like this.";

export interface ClassifiedTool {
  toolName: string;
  input: Record<string, unknown>;
}

export type InboundAction = { action: "clarify"; reply: string };

export interface InboundResult {
  reply: string;
  /** The raw tool call, persisted alongside the inbound message for the substrate. */
  toolCall: ClassifiedTool | null;
}

function tools(): Anthropic.Tool[] {
  return [
    {
      // PLACEHOLDER — the only tool until #152's domain tools land.
      name: CLARIFY_TOOL,
      description:
        "Acknowledge the creator's message and, if useful, ask one short clarifying question. This is the ONLY action available right now: Coomander cannot yet log drops, purchases, blockers, or procurement items (those domain tools arrive later). Always call this tool.",
      input_schema: {
        type: "object",
        properties: {
          reply: {
            type: "string",
            description: "A short, warm one or two sentence reply back to the creator. No em-dashes.",
          },
        },
        required: ["reply"],
      },
    },
  ];
}

function systemPrompt(personaMode: PersonaMode): string {
  return `You are Coomander, the AI operations manager inside MaddieHQ (an OnlyFans creator app). The creator just sent you a Telegram message. ${
    personaMode === "operational" ? "Be terse and practical." : "Be warm, direct, and a little tongue-in-cheek."
  }

You cannot take any operational action yet (content tracking is not wired up), so always call need_clarification with a short, friendly reply that acknowledges what she said. Do not invent metrics, posts, or fan details. Never use em-dashes.`;
}

/**
 * Pure resolution of a forced tool call. No network, no DB. Returns the action
 * the caller acts on.
 */
export function resolveToolUse(toolName: string, input: Record<string, unknown>): InboundAction {
  if (toolName === CLARIFY_TOOL) {
    const reply = typeof input.reply === "string" && input.reply.trim() ? input.reply.trim() : FALLBACK_REPLY;
    return { action: "clarify", reply };
  }
  return { action: "clarify", reply: FALLBACK_REPLY };
}

/** Force the model to choose a tool. Isolated so handleInbound stays testable. */
async function classifyMessage(
  userId: string,
  text: string,
  personaMode: PersonaMode,
): Promise<ClassifiedTool | null> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    system: [{ type: "text", text: systemPrompt(personaMode), cache_control: { type: "ephemeral" } }],
    tool_choice: { type: "any" },
    tools: tools(),
    messages: [{ role: "user", content: text }],
  });
  await logCoomanderUsage(userId, "inbound", MODEL, msg.usage?.input_tokens, msg.usage?.output_tokens);
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) return null;
  return { toolName: block.name, input: (block.input ?? {}) as Record<string, unknown> };
}

/**
 * Full inbound flow: classify the message and resolve it to a reply. Returns the
 * reply plus the raw tool call so the webhook can persist both. Throws only on
 * unexpected failures; the webhook wraps this and still answers Telegram.
 */
export async function handleInbound(
  userId: string,
  text: string,
  personaMode: PersonaMode = "light_companion",
): Promise<InboundResult> {
  const classified = await classifyMessage(userId, text, personaMode);
  if (!classified) return { reply: FALLBACK_REPLY, toolCall: null };
  const resolved = resolveToolUse(classified.toolName, classified.input);
  return { reply: resolved.reply, toolCall: classified };
}
