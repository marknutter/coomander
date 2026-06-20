import { describe, it, expect } from "vitest";
import {
  runCoomanderTool,
  recentTurns,
  roleForDirection,
} from "@/lib/coomander/coomanderChat";
import {
  appendMessage,
  listMessages,
} from "@/lib/coomander/coomanderMessages";
import { seedOpsDefaults } from "@/lib/coomander/seed-defaults";
import { buildHomeBrief } from "@/lib/coomander/homeBrief";
import { buildTodayModel } from "@/lib/coomander/todayModel";
import { listBeats } from "@/lib/coomander/beats";
import { listProcurement } from "@/lib/coomander/procurement";
import { listDrops } from "@/lib/coomander/drops";
import { getDayState } from "@/lib/coomander/scheduling";
import { userToday } from "@/lib/coomander/settings";
import type {
  CadencePillar,
  CadenceBeat,
} from "@/lib/schema";
import { getRawDb } from "@/lib/db";
// Importing the db helper bootstraps the Better Auth `user` table schema.
import "./helpers/db";

let userIdCounter = 0;
function seedUser(): string {
  const id = `coomander-chat-user-${Date.now()}-${userIdCounter++}`;
  const email = `${id}@test.com`;
  const now = Math.floor(Date.now() / 1000);
  getRawDb()
    .prepare(
      "INSERT INTO user (id, email, emailVerified, createdAt, updatedAt, isAdmin, disabled, coomanderEnabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(id, email, 1, now, now, 0, 0, 1);
  return id;
}

// ── Domain-tool execution (runCoomanderTool) ─────────────────────────────────
// Phase D (#203) removed the SSE/POST chat path (handleChatTurn / streamChatTurn);
// the conversational TEXT path now lives in the agents Worker (QA'd live). The
// SHARED domain executor — resolveToolUse + executeAction — is still reachable
// via runCoomanderTool (the agents Worker's tool proxy), so the routing/domain
// coverage below is re-pointed there. It runs the EXACT same path the old
// handleChatTurn tool branch used: action !== null when a domain action fired,
// note is the user-facing reply.
//
// NOTE: the old "persists the inbound message with its toolCall recorded" case
// tested message-row persistence (a handleChatTurn wiring concern, now the agent
// Worker's job), NOT resolveToolUse/executeAction. It was dropped here; toolCall
// round-trip persistence is independently covered by coomander-messages.test.ts.

// ── B. Tool-use writes domain rows (routing parity) ──────────────────────────
describe("runCoomanderTool — tool-use writes domain rows", () => {
  it("mark_blocker sets today to a bad day, returns the tool name + a non-empty note", async () => {
    const userId = seedUser();
    await seedOpsDefaults(userId);

    const res = await runCoomanderTool(userId, "mark_blocker", { reason: "sick today" });
    expect(res.action).toBe("mark_blocker");
    expect(res.note.length).toBeGreaterThan(0);

    const day = await getDayState(userId, await userToday(userId));
    expect(day?.day_quality).toBe("bad");
  });

  it("add_procurement_item creates a procurement row; action names the tool", async () => {
    const userId = seedUser();
    await seedOpsDefaults(userId);

    const res = await runCoomanderTool(userId, "add_procurement_item", {
      category: "shoot_prep",
      label: "ring lights",
    });
    expect(res.action).toBe("add_procurement_item");

    const items = await listProcurement(userId);
    expect(items.some((p) => p.label === "ring lights")).toBe(true);
  });
});

// ── C. log_drop routes to a real beat ────────────────────────────────────────
describe("runCoomanderTool — log_drop routes to a seeded beat", () => {
  it("logs a drop against a real beat id; action names the tool and a drop row exists", async () => {
    const userId = seedUser();
    await seedOpsDefaults(userId);

    const beats = await listBeats(userId);
    expect(beats.length).toBeGreaterThan(0);
    const beatId = beats[0].id;

    const res = await runCoomanderTool(userId, "log_drop", { beat_id: beatId, kind: "shipped" });
    expect(res.action).toBe("log_drop");

    const drops = await listDrops(userId);
    expect(drops.some((d) => d.beat_id === beatId)).toBe(true);
  });
});

// ── D. Thread hydration ordering ─────────────────────────────────────────────
describe("thread hydration ordering", () => {
  it("listMessages returns inbound/outbound in oldest-first order", async () => {
    const userId = seedUser();
    await appendMessage(userId, "inbound", "first");
    await appendMessage(userId, "outbound", "second");
    await appendMessage(userId, "inbound", "third");
    await appendMessage(userId, "outbound", "fourth");

    const rows = await listMessages(userId, 100);
    expect(rows.map((r) => r.text)).toEqual([
      "first",
      "second",
      "third",
      "fourth",
    ]);
  });

  it("recentTurns maps direction→role correctly and is oldest-first", async () => {
    const userId = seedUser();
    await appendMessage(userId, "inbound", "u1");
    await appendMessage(userId, "outbound", "a1");
    await appendMessage(userId, "inbound", "u2");

    const turns = await recentTurns(userId);
    expect(turns).toEqual([
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
      { role: "user", content: "u2" },
    ]);
  });

  it("roleForDirection maps inbound→user and outbound→assistant", () => {
    expect(roleForDirection("inbound")).toBe("user");
    expect(roleForDirection("outbound")).toBe("assistant");
  });
});

// ── E. buildHomeBrief (pure, #170 grounding) ─────────────────────────────────
const DATE = "2026-06-15"; // Monday
const todayTs = Math.floor(Date.parse(DATE + "T12:00:00Z") / 1000);

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

function modelWith(
  over: Partial<Parameters<typeof buildTodayModel>[0]> = {},
): ReturnType<typeof buildTodayModel> {
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

describe("buildHomeBrief — ramp window", () => {
  it("daysIn 0 → inRamp true, rampDay 1", () => {
    const brief = buildHomeBrief(modelWith(), 0);
    expect(brief.inRamp).toBe(true);
    expect(brief.rampDay).toBe(1);
  });

  it("daysIn 5 → inRamp true, rampDay 6", () => {
    const brief = buildHomeBrief(modelWith(), 5);
    expect(brief.inRamp).toBe(true);
    expect(brief.rampDay).toBe(6);
  });

  it("daysIn 6 → inRamp false, rampDay null", () => {
    const brief = buildHomeBrief(modelWith(), 6);
    expect(brief.inRamp).toBe(false);
    expect(brief.rampDay).toBeNull();
  });
});

describe("buildHomeBrief — mirrors TodayModel grounding", () => {
  it("overallState mirrors model.overall_state", () => {
    const model = modelWith({ dayQuality: "bad" });
    const brief = buildHomeBrief(model, 0);
    expect(brief.overallState).toBe(model.overall_state);
    expect(brief.overallState).toBe("red");
  });

  it("contentCushionDays mirrors model.content_cushion_days", () => {
    const model = modelWith();
    const brief = buildHomeBrief(model, 0);
    expect(brief.contentCushionDays).toBe(model.content_cushion_days);
  });

  it("shippedToday mirrors model.content_pipeline.shipped_today", () => {
    const model = modelWith({
      drops: [
        {
          id: "d1",
          user_id: "u1",
          beat_id: "b1",
          kind: "shipped",
          source: "manual",
          platform: null,
          external_ref: null,
          content_state_id: null,
          payload_json: "{}",
          dropped_at: todayTs,
          created_at: 0,
        },
      ] as unknown as never,
    });
    const brief = buildHomeBrief(model, 0);
    expect(brief.shippedToday).toBe(model.content_pipeline.shipped_today);
    expect(brief.shippedToday).toBe(1);
  });

  it("headline is a non-empty string", () => {
    const brief = buildHomeBrief(modelWith(), 0);
    expect(typeof brief.headline).toBe("string");
    expect(brief.headline.length).toBeGreaterThan(0);
  });

  it("onTheTable entries have name, pillar, numeric expected/actual, and a status", () => {
    const brief = buildHomeBrief(modelWith(), 0);
    for (const line of brief.onTheTable) {
      expect(typeof line.name).toBe("string");
      expect(typeof line.pillar).toBe("string");
      expect(typeof line.expectedToday).toBe("number");
      expect(typeof line.actualToday).toBe("number");
      expect(line.expectedToday).toBeGreaterThanOrEqual(0);
      expect(typeof line.status).toBe("string");
    }
  });
});

describe("buildHomeBrief — ramp affects expectedToday for normal_reel", () => {
  it("a normal_reel beat shows higher expectedToday on a later ramp day", () => {
    // NORMAL_REEL_RAMP = [1, 2, 3, 3, 3, 3] keyed off subtype normal_reel.
    const reelBeat = beat({
      id: "reel1",
      name: "Normal Reels",
      cadence_kind: "weekly",
      target_count: 21,
      subtype: "normal_reel" as unknown as CadenceBeat["subtype"],
    });

    const day0 = buildHomeBrief(
      modelWith({ beats: [reelBeat] as unknown as never }),
      0,
    );
    const day2 = buildHomeBrief(
      modelWith({ beats: [reelBeat] as unknown as never }),
      2,
    );

    const line0 = day0.onTheTable.find((l) => l.beatId === "reel1");
    const line2 = day2.onTheTable.find((l) => l.beatId === "reel1");
    expect(line0).toBeTruthy();
    expect(line2).toBeTruthy();
    // Day 1 expects 1; Day 3 expects 3 → strictly higher later in the ramp.
    expect(line2!.expectedToday).toBeGreaterThan(line0!.expectedToday);
    expect(line0!.expectedToday).toBeGreaterThanOrEqual(0);
  });
});
