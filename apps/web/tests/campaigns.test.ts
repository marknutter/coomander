import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mock the email transport + DB + tracking ───────────────────────────────
//
// Email/broadcasts use Cloudflare Email Service (#374 / PR #383). The dead
// Resend-era sendBroadcast() / syncSubscribersToAudience() helpers were removed
// in #430; lib/broadcasts.ts now exposes only:
//   - sendCampaignDirect(campaignId, subject, html, emails)
//       loops over the email list, applies open/click tracking to the html,
//       calls sendEmail() once per recipient, logs a "sent" event row into
//       email_events via getDb(), and counts sent/failed.
//
// We mock @/lib/email so sendEmail is a spy we can drive and assert against,
// @/lib/db so the event-logging insert is an observable no-op spy, and
// @/lib/email-tracking so applyCampaignTracking is a passthrough — the broadcast
// tests don't depend on tracking internals (those are covered in
// tests/email-tracking.test.ts).

const { mockSendEmail, mockInsertRun, mockApplyTracking } = vi.hoisted(() => ({
  mockSendEmail: vi.fn(),
  mockInsertRun: vi.fn(),
  mockApplyTracking: vi.fn(),
}));

vi.mock("@/lib/email", () => ({
  sendEmail: mockSendEmail,
  FROM: "Test App <noreply@test.com>",
}));

// applyCampaignTracking is a passthrough by default — return the html untouched
// so broadcast assertions on the rendered html stay stable.
vi.mock("@/lib/email-tracking", () => ({
  applyCampaignTracking: mockApplyTracking,
}));

// getDb().insert(...).values(...).run() chain — a no-op spy on .run().
// .select().from().where().all() chain preserved for any callers that use it.
vi.mock("@/lib/db", () => {
  const insertChain = {
    values: vi.fn(() => ({ run: mockInsertRun })),
  };
  const selectChain = {
    from: vi.fn(() => ({
      where: vi.fn(() => ({
        all: vi.fn(() => []),
      })),
    })),
  };
  return {
    getDb: vi.fn(() => ({
      insert: vi.fn(() => insertChain),
      select: vi.fn(() => selectChain),
    })),
  };
});

// Mock schema to avoid SQLite/PG dialect resolution
vi.mock("@/lib/schema", () => ({
  newsletterSubscribers: { email: "email", status: "status" },
  emailCampaigns: { id: "id", name: "name", subject: "subject", status: "status", preview_text: "preview_text", html_content: "html_content", audience_filter: "audience_filter", recipient_count: "recipient_count", sent_count: "sent_count", scheduled_at: "scheduled_at", sent_at: "sent_at", resend_broadcast_id: "resend_broadcast_id", created_by: "created_by", created_at: "created_at", updated_at: "updated_at" },
  emailEvents: { email_id: "email_id", campaign_id: "campaign_id", subscriber_email: "subscriber_email", event_type: "event_type" },
}));

// ─── Imports (after mocks) ──────────────────────────────────────────────────

import { sendCampaignDirect } from "@/lib/broadcasts";
import { PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { emailCampaigns } from "@/lib/schema";

// ─── sendCampaignDirect ─────────────────────────────────────────────────────

describe("sendCampaignDirect", () => {
  beforeEach(() => {
    mockSendEmail.mockReset();
    mockInsertRun.mockReset();
    // Passthrough: tracking returns the html unchanged.
    mockApplyTracking.mockReset().mockImplementation((html: string) => html);
  });

  it("sends one email per recipient and counts them all as sent", async () => {
    mockSendEmail.mockResolvedValue({ messageId: "m-1" });
    const emails = Array.from({ length: 5 }, (_, i) => `user${i}@test.com`);

    const result = await sendCampaignDirect("camp-1", "Hello", "<p>Hi</p>", emails);

    expect(result).toEqual({ sent: 5, failed: 0 });
    expect(mockSendEmail).toHaveBeenCalledTimes(5);
    expect(mockSendEmail.mock.calls[0][0]).toMatchObject({
      to: "user0@test.com",
      subject: "Hello",
      html: "<p>Hi</p>",
    });
  });

  it("sends one email per recipient for large lists", async () => {
    mockSendEmail.mockResolvedValue({ messageId: "m-1" });
    const emails = Array.from({ length: 250 }, (_, i) => `u${i}@test.com`);

    const result = await sendCampaignDirect("camp-2", "Subj", "<p>Body</p>", emails);

    // Individual sends (no batching) — one call per recipient.
    expect(result).toEqual({ sent: 250, failed: 0 });
    expect(mockSendEmail).toHaveBeenCalledTimes(250);
  });

  it("counts failures when individual sends throw", async () => {
    // First 100 succeed, next 100 fail, last 50 succeed → 200 sent, 100 failed.
    mockSendEmail.mockImplementation((params: { to: string }) => {
      const idx = Number(params.to.replace(/\D/g, ""));
      if (idx >= 100 && idx < 200) {
        return Promise.reject(new Error("rate limit"));
      }
      return Promise.resolve({ messageId: "m-1" });
    });
    const emails = Array.from({ length: 250 }, (_, i) => `u${i}@test.com`);

    const result = await sendCampaignDirect("camp-3", "Subj", "<p>Body</p>", emails);

    expect(result).toEqual({ sent: 150, failed: 100 });
  });

  it("returns zero counts for empty email list", async () => {
    const result = await sendCampaignDirect("camp-4", "Subj", "<p>Body</p>", []);

    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it("does not count a send as failed when event-logging insert throws", async () => {
    // The send succeeds, but logging the "sent" event row blows up. That must
    // NOT flip the send from sent→failed — the email already went out.
    mockSendEmail.mockResolvedValue({ messageId: "m-1" });
    mockInsertRun.mockImplementation(() => {
      throw new Error("db write failed");
    });
    const emails = Array.from({ length: 3 }, (_, i) => `user${i}@test.com`);

    const result = await sendCampaignDirect("camp-5", "Subj", "<p>Body</p>", emails);

    expect(result).toEqual({ sent: 3, failed: 0 });
    expect(mockSendEmail).toHaveBeenCalledTimes(3);
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
