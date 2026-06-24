import { describe, expect, it } from "vitest";
import { isTodayPlanQuestion, todayPlanReply } from "@/lib/coomander/inbound";
import type { TodayModel } from "@/lib/coomander/todayModel";
import type { CadenceBeat, ProcurementItem } from "@/lib/schema";

function beat(name: string, subtype: string | null = null): CadenceBeat {
  return {
    id: name.toLowerCase().replaceAll(" ", "-"),
    name,
    cadence_kind: "daily",
    target_count: 3,
    subtype,
  } as CadenceBeat;
}

function model(): TodayModel {
  return {
    date: "2026-06-24",
    pillars: [
      {
        pillar: { id: "content", name: "Content" } as never,
        beats: [
          {
            beat: beat("Normal reel", "normal_reel"),
            expected_today: 3,
            actual_today: 1,
            status: "behind",
          },
          {
            beat: {
              ...beat("Daily-vlog wall capture"),
              cadence_kind: "daily_vlog_buffer",
            },
            expected_today: 0,
            actual_today: 0,
            buffer_status: { current_days: 0, goal_days: 3, healthy: false },
            status: "buffer_low",
          },
        ],
      },
    ],
    content_pipeline: {
      drafted: 0,
      shot: 0,
      approved: 0,
      uploaded_to_edit: 0,
      edited: 0,
      scheduled: 0,
      shipped: 0,
      shipped_today: 0,
    },
    content_cushion_days: 1,
    procurement_urgent: {
      shoot_prep: [
        {
          label: "ring light",
          needed_by: "2026-06-25",
        } as ProcurementItem,
      ],
      business_admin: [],
    },
    day_quality: null,
    overall_state: "red",
  };
}

describe("Telegram today-plan questions", () => {
  it.each([
    "What do I need to get done today?",
    "What should I focus on today?",
    "What's on my plate today?",
    "What is the plan for today?",
  ])("recognizes %s", (text) => {
    expect(isTodayPlanQuestion(text)).toBe(true);
  });

  it("does not intercept execution updates", () => {
    expect(isTodayPlanQuestion("Posted the gym reel")).toBe(false);
    expect(isTodayPlanQuestion("I need a ring light")).toBe(false);
  });

  it("answers from ramp-aware cadence, buffers, and urgent procurement", () => {
    expect(todayPlanReply(model(), 2)).toBe(
      "Today: Normal reel: 2 remaining; Daily-vlog wall capture: build the buffer (0/3 days); Get ring light by 2026-06-25. Content cushion: 1 day.",
    );
  });
});
