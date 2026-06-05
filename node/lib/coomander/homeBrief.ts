/**
 * Home brief (#170, epic #168) — the deterministic "what's on the table today"
 * that the agent-first home (`/app`) leads with.
 *
 * This is the same grounding the Telegram ping and in-app chat use (the live
 * TodayModel + the Day 1-6 ramp via `expectedToday`), distilled into a compact,
 * render-ready shape. It is PURE (`buildHomeBrief`) so it unit-tests without a
 * DB; `getHomeBrief` does the reads. No Anthropic call — the home must load
 * instantly and never 500, even with no ops data.
 */

import type { BeatStatus } from "./beats";
import type { TodayModel } from "./todayModel";
import { getTodayModel } from "./todayModel";
import { daysSinceStart } from "./agent";
import { expectedToday, inRamp, RAMP_DAYS } from "./ramp";
import { todayUTC } from "./scheduling";

export interface HomeBeatLine {
  beatId: string;
  name: string;
  pillar: string;
  expectedToday: number;
  actualToday: number;
  status: BeatStatus;
  /** Human detail for buffer/window beats (e.g. "wall buffer 2/3d"). */
  detail?: string;
}

export interface HomeBrief {
  date: string;
  /** 1-indexed account age; null once past the ramp (steady state). */
  rampDay: number | null;
  inRamp: boolean;
  overallState: "green" | "yellow" | "red";
  dayQuality: "good" | "bad" | null;
  contentCushionDays: number;
  shippedToday: number;
  /** A short, deterministic agent-voice headline. */
  headline: string;
  /** Beats that want attention today, most-urgent first. */
  onTheTable: HomeBeatLine[];
  urgentProcurement: string[];
}

const ATTENTION: BeatStatus[] = ["behind", "untouched", "buffer_low"];

/** Rank for sorting "on the table" — needs-attention + high priority first. */
function urgency(line: HomeBeatLine, priority: string): number {
  const behind = ATTENTION.includes(line.status) ? 0 : 1;
  const high = priority === "high" ? 0 : 1;
  return behind * 2 + high;
}

export function buildHomeBrief(model: TodayModel, daysIn: number): HomeBrief {
  const ramping = inRamp(daysIn);
  const rampDay = ramping ? daysIn + 1 : null;

  const lines: Array<HomeBeatLine & { _priority: string }> = [];
  for (const p of model.pillars) {
    for (const tb of p.beats) {
      const exp = expectedToday(tb.beat, daysIn);
      let detail: string | undefined;
      if (tb.buffer_status) {
        detail = `wall buffer ${tb.buffer_status.current_days}/${tb.buffer_status.goal_days}d`;
      } else if (tb.window_progress) {
        detail = `${Math.round(tb.window_progress.completion * 100)}% of window, ${tb.window_progress.days_remaining}d left`;
      }

      const needsAttention = ATTENTION.includes(tb.status);
      // Surface a beat if it expects work today, or it's actively behind.
      if (exp <= 0 && !needsAttention && !tb.buffer_status && !tb.window_progress) continue;

      lines.push({
        beatId: tb.beat.id,
        name: tb.beat.name,
        pillar: p.pillar.name,
        expectedToday: exp,
        actualToday: tb.actual_today,
        status: tb.status,
        detail,
        _priority: tb.beat.priority,
      });
    }
  }

  lines.sort((a, b) => urgency(a, a._priority) - urgency(b, b._priority));
  const onTheTable: HomeBeatLine[] = lines.map(({ _priority, ...l }) => { void _priority; return l; });

  const urgentProcurement = [
    ...model.procurement_urgent.shoot_prep,
    ...model.procurement_urgent.business_admin,
  ].map((i) => i.label);

  return {
    date: model.date,
    rampDay,
    inRamp: ramping,
    overallState: model.overall_state,
    dayQuality: model.day_quality,
    contentCushionDays: model.content_cushion_days,
    shippedToday: model.content_pipeline.shipped_today,
    headline: headlineFor(model, ramping, rampDay),
    onTheTable,
    urgentProcurement,
  };
}

/** Deterministic agent-voice headline keyed off overall state + ramp. */
function headlineFor(
  model: TodayModel,
  ramping: boolean,
  rampDay: number | null,
): string {
  if (ramping && rampDay != null) {
    return `Day ${rampDay} of ${RAMP_DAYS} — we're ramping you up. Here's today's table.`;
  }
  if (model.day_quality === "bad") {
    return "Rough day flagged — let's keep it light and just protect the anchors.";
  }
  switch (model.overall_state) {
    case "red":
      return "A few things slipped — let's catch up on what matters most.";
    case "yellow":
      return "Solid shape. A couple of things want attention today.";
    case "green":
    default:
      return model.content_pipeline.shipped_today > 0
        ? "On track and already shipping today. Keep the momentum."
        : "You're on track. Let's keep the streak going.";
  }
}

export async function getHomeBrief(userId: string, date?: string): Promise<HomeBrief> {
  const d = date ?? todayUTC();
  const [model, daysIn] = await Promise.all([
    getTodayModel(userId, d),
    daysSinceStart(userId, d),
  ]);
  return buildHomeBrief(model, daysIn);
}
