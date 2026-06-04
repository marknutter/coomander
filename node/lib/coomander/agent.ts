/**
 * Coomander ping loop (#151).
 *
 * `planPing` is a PURE, side-effect-free decision: given a slot, the user's nag
 * preset, and (optionally) the day's quality, it decides whether to fire and
 * why. No Anthropic, no Telegram, no DB — fully unit-testable.
 *
 * `runAgentPing` is the orchestration: resolve settings + chat id, plan, and on
 * a "send" decision generate the message via Anthropic, send it to Telegram,
 * persist it to the no-TTL log, stamp the day_state, and record token usage. It
 * never throws — it returns a status object so the cron route always answers.
 *
 * Ported from ~/Code/geology/web/node/lib/geology/agent.ts, with geology's
 * vein/carve domain logic removed (Coomander's domain model is #152): the
 * suppression rules here are nag-preset based, not vein-activity based.
 */

import Anthropic from "@anthropic-ai/sdk";
import { sendTelegram } from "./telegram";
import { coomanderSystem, slotPrompt, type Slot } from "./agentPrompts";
import {
  getCoomanderSettings,
  type NagFrequency,
  type PersonaMode,
} from "./settings";
import { getDayState, markSlotSent, todayUTC } from "./scheduling";
import { appendMessage } from "./coomanderMessages";
import { logCoomanderUsage } from "./usage";
import { getDb } from "@/lib/db";
import { user as userT } from "@/lib/schema";
import { eq } from "drizzle-orm";

const MODEL = process.env.COOMANDER_AGENT_MODEL || process.env.CHAT_MODEL || "claude-sonnet-4-6";

/** Which slots each nag preset is allowed to fire. */
export const PRESET_SLOTS: Record<NagFrequency, Slot[]> = {
  tight: ["morning", "midday", "check", "evening"],
  moderate: ["morning", "midday", "evening"],
  light: ["morning", "evening"],
};

export interface PlanPingInput {
  slot: Slot;
  nagFrequency: NagFrequency;
  /** Day quality from day_state; "bad" suppresses the midday/check touchpoints. */
  dayQuality?: "good" | "bad" | null;
}

export interface PingPlan {
  send: boolean;
  reason?: string;
}

/**
 * Pure decision: should we ping for this slot, given the user's nag preset?
 *
 * Rules (see docs/strategy/coomander-direction.md § Nag frequency):
 *   - The slot must be in the preset's allowed set (light = morning+evening,
 *     moderate = morning+midday+evening, tight = all four incl. the extra check).
 *   - On a "bad" day the midday and check touchpoints are suppressed (morning
 *     and evening anchors still fire).
 */
export function planPing(input: PlanPingInput): PingPlan {
  const allowed = PRESET_SLOTS[input.nagFrequency] ?? PRESET_SLOTS.tight;
  if (!allowed.includes(input.slot)) {
    return { send: false, reason: `${input.slot} is not in the '${input.nagFrequency}' preset` };
  }
  if ((input.slot === "midday" || input.slot === "check") && input.dayQuality === "bad") {
    return { send: false, reason: "bad-day mode: midday/check suppressed" };
  }
  return { send: true };
}

export interface AgentRunResult {
  ok: boolean;
  slot: Slot;
  sent: boolean;
  skipped?: string;
  message?: string;
  error?: string;
}

/** Resolve the user's Telegram chat id from the user row. */
async function chatIdFor(userId: string): Promise<string | null> {
  const db = getDb();
  const rows = (await db
    .select({ chatId: userT.telegramChatId })
    .from(userT)
    .where(eq(userT.id, userId))
    .limit(1)) as Array<{ chatId: string | null }>;
  return rows[0]?.chatId ?? null;
}

/** Generate the message text via Anthropic. Logs usage best-effort. */
async function generateMessage(
  userId: string,
  slot: Slot,
  personaMode: PersonaMode,
): Promise<string> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: [{ type: "text", text: coomanderSystem(personaMode), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: slotPrompt(slot, personaMode) }],
  });
  await logCoomanderUsage(userId, slot, MODEL, msg.usage?.input_tokens, msg.usage?.output_tokens);
  return msg.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

/**
 * Run the ping for one user + slot. Never throws.
 */
export async function runAgentPing(userId: string, slot: Slot): Promise<AgentRunResult> {
  try {
    const chatId = await chatIdFor(userId);
    if (!chatId) return { ok: true, slot, sent: false, skipped: "no telegram chat id" };

    const settings = await getCoomanderSettings(userId);
    const date = todayUTC();
    const day = await getDayState(userId, date);
    const plan = planPing({ slot, nagFrequency: settings.nagFrequency, dayQuality: day?.day_quality ?? null });
    if (!plan.send) return { ok: true, slot, sent: false, skipped: plan.reason };

    const message = await generateMessage(userId, slot, settings.personaMode);
    if (!message) return { ok: false, slot, sent: false, error: "empty message from model" };

    const res = await sendTelegram(chatId, message);
    if (!res.ok) return { ok: false, slot, sent: false, message, error: res.error };

    // Persist + stamp are best-effort: a logging hiccup must not fail the send.
    await appendMessage(userId, "outbound", message, { personaMode: settings.personaMode }).catch(() => {});
    await markSlotSent(userId, slot, date).catch(() => {});
    return { ok: true, slot, sent: true, message };
  } catch (e) {
    return { ok: false, slot, sent: false, error: (e as Error).message };
  }
}
