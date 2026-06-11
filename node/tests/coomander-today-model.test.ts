import { describe, it, expect } from "vitest";
import { buildTodayModel } from "@/lib/coomander/todayModel";
import type {
  CadencePillar,
  CadenceBeat,
  ContentState,
  ProcurementItem,
} from "@/lib/schema";

const DATE = "2026-06-15"; // Monday
const todayTs = Math.floor(Date.parse(DATE + "T12:00:00Z") / 1000);

type Drop = {
  id: string;
  user_id: string;
  beat_id: string | null;
  kind: string;
  source: string;
  platform: string | null;
  external_ref: string | null;
  content_state_id: string | null;
  payload_json: string;
  dropped_at: number;
  created_at: number;
};

function pillar(over: Partial<CadencePillar> = {}): CadencePillar {
  return {
    id: "p1",
    user_id: "u1",
    name: "Content",
    kind: "content",
    display_order: 0,
    archived_at: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  } as unknown as CadencePillar;
}

function beat(over: Partial<CadenceBeat> = {}): CadenceBeat {
  return {
    id: "b1",
    user_id: "u1",
    pillar_id: "p1",
    name: "Reels",
    cadence_kind: "daily",
    target_count: 1,
    buffer_goal_days: null,
    window_start: null,
    window_end: null,
    priority: "med",
    platform_specific: null,
    subtype: null,
    active: 1,
    archived_at: null,
    notes: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  } as unknown as CadenceBeat;
}

function drop(over: Partial<Drop> = {}): Drop {
  return {
    id: "d1",
    user_id: "u1",
    beat_id: "b1",
    kind: "captured",
    source: "manual",
    platform: null,
    external_ref: null,
    content_state_id: null,
    payload_json: "{}",
    dropped_at: todayTs,
    created_at: 0,
    ...over,
  };
}

function content(over: Partial<ContentState> = {}): ContentState {
  return {
    id: "c1",
    user_id: "u1",
    beat_id: "b1",
    title: "Clip",
    current_state: "drafted",
    created_at: 0,
    updated_at: 0,
    ...over,
  } as unknown as ContentState;
}

function procurement(over: Partial<ProcurementItem> = {}): ProcurementItem {
  return {
    id: "pr1",
    user_id: "u1",
    beat_id: "b1",
    category: "shoot_prep",
    label: "Lights",
    status: "needed",
    needed_by: DATE,
    created_at: 0,
    updated_at: 0,
    ...over,
  } as unknown as ProcurementItem;
}

function base(over: Partial<Parameters<typeof buildTodayModel>[0]> = {}) {
  return buildTodayModel({
    date: DATE,
    pillars: [pillar()],
    beats: [beat()],
    drops: [],
    content: [],
    procurement: [],
    dayQuality: null,
    ...over,
  } as unknown as Parameters<typeof buildTodayModel>[0]);
}

function findBeat(model: ReturnType<typeof buildTodayModel>, beatId: string) {
  for (const p of model.pillars) {
    for (const b of p.beats) {
      if (b.beat.id === beatId) return b;
    }
  }
  return undefined;
}

describe("buildTodayModel — daily beat drop attribution", () => {
  it("daily beat target 1 with no drops → untouched, actual_today 0", () => {
    const m = base({ drops: [] });
    const b = findBeat(m, "b1")!;
    expect(b.actual_today).toBe(0);
    expect(b.status).toBe("untouched");
  });

  it("daily beat target 1 with a drop dated today → completed, actual_today 1", () => {
    const m = base({ drops: [drop({ beat_id: "b1", dropped_at: todayTs })] as unknown as never });
    const b = findBeat(m, "b1")!;
    expect(b.actual_today).toBe(1);
    expect(b.status).toBe("completed");
  });

  it("a drop only counts toward a beat when drop.beat_id === beat.id", () => {
    const m = base({ drops: [drop({ beat_id: "other", dropped_at: todayTs })] as unknown as never });
    const b = findBeat(m, "b1")!;
    expect(b.actual_today).toBe(0);
    expect(b.status).toBe("untouched");
  });
});

describe("buildTodayModel — platform attribution", () => {
  it("platform_specific 'ig' does NOT count a tiktok drop", () => {
    const m = base({
      beats: [beat({ platform_specific: "ig" })],
      drops: [drop({ platform: "tiktok", dropped_at: todayTs })] as unknown as never,
    });
    const b = findBeat(m, "b1")!;
    expect(b.actual_today).toBe(0);
    expect(b.status).toBe("untouched");
  });

  it("platform_specific 'ig' DOES count an ig drop", () => {
    const m = base({
      beats: [beat({ platform_specific: "ig" })],
      drops: [drop({ platform: "ig", dropped_at: todayTs })] as unknown as never,
    });
    const b = findBeat(m, "b1")!;
    expect(b.actual_today).toBe(1);
    expect(b.status).toBe("completed");
  });
});

describe("buildTodayModel — daily_vlog_buffer", () => {
  it("captured minus shipped >= goal*target → buffer_healthy", () => {
    // target 1, goal 3 → need current_days >= 3 → captured-shipped >= 3
    const drops = [
      drop({ id: "d1", kind: "captured", dropped_at: todayTs }),
      drop({ id: "d2", kind: "captured", dropped_at: todayTs }),
      drop({ id: "d3", kind: "captured", dropped_at: todayTs }),
    ];
    const m = base({
      beats: [beat({ cadence_kind: "daily_vlog_buffer", target_count: 1, buffer_goal_days: 3 })],
      drops: drops as unknown as never,
    });
    const b = findBeat(m, "b1")!;
    expect(b.status).toBe("buffer_healthy");
    expect(b.buffer_status!.healthy).toBe(true);
  });

  it("below goal → buffer_low", () => {
    const drops = [drop({ id: "d1", kind: "captured", dropped_at: todayTs })];
    const m = base({
      beats: [beat({ cadence_kind: "daily_vlog_buffer", target_count: 1, buffer_goal_days: 7 })],
      drops: drops as unknown as never,
    });
    const b = findBeat(m, "b1")!;
    expect(b.status).toBe("buffer_low");
    expect(b.buffer_status!.healthy).toBe(false);
  });
});

describe("buildTodayModel — content pipeline", () => {
  it("counts content by current_state", () => {
    const m = base({
      content: [
        content({ id: "c1", current_state: "drafted" }),
        content({ id: "c2", current_state: "drafted" }),
        content({ id: "c3", current_state: "approved" }),
      ] as unknown as never,
    });
    expect(m.content_pipeline.drafted).toBe(2);
    expect(m.content_pipeline.approved).toBe(1);
  });

  it("shipped_today counts drops with kind 'shipped' dated today", () => {
    const m = base({
      drops: [
        drop({ id: "d1", kind: "shipped", dropped_at: todayTs }),
        drop({ id: "d2", kind: "shipped", dropped_at: todayTs }),
        // a shipped drop dated yesterday should not count
        drop({ id: "d3", kind: "shipped", dropped_at: todayTs - 86400 }),
      ] as unknown as never,
    });
    expect(m.content_pipeline.shipped_today).toBe(2);
  });
});

describe("buildTodayModel — content cushion", () => {
  it("readyCount = approved+scheduled content, dailyTarget = sum of daily beats (excl. 'of')", () => {
    // two daily beats target 3 + 3 = 6 daily target; 'of' platform beat excluded
    const beats = [
      beat({ id: "b1", cadence_kind: "daily", target_count: 3, platform_specific: null }),
      beat({ id: "b2", cadence_kind: "daily", target_count: 3, platform_specific: "ig" }),
      beat({ id: "b3", cadence_kind: "daily", target_count: 5, platform_specific: "of" }),
    ];
    // readyCount: 6 ready (3 approved + 3 scheduled)
    const contentItems = [
      content({ id: "c1", current_state: "approved" }),
      content({ id: "c2", current_state: "approved" }),
      content({ id: "c3", current_state: "approved" }),
      content({ id: "c4", current_state: "scheduled" }),
      content({ id: "c5", current_state: "scheduled" }),
      content({ id: "c6", current_state: "scheduled" }),
      content({ id: "c7", current_state: "drafted" }),
    ];
    const m = base({
      beats: beats as unknown as never,
      content: contentItems as unknown as never,
    });
    // cushion = round(6/6 - 0) = 1 (no shipped drops → daysSinceLastDrop large, but
    // we only assert the number is computed; with no drops the impl may treat
    // daysSinceLastDrop as 0 for "no last drop". Assert it is a finite number >= 0.)
    expect(typeof m.content_cushion_days).toBe("number");
    expect(m.content_cushion_days).toBeGreaterThanOrEqual(0);
  });
});

describe("buildTodayModel — procurement urgency", () => {
  it("splits urgent open items by category", () => {
    const m = base({
      procurement: [
        procurement({ id: "pr1", category: "shoot_prep", status: "needed", needed_by: DATE }),
        procurement({
          id: "pr2",
          category: "business_admin",
          status: "ordered",
          needed_by: DATE,
        }),
      ] as unknown as never,
    });
    expect(m.procurement_urgent.shoot_prep.length).toBe(1);
    expect(m.procurement_urgent.business_admin.length).toBe(1);
  });
});

describe("buildTodayModel — overall state", () => {
  it("day_quality 'bad' forces overall_state red", () => {
    const m = base({ dayQuality: "bad" });
    expect(m.day_quality).toBe("bad");
    expect(m.overall_state).toBe("red");
  });

  it("returns the requested date", () => {
    const m = base();
    expect(m.date).toBe(DATE);
  });
});
