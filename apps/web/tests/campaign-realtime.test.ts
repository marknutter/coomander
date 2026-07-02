import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Live realtime campaign progress (#222) ─────────────────────────────────
//
// lib/campaign-realtime.ts exposes:
//
//   campaignChannel(campaignId: string): string
//     → `"campaign:" + campaignId`
//
//   publishCampaignState(campaignId: string): Promise<void>
//     Reads the campaign row via getDb() and publishes a "campaign-progress"
//     event to `campaign:<id>` with fields mirroring the campaign row
//     (status, sentCount, recipientCount, batchesDone, batchesTotal,
//     batchesFailed). BEST-EFFORT: never throws, even when the DB read
//     throws, the row is missing, or publish() throws.
//
//   publishCampaignOpened(campaignId: string, email?: string): Promise<void>
//     Publishes a "campaign-opened" event to `campaign:<id>`, including
//     `email` only when provided. Never throws.
//
// IMPORTANT (anti-sycophancy): these tests are written AGAINST THE SPEC, not
// against the implementation in ../lib/campaign-realtime — the author did not
// read that file's logic before writing them (only its public export
// signatures). A failure here is a signal the IMPLEMENTATION may be wrong —
// do not "fix" the test to match the code.
//
// We mock the two boundary seams: the DB query chain (`@/lib/db`'s
// `getDb()`) and the realtime transport (`@/lib/realtime`'s `publish()`),
// mirroring the vi.mock boundary-mocking approach used in
// tests/campaign-send.test.ts.

const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    select: mockSelect,
  }),
}));

const mockPublish = vi.fn();
vi.mock("@/lib/realtime", () => ({
  publish: (...args: unknown[]) => mockPublish(...args),
}));

import {
  campaignChannel,
  publishCampaignState,
  publishCampaignOpened,
} from "@/lib/campaign-realtime";

beforeEach(() => {
  mockSelect.mockClear();
  mockFrom.mockClear();
  mockWhere.mockReset();
  mockPublish.mockReset();
  mockPublish.mockResolvedValue(undefined);
});

// ─── campaignChannel (pure) ──────────────────────────────────────────────────

describe("campaignChannel", () => {
  it("returns `campaign:<id>`", () => {
    expect(campaignChannel("abc")).toBe("campaign:abc");
  });

  it("does not transform or validate the id — it's a plain string concat", () => {
    expect(campaignChannel("123-xyz")).toBe("campaign:123-xyz");
  });
});

// ─── publishCampaignState ────────────────────────────────────────────────────

describe("publishCampaignState", () => {
  it("publishes a campaign-progress event to `campaign:<id>` mirroring the campaign row", async () => {
    mockWhere.mockResolvedValue([
      {
        status: "sending",
        sent_count: 4,
        recipient_count: 10,
        batches_done: 1,
        batches_total: 3,
        batches_failed: 0,
      },
    ]);

    await publishCampaignState("camp-1");

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [channel, event] = mockPublish.mock.calls[0];
    expect(channel).toBe("campaign:camp-1");
    expect(event).toMatchObject({
      type: "campaign-progress",
      campaignId: "camp-1",
      status: "sending",
      sentCount: 4,
      recipientCount: 10,
      batchesDone: 1,
      batchesTotal: 3,
      batchesFailed: 0,
    });
  });

  it("does not call publish, and does not throw, when the campaign row is missing", async () => {
    mockWhere.mockResolvedValue([]);

    await expect(publishCampaignState("missing-camp")).resolves.toBeUndefined();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("does not throw when the DB read throws (swallowed, best-effort)", async () => {
    mockWhere.mockRejectedValue(new Error("DB connection lost"));

    await expect(publishCampaignState("camp-1")).resolves.toBeUndefined();
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it("does not throw when publish() throws (swallowed, best-effort)", async () => {
    mockWhere.mockResolvedValue([
      {
        status: "sending",
        sent_count: 1,
        recipient_count: 5,
        batches_done: 0,
        batches_total: 1,
        batches_failed: 0,
      },
    ]);
    mockPublish.mockRejectedValue(new Error("realtime transport down"));

    await expect(publishCampaignState("camp-1")).resolves.toBeUndefined();
  });
});

// ─── publishCampaignOpened ────────────────────────────────────────────────────

describe("publishCampaignOpened", () => {
  it("publishes a campaign-opened event with the email when provided", async () => {
    await publishCampaignOpened("camp-2", "reader@example.com");

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [channel, event] = mockPublish.mock.calls[0];
    expect(channel).toBe("campaign:camp-2");
    expect(event).toMatchObject({
      type: "campaign-opened",
      campaignId: "camp-2",
      email: "reader@example.com",
    });
  });

  it("omits the email field when not provided", async () => {
    await publishCampaignOpened("camp-3");

    expect(mockPublish).toHaveBeenCalledTimes(1);
    const [channel, event] = mockPublish.mock.calls[0] as [string, Record<string, unknown>];
    expect(channel).toBe("campaign:camp-3");
    expect(event.type).toBe("campaign-opened");
    expect(event.campaignId).toBe("camp-3");
    expect(event.email).toBeUndefined();
  });

  it("does not throw even when publish() throws", async () => {
    mockPublish.mockRejectedValue(new Error("realtime transport down"));

    await expect(publishCampaignOpened("camp-4", "x@example.com")).resolves.toBeUndefined();
  });
});
