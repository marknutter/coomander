import { describe, it, expect } from "vitest";

// ─── lib/broadcasts.ts → lib/campaign-send.ts ──────────────────────────────
//
// The old inline sendCampaignDirect() loop (Cloudflare Email Service, one
// request sends every email sequentially) was replaced by the batched
// producer/consumer send engine in lib/campaign-send.ts (#454, epic #595,
// sync #222) — see tests/campaign-send.test.ts for coverage of the new
// engine (enqueueCampaignSend / processCampaignBatch / finalizeIfComplete).

import { PERMISSIONS, PERMISSION_GROUPS } from "@/lib/permissions";
import { emailCampaigns } from "@/lib/schema";

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
    expect(columnNames).toContain("audience_filter");
    expect(columnNames).toContain("batches_total");
    expect(columnNames).toContain("batches_done");
  });
});
