/**
 * Day 1-6 onboarding ramp (#153).
 *
 * A brand new account ramps reels gradually before the steady-state weekly
 * target kicks in (validated from creator research). `expectedToday` is PURE
 * (beat + daysSinceStart only) so it unit-tests directly, and it is what the
 * agent prompt uses to tell the creator "here's what's on the table today".
 *
 *   Day 1: 1 normal reel
 *   Day 2: 2 normal           Day 4: 3 normal + 1 trial
 *   Day 3: 3 normal           Day 5: 3 normal + 2 trial
 *                             Day 6: 3 normal + 3 trial
 *   Day 7+: steady-state weekly math.
 *
 * daysSinceStart is 0-indexed (day 1 of the account = 0).
 */

import type { CadenceBeat } from "@/lib/schema";

export const RAMP_DAYS = 6;

/** Index by daysSinceStart (0..5). */
export const NORMAL_REEL_RAMP = [1, 2, 3, 3, 3, 3];
export const TRIAL_REEL_RAMP = [0, 0, 0, 1, 2, 3];

/** Whether the ramp is still active for an account this old. */
export function inRamp(daysSinceStart: number): boolean {
  return daysSinceStart >= 0 && daysSinceStart < RAMP_DAYS;
}

/** Steady-state per-day expectation by cadence kind (post-ramp). */
function steadyExpected(beat: Pick<CadenceBeat, "cadence_kind" | "target_count">): number {
  switch (beat.cadence_kind) {
    case "daily":
      return beat.target_count;
    case "weekly":
      return Math.round(beat.target_count / 7);
    case "window":
    case "daily_vlog_buffer":
    default:
      return 0; // window pacing / buffer are not per-day targets
  }
}

/**
 * Expected drops *today* for a beat, ramp-aware. During the first 6 days the
 * reel beats follow the ramp (keyed off subtype normal_reel / trial_reel);
 * everything else, and all beats after day 6, use steady-state math.
 */
export function expectedToday(
  beat: Pick<CadenceBeat, "cadence_kind" | "target_count" | "subtype">,
  daysSinceStart: number,
): number {
  if (inRamp(daysSinceStart)) {
    if (beat.subtype === "normal_reel") return NORMAL_REEL_RAMP[daysSinceStart];
    if (beat.subtype === "trial_reel") return TRIAL_REEL_RAMP[daysSinceStart];
  }
  return steadyExpected(beat);
}
