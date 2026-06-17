import { describe, it, expect } from "vitest";
import {
  DEFAULT_TIMEZONE,
  todayLocal,
  toDateLocal,
  toDateUTC,
} from "@/lib/coomander/consistency";
import { pickTimezone, getTimezone, userToday } from "@/lib/coomander/settings";
import { buildTodayModel } from "@/lib/coomander/todayModel";
import type { CadencePillar, CadenceBeat } from "@/lib/schema";
import { getRawDb } from "@/lib/db";
// Importing the db helper bootstraps the Better Auth `user` table schema.
import "./helpers/db";

const unix = (iso: string) => Math.floor(Date.parse(iso) / 1000);

// ── 1. toDateLocal / todayLocal day-boundary semantics ───────────────────────
describe("toDateLocal / todayLocal — local day boundary (#183)", () => {
  // 2026-06-17T02:00:00Z == 2026-06-16 21:00 CDT (UTC-5). The evening-CDT
  // timestamp is the PREVIOUS calendar day locally but the NEXT day in UTC.
  const eveningCdt = unix("2026-06-17T02:00:00Z");

  it("buckets an evening-CDT timestamp to the LOCAL date, not the UTC date", () => {
    expect(toDateLocal(eveningCdt, "America/Chicago")).toBe("2026-06-16");
    expect(toDateUTC(eveningCdt)).toBe("2026-06-17");
  });

  it("local and UTC agree for an afternoon timestamp (no boundary crossing)", () => {
    // 2026-06-16T18:00:00Z == 2026-06-16 13:00 CDT — same calendar day both ways.
    const afternoon = unix("2026-06-16T18:00:00Z");
    expect(toDateLocal(afternoon, "America/Chicago")).toBe("2026-06-16");
    expect(toDateUTC(afternoon)).toBe("2026-06-16");
  });

  it("UTC tz makes toDateLocal agree with toDateUTC", () => {
    expect(toDateLocal(eveningCdt, "UTC")).toBe(toDateUTC(eveningCdt));
    expect(toDateLocal(eveningCdt, "UTC")).toBe("2026-06-17");
  });

  it("todayLocal renders YYYY-MM-DD for a fixed `now` in the given tz", () => {
    const now = new Date("2026-06-17T02:00:00Z");
    expect(todayLocal("America/Chicago", now)).toBe("2026-06-16");
    expect(todayLocal("UTC", now)).toBe("2026-06-17");
  });
});

// ── 2. pickTimezone (pure) ───────────────────────────────────────────────────
describe("pickTimezone — default fallback + trimming", () => {
  it("undefined row → DEFAULT_TIMEZONE", () => {
    expect(pickTimezone(undefined)).toBe(DEFAULT_TIMEZONE);
  });

  it("missing/empty/whitespace timezone → DEFAULT_TIMEZONE", () => {
    expect(pickTimezone({})).toBe(DEFAULT_TIMEZONE);
    expect(pickTimezone({ timezone: null })).toBe(DEFAULT_TIMEZONE);
    expect(pickTimezone({ timezone: "" })).toBe(DEFAULT_TIMEZONE);
    expect(pickTimezone({ timezone: "   " })).toBe(DEFAULT_TIMEZONE);
  });

  it("returns the trimmed value when set", () => {
    expect(pickTimezone({ timezone: "America/New_York" })).toBe(
      "America/New_York",
    );
    expect(pickTimezone({ timezone: "  Europe/London  " })).toBe(
      "Europe/London",
    );
  });

  it("DEFAULT_TIMEZONE is America/Chicago unless overridden by env", () => {
    expect(DEFAULT_TIMEZONE).toBe(
      process.env.COOMANDER_TIMEZONE || "America/Chicago",
    );
  });
});

// ── 3. buildTodayModel local bucketing (the core fix) ────────────────────────
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
    target_count: 3,
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
    kind: "shipped",
    source: "manual",
    platform: null,
    external_ref: null,
    content_state_id: null,
    payload_json: "{}",
    dropped_at: 0,
    created_at: 0,
    ...over,
  };
}

function buildModel(
  tz: string,
  over: Partial<Parameters<typeof buildTodayModel>[0]> = {},
): ReturnType<typeof buildTodayModel> {
  return buildTodayModel({
    date: "2026-06-16",
    tz,
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

describe("buildTodayModel — tz drives day bucketing (#183 core fix)", () => {
  // Evening-CDT shipped drop: 2026-06-17T02:00:00Z == 2026-06-16 21:00 CDT.
  // It belongs to the local "today" (2026-06-16) but to tomorrow in UTC.
  const eveningCdtDrop = drop({
    beat_id: "b1",
    kind: "shipped",
    dropped_at: unix("2026-06-17T02:00:00Z"),
  });

  it("America/Chicago: an evening-CDT drop counts toward the local today", () => {
    const m = buildModel("America/Chicago", {
      drops: [eveningCdtDrop] as unknown as never,
    });
    const b = findBeat(m, "b1")!;
    expect(b.actual_today).toBe(1);
    expect(m.content_pipeline.shipped_today).toBe(1);
  });

  it("UTC: the same drop does NOT count toward 2026-06-16 (proves tz drives bucketing)", () => {
    const m = buildModel("UTC", {
      drops: [eveningCdtDrop] as unknown as never,
    });
    const b = findBeat(m, "b1")!;
    expect(b.actual_today).toBe(0);
    expect(m.content_pipeline.shipped_today).toBe(0);
  });
});

// ── 4. getTimezone / userToday DB fallback ───────────────────────────────────
let userIdCounter = 0;
function seedUser(): string {
  const id = `coomander-tz-user-${Date.now()}-${userIdCounter++}`;
  const email = `${id}@test.com`;
  const now = Math.floor(Date.now() / 1000);
  getRawDb()
    .prepare(
      "INSERT INTO user (id, email, emailVerified, createdAt, updatedAt, isAdmin, disabled, coomanderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, email, 1, now, now, 0, 0, 1);
  return id;
}

describe("getTimezone / userToday — DB fallback with no settings row", () => {
  it("getTimezone falls back to DEFAULT_TIMEZONE when no coomander_settings row exists", async () => {
    const userId = seedUser();
    expect(await getTimezone(userId)).toBe(DEFAULT_TIMEZONE);
  });

  it("userToday equals todayLocal(DEFAULT_TIMEZONE) for an unconfigured user", async () => {
    const userId = seedUser();
    expect(await userToday(userId)).toBe(todayLocal(DEFAULT_TIMEZONE));
  });
});
