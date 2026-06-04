/**
 * Coomander Anthropic token-usage logging (#151, skeleton).
 *
 * Milestone 1 ships only the insert helper; nothing calls it yet (no Anthropic
 * turn until the persona prompt + classifier land). It exists now so the
 * write-path is stable for the milestones that add real model calls. The full
 * cost-attribution math from geology's usage.ts (per-model rate table, cache
 * buckets, monthly rollups) is intentionally deferred — `coomander_usage` only
 * records raw token counts per the #151 schema.
 *
 * Best-effort: a logging failure must NEVER break a user-facing Coomander turn,
 * so every error is swallowed.
 */

import crypto from "crypto";
import { getDb } from "@/lib/db";
import { coomanderUsage } from "@/lib/schema";
import { log } from "@/lib/logger";

/** The call sites usage is attributed to. */
export type CoomanderSlot = "morning" | "midday" | "evening" | "check" | "inbound";

/**
 * Record one Anthropic response's raw token usage for a user. Never throws.
 *
 * @param userId        The user the spend is attributed to.
 * @param slotOrInbound Which call site produced it.
 * @param model         The Anthropic model id used.
 * @param inputTokens   usage.input_tokens (defaults to 0 if absent).
 * @param outputTokens  usage.output_tokens (defaults to 0 if absent).
 */
export async function logCoomanderUsage(
  userId: string,
  slotOrInbound: CoomanderSlot,
  model: string,
  inputTokens: number | null | undefined,
  outputTokens: number | null | undefined,
): Promise<void> {
  if (!userId) return;
  try {
    const db = getDb();
    await db.insert(coomanderUsage).values({
      id: crypto.randomUUID(),
      user_id: userId,
      slot_or_inbound: slotOrInbound,
      input_tokens: nonNeg(inputTokens),
      output_tokens: nonNeg(outputTokens),
      model,
      created_at: Math.floor(Date.now() / 1000),
    });
  } catch (e) {
    log.error("[coomander/usage] failed to persist token usage", {
      error: e instanceof Error ? e.message : String(e),
      userId,
      slotOrInbound,
      model,
    });
  }
}

function nonNeg(n: number | null | undefined): number {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
}
