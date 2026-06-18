import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock Resend ────────────────────────────────────────────────────────────

const mockBroadcastsCreate = vi.fn();
const mockBroadcastsSend = vi.fn();
const mockContactsCreate = vi.fn();
const mockBatchSend = vi.fn();

vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = { send: vi.fn() };
      broadcasts = { create: mockBroadcastsCreate, send: mockBroadcastsSend };
      contacts = { create: mockContactsCreate };
      batch = { send: mockBatchSend };
    },
  };
});

// ─── Mock DB for syncSubscribersToAudience ──────────────────────────────────

const mockAll = vi.fn().mockReturnValue([]);
const mockWhere = vi.fn().mockReturnValue({ all: mockAll });
const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });

vi.mock("@/lib/db", () => ({
  getDb: () => ({ select: mockSelect }),
  getRawDb: () => ({}),
}));

// Mock schema to avoid SQLite/PG dialect resolution
vi.mock("@/lib/schema", () => ({
  newsletterSubscribers: { email: "email", status: "status" },
  emailCampaigns: { id: "id", name: "name", subject: "subject", status: "status", preview_text: "preview_text", html_content: "html_content", audience_filter: "audience_filter", recipient_count: "recipient_count", sent_count: "sent_count", scheduled_at: "scheduled_at", sent_at: "sent_at", resend_broadcast_id: "resend_broadcast_id", created_by: "created_by", created_at: "created_at", updated_at: "updated_at" },
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import {
  sendBroadcast,
  syncSubscribersToAudience,
  sendCampaignDirect,
} from "@/lib/broadcasts";
import type { BroadcastPayload } from "@/lib/broadcasts";
import { PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { emailCampaigns } from "@/lib/schema";

// ─── sendBroadcast ──────────────────────────────────────────────────────────

describe("sendBroadcast", () => {
  beforeEach(() => {
    mockBroadcastsCreate.mockReset();
    mockBroadcastsSend.mockReset();
  });

  const payload: BroadcastPayload = {
    name: "April Newsletter",
    subject: "Big news!",
    html: "<h1>Hello</h1>",
    audienceId: "aud_123",
  };

  it("creates a broadcast then sends it, returning the id", async () => {
    mockBroadcastsCreate.mockResolvedValue({ data: { id: "bc_abc" } });
    mockBroadcastsSend.mockResolvedValue({});

    const result = await sendBroadcast(payload);

    expect(result).toEqual({ id: "bc_abc" });
    expect(mockBroadcastsCreate).toHaveBeenCalledOnce();
    expect(mockBroadcastsCreate.mock.calls[0][0]).toMatchObject({
      audienceId: "aud_123",
      subject: "Big news!",
      html: "<h1>Hello</h1>",
      name: "April Newsletter",
    });
    expect(mockBroadcastsSend).toHaveBeenCalledWith("bc_abc", undefined);
  });

  it("passes scheduledAt when provided", async () => {
    mockBroadcastsCreate.mockResolvedValue({ data: { id: "bc_xyz" } });
    mockBroadcastsSend.mockResolvedValue({});

    await sendBroadcast({ ...payload, scheduledAt: "2026-05-01T12:00:00Z" });

    expect(mockBroadcastsSend).toHaveBeenCalledWith("bc_xyz", {
      scheduledAt: "2026-05-01T12:00:00Z",
    });
  });

  it("passes previewText when provided", async () => {
    mockBroadcastsCreate.mockResolvedValue({ data: { id: "bc_pt" } });
    mockBroadcastsSend.mockResolvedValue({});

    await sendBroadcast({ ...payload, previewText: "Sneak peek" });

    expect(mockBroadcastsCreate.mock.calls[0][0]).toMatchObject({
      previewText: "Sneak peek",
    });
  });

  it("throws when create returns no id", async () => {
    mockBroadcastsCreate.mockResolvedValue({ data: null });

    await expect(sendBroadcast(payload)).rejects.toThrow(
      "Failed to create broadcast"
    );
    expect(mockBroadcastsSend).not.toHaveBeenCalled();
  });
});

// ─── sendCampaignDirect ─────────────────────────────────────────────────────

describe("sendCampaignDirect", () => {
  beforeEach(() => {
    mockBatchSend.mockReset();
  });

  it("sends a single batch for <= 100 emails", async () => {
    mockBatchSend.mockResolvedValue({});
    const emails = Array.from({ length: 5 }, (_, i) => `user${i}@test.com`);

    const result = await sendCampaignDirect("Hello", "<p>Hi</p>", emails);

    expect(result).toEqual({ sent: 5, failed: 0 });
    expect(mockBatchSend).toHaveBeenCalledOnce();
    const batch = mockBatchSend.mock.calls[0][0];
    expect(batch).toHaveLength(5);
    expect(batch[0]).toMatchObject({
      to: "user0@test.com",
      subject: "Hello",
      html: "<p>Hi</p>",
    });
  });

  it("splits into multiple batches of 100", async () => {
    mockBatchSend.mockResolvedValue({});
    const emails = Array.from({ length: 250 }, (_, i) => `u${i}@test.com`);

    const result = await sendCampaignDirect("Subj", "<p>Body</p>", emails);

    expect(result).toEqual({ sent: 250, failed: 0 });
    // 250 emails → 3 batches: 100, 100, 50
    expect(mockBatchSend).toHaveBeenCalledTimes(3);
    expect(mockBatchSend.mock.calls[0][0]).toHaveLength(100);
    expect(mockBatchSend.mock.calls[1][0]).toHaveLength(100);
    expect(mockBatchSend.mock.calls[2][0]).toHaveLength(50);
  });

  it("counts failures when a batch throws", async () => {
    mockBatchSend
      .mockResolvedValueOnce({}) // first 100 succeed
      .mockRejectedValueOnce(new Error("rate limit")); // second 100 fail
    const emails = Array.from({ length: 200 }, (_, i) => `u${i}@test.com`);

    const result = await sendCampaignDirect("Subj", "<p>Body</p>", emails);

    expect(result).toEqual({ sent: 100, failed: 100 });
  });

  it("returns zero counts for empty email list", async () => {
    const result = await sendCampaignDirect("Subj", "<p>Body</p>", []);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(mockBatchSend).not.toHaveBeenCalled();
  });
});

// ─── syncSubscribersToAudience ──────────────────────────────────────────────

describe("syncSubscribersToAudience", () => {
  beforeEach(() => {
    mockAll.mockReset();
    mockContactsCreate.mockReset();
  });

  it("upserts each active subscriber and returns synced count", async () => {
    mockAll.mockReturnValue([
      { email: "a@test.com" },
      { email: "b@test.com" },
    ]);
    mockContactsCreate.mockResolvedValue({});

    const result = await syncSubscribersToAudience("aud_456");

    expect(result).toEqual({ synced: 2 });
    expect(mockContactsCreate).toHaveBeenCalledTimes(2);
    expect(mockContactsCreate).toHaveBeenCalledWith({
      audienceId: "aud_456",
      email: "a@test.com",
    });
  });

  it("silently skips contacts that throw (already exists)", async () => {
    mockAll.mockReturnValue([
      { email: "a@test.com" },
      { email: "b@test.com" },
    ]);
    mockContactsCreate
      .mockRejectedValueOnce(new Error("conflict"))
      .mockResolvedValueOnce({});

    const result = await syncSubscribersToAudience("aud_456");

    // First fails (skipped), second succeeds
    expect(result).toEqual({ synced: 1 });
  });

  it("returns zero when there are no subscribers", async () => {
    mockAll.mockReturnValue([]);

    const result = await syncSubscribersToAudience("aud_456");

    expect(result).toEqual({ synced: 0 });
    expect(mockContactsCreate).not.toHaveBeenCalled();
  });
});

// ─── Permissions ────────────────────────────────────────────────────────────

describe("ADMIN_CAMPAIGNS permission", () => {
  it("exists in PERMISSIONS with the correct value", () => {
    expect(PERMISSIONS.ADMIN_CAMPAIGNS).toBe("admin:campaigns");
  });

  it("is listed in the Administration permission group", () => {
    const adminGroup = PERMISSION_GROUPS.find(
      (g) => g.label === "Administration"
    );
    expect(adminGroup).toBeDefined();
    const campaignsPerm = adminGroup!.permissions.find(
      (p) => p.key === "admin:campaigns"
    );
    expect(campaignsPerm).toBeDefined();
    expect(campaignsPerm!.label).toBe("Manage email campaigns");
  });
});

// ─── Schema ─────────────────────────────────────────────────────────────────

describe("emailCampaigns schema", () => {
  it("is exported from schema.ts", () => {
    expect(emailCampaigns).toBeDefined();
  });

  it("has the expected column names", () => {
    // Drizzle table objects expose columns as keys
    const columnNames = Object.keys(emailCampaigns);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("subject");
    expect(columnNames).toContain("html_content");
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("created_by");
    expect(columnNames).toContain("sent_at");
    expect(columnNames).toContain("scheduled_at");
    expect(columnNames).toContain("resend_broadcast_id");
  });
});
