import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Scheduled-campaign dispatch (#597, epic #595, Coomander sync #222) ──────
//
// jobs/index.ts exposes dispatchScheduledCampaigns(): Promise<void>. In
// Coomander it's driven by the "dispatch-scheduled-campaigns" job (dev/cron)
// and the custom-worker.ts scheduled() handler / campaign-cron route (prod).
// We mock the #454 producer (@/lib/campaign-send → enqueueCampaignSend) so we
// can assert dispatch behavior — due-selection, exactly-once atomic claiming,
// and failure handling — WITHOUT actually resolving real audiences or sending
// mail. Audience resolution (@/lib/audiences) runs for real against the shared
// test DB; we sidestep pollution from other test files by targeting a unique,
// never-matched tag on every seeded campaign so resolveAudience always returns
// [] deterministically.
//
// This file mocks @/lib/campaign-send in its ENTIRETY, which is why it lives
// separately from campaign-send.test.ts (which needs the real module).

const mockEnqueueCampaignSend = vi.fn();
vi.mock("@/lib/campaign-send", () => ({
  CAMPAIGN_BATCH_JOB: "send-campaign-batch",
  processCampaignBatch: vi.fn(),
  enqueueCampaignSend: (...args: unknown[]) => mockEnqueueCampaignSend(...args),
}));

import "./helpers/db";
import { createTestUser, cleanupTestUser, type TestUser } from "./helpers/db";
import { getDb, getRawDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";

import { dispatchScheduledCampaigns } from "@/jobs/index";

// ─── Seed helpers ────────────────────────────────────────────────────────────

let seq = 0;
function uniq(prefix: string): string {
  seq += 1;
  return `${prefix}-${Date.now()}-${seq}-${Math.random().toString(36).slice(2)}`;
}

let testUser: TestUser;
let seededCampaignIds: string[] = [];

/** A tag filter referencing a tag nobody owns -> resolveAudience always [] . */
function uniqueEmptyAudienceFilter(): string {
  return JSON.stringify({ kind: "tags", tags: [uniq("no-such-tag")], match: "any" });
}

function seedCampaign(opts: { status: string; scheduledAt: string | null }): string {
  const id = uniq("camp");
  getDb()
    .insert(emailCampaigns)
    .values({
      id,
      name: "Scheduled Campaign",
      subject: "Hello",
      html_content: "<p>hello</p>",
      status: opts.status,
      audience_filter: uniqueEmptyAudienceFilter(),
      scheduled_at: opts.scheduledAt,
      created_by: testUser.userId,
    })
    .run();
  seededCampaignIds.push(id);
  return id;
}

function getCampaignStatus(id: string): string | undefined {
  const row = getRawDb()
    .prepare(`SELECT status FROM email_campaigns WHERE id = ?`)
    .get(id) as { status: string } | undefined;
  return row?.status;
}

function isoMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

beforeEach(() => {
  testUser = createTestUser();
  mockEnqueueCampaignSend.mockReset();
  mockEnqueueCampaignSend.mockResolvedValue({ batches: 0, recipients: 0 });
});

afterEach(() => {
  if (seededCampaignIds.length > 0) {
    const placeholders = seededCampaignIds.map(() => "?").join(",");
    getRawDb()
      .prepare(`DELETE FROM email_campaigns WHERE id IN (${placeholders})`)
      .run(...seededCampaignIds);
    seededCampaignIds = [];
  }
  cleanupTestUser(testUser.userId, testUser.email);
});

describe("dispatchScheduledCampaigns — due selection", () => {
  it("dispatches only status='scheduled' campaigns whose scheduled_at has passed", async () => {
    const due = seedCampaign({ status: "scheduled", scheduledAt: isoMinutesFromNow(-60) });
    const future = seedCampaign({ status: "scheduled", scheduledAt: isoMinutesFromNow(60) });
    const notScheduled = seedCampaign({ status: "draft", scheduledAt: isoMinutesFromNow(-60) });

    await dispatchScheduledCampaigns();

    expect(mockEnqueueCampaignSend).toHaveBeenCalledTimes(1);
    expect(mockEnqueueCampaignSend.mock.calls[0][0]).toMatchObject({ campaignId: due });

    expect(getCampaignStatus(due)).toBe("sending");
    expect(getCampaignStatus(future)).toBe("scheduled");
    expect(getCampaignStatus(notScheduled)).toBe("draft");
  });

  it("does nothing when there are no due campaigns", async () => {
    seedCampaign({ status: "scheduled", scheduledAt: isoMinutesFromNow(60) });

    await dispatchScheduledCampaigns();

    expect(mockEnqueueCampaignSend).not.toHaveBeenCalled();
  });

  it("dispatches multiple due campaigns in one tick", async () => {
    const due1 = seedCampaign({ status: "scheduled", scheduledAt: isoMinutesFromNow(-30) });
    const due2 = seedCampaign({ status: "scheduled", scheduledAt: isoMinutesFromNow(-5) });

    await dispatchScheduledCampaigns();

    expect(mockEnqueueCampaignSend).toHaveBeenCalledTimes(2);
    const dispatchedIds = mockEnqueueCampaignSend.mock.calls.map(
      (call) => (call[0] as { campaignId: string }).campaignId
    );
    expect(dispatchedIds.sort()).toEqual([due1, due2].sort());
    expect(getCampaignStatus(due1)).toBe("sending");
    expect(getCampaignStatus(due2)).toBe("sending");
  });
});

describe("dispatchScheduledCampaigns — exactly-once / atomic claim", () => {
  it("claims a due campaign so a second back-to-back call does not dispatch it again", async () => {
    const due = seedCampaign({ status: "scheduled", scheduledAt: isoMinutesFromNow(-10) });

    await dispatchScheduledCampaigns();
    await dispatchScheduledCampaigns();

    expect(mockEnqueueCampaignSend).toHaveBeenCalledTimes(1);
    expect(getCampaignStatus(due)).toBe("sending");
  });
});

describe("dispatchScheduledCampaigns — failure handling", () => {
  it("sets status='failed' when enqueueCampaignSend throws", async () => {
    const due = seedCampaign({ status: "scheduled", scheduledAt: isoMinutesFromNow(-10) });
    mockEnqueueCampaignSend.mockRejectedValueOnce(new Error("queue unavailable"));

    await dispatchScheduledCampaigns();

    expect(getCampaignStatus(due)).toBe("failed");
  });

  it("does not affect other due campaigns when one fails", async () => {
    const failing = seedCampaign({ status: "scheduled", scheduledAt: isoMinutesFromNow(-10) });
    const succeeding = seedCampaign({ status: "scheduled", scheduledAt: isoMinutesFromNow(-5) });

    mockEnqueueCampaignSend.mockImplementation(async (opts: { campaignId: string }) => {
      if (opts.campaignId === failing) throw new Error("boom");
      return { batches: 0, recipients: 0 };
    });

    await dispatchScheduledCampaigns();

    expect(getCampaignStatus(failing)).toBe("failed");
    expect(getCampaignStatus(succeeding)).toBe("sending");
  });
});
