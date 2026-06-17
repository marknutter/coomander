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
  getTimezone,
  userToday,
  type NagFrequency,
  type PersonaMode,
} from "./settings";
import { getDayState, markSlotSent } from "./scheduling";
import { appendMessage } from "./coomanderMessages";
import { logCoomanderUsage } from "./usage";
import { getTodayModel, type TodayModel } from "./todayModel";
import { expectedToday } from "./ramp";
import { daysBetween, toDateLocal } from "./consistency";
import { getDb } from "@/lib/db";
import { user as userT, coomanderSettings as settingsT } from "@/lib/schema";
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

/** Days since the user's ops account was seeded (drives the Day 1-6 ramp). */
export async function daysSinceStart(userId: string, today: string): Promise<number> {
  const db = getDb();
  const rows = (await db.select({ seeded: settingsT.ops_seeded_at }).from(settingsT).where(eq(settingsT.user_id, userId)).limit(1)) as Array<{ seeded: number | null }>;
  const seeded = rows[0]?.seeded;
  if (!seeded) return Number.MAX_SAFE_INTEGER; // not in ramp
  // Seed date in the creator's local tz so the ramp counter aligns with their
  // local "today" (#183).
  const seededDate = toDateLocal(seeded, await getTimezone(userId));
  return Math.max(0, daysBetween(seededDate, today));
}

/**
 * Render the TodayModel into a compact state context for the prompt. Reel
 * expectations honor the Day 1-6 ramp via expectedToday().
 */
export function renderContext(model: TodayModel, daysIn: number): string {
  const lines: string[] = [`Date: ${model.date}. Overall: ${model.overall_state}.${model.day_quality === "bad" ? " (bad day)" : ""}`];
  for (const p of model.pillars) {
    for (const tb of p.beats) {
      const exp = expectedToday(tb.beat, daysIn);
      if (tb.buffer_status) {
        lines.push(`- ${tb.beat.name}: wall buffer ${tb.buffer_status.current_days}/${tb.buffer_status.goal_days}d (${tb.status})`);
      } else if (tb.window_progress) {
        lines.push(`- ${tb.beat.name}: ${Math.round(tb.window_progress.completion * 100)}% of window, ${tb.window_progress.days_remaining}d left (${tb.status})`);
      } else {
        lines.push(`- ${tb.beat.name}: ${tb.actual_today}/${exp} today (${tb.status})${tb.streak_days ? `, ${tb.streak_days}d streak` : ""}`);
      }
    }
  }
  lines.push(`Content cushion: ${model.content_cushion_days} days. Pipeline: ${model.content_pipeline.approved} approved, ${model.content_pipeline.scheduled} scheduled, ${model.content_pipeline.shipped_today} shipped today.`);
  const proc = [...model.procurement_urgent.shoot_prep, ...model.procurement_urgent.business_admin];
  if (proc.length) lines.push(`Urgent procurement: ${proc.map((i) => i.label).join(", ")}.`);
  return lines.join("\n");
}

/** Generate the message text via Anthropic. Logs usage best-effort. */
async function generateMessage(
  userId: string,
  slot: Slot,
  personaMode: PersonaMode,
  ctx: string,
): Promise<string> {
  const client = new Anthropic();
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: [{ type: "text", text: coomanderSystem(personaMode), cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: slotPrompt(slot, ctx, personaMode) }],
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
    const date = await userToday(userId);
    const day = await getDayState(userId, date);
    const plan = planPing({ slot, nagFrequency: settings.nagFrequency, dayQuality: day?.day_quality ?? null });
    if (!plan.send) return { ok: true, slot, sent: false, skipped: plan.reason };

    // Ground the message in the live TodayModel (ramp-aware) per #153.
    const model = await getTodayModel(userId, date);
    const ctx = renderContext(model, await daysSinceStart(userId, date));
    const message = await generateMessage(userId, slot, settings.personaMode, ctx);
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
