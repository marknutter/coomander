import { describe, it, expect, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";
import {
  enqueueCampaignSend,
  processCampaignBatch,
  finalizeIfComplete,
  isRateLimitError,
  CAMPAIGN_BATCH_SIZE,
  type CampaignBatchPayload,
} from "@/lib/campaign-send";
import { createTestUser } from "./helpers/db";

// ─── Campaign send engine — batching + batch bookkeeping (lib/campaign-send.ts, #222) ───
//
// SPEC (from the module docblock + #222 acceptance criteria):
//   - enqueueCampaignSend splits N recipients into ceil(N / CAMPAIGN_BATCH_SIZE)
//     batches, records recipient_count/batches_total on the campaign, and sets
//     status='sending'. An empty recipient list enqueues ZERO batches and
//     finalizes the campaign to 'sent' immediately.
//   - Each completed batch (processCampaignBatch) increments batches_done by
//     exactly 1 and re-evaluates finalize.
//   - finalizeIfComplete flips status 'sending' -> 'sent' (and stamps sent_at)
//     ONLY once batches_done >= batches_total, and ONLY when the campaign is
//     still 'sending' — a campaign that is already 'sent' is left untouched
//     (guards against double-finalization from racing/duplicate batches).
//
// Written against the spec/public interface, not the implementation. The
// producer test asserts on enqueueCampaignSend's OWN return value + the
// synchronously-recorded campaign row (both are set before any batch is
// enqueued), so it is not sensitive to the fire-and-forget background job
// drain that enqueueCampaignSend kicks off in non-Workers/dev environments.
// The consumer/bookkeeping tests seed a campaign row directly and call
// processCampaignBatch/finalizeIfComplete themselves, independent of that
// background drain, for fully deterministic assertions.
//
// Cleanup note: email_events.campaign_id AND email_campaigns.created_by both
// carry hard FKs (migrations 013/014, no ON DELETE CASCADE), and
// enqueueCampaignSend's background job drain inserts email_events rows
// asynchronously (fire-and-forget, not awaited by the producer call). Any
// attempt to delete campaign/event/user rows from this file races that
// drain and can violate the FK in either direction — tried a per-test
// afterEach (raced: delete-while-referenced) and a single afterAll (raced:
// late insert lands between the two deletes) and both produced a genuine
// unhandled-rejection FK failure. Rather than chase that race, this file
// intentionally performs NO deletes: fixtures use randomly-suffixed ids so
// there's no collision risk within a run, and the shared vitest DB file is
// deleted wholesale by tests/setup.ts's global afterAll once every test file
// finishes.

let ownerUserId: string;

function makeCampaignId(): string {
  return `camp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function insertDraftCampaign(overrides: Partial<{
  status: string;
  batches_total: number;
  batches_done: number;
}> = {}): Promise<string> {
  const id = makeCampaignId();
  await getDb()
    .insert(emailCampaigns)
    .values({
      id,
      name: "Test Campaign",
      subject: "Hello",
      html_content: "<p>Hi</p>",
      status: overrides.status ?? "sending",
      batches_total: overrides.batches_total ?? 0,
      batches_done: overrides.batches_done ?? 0,
      created_by: ownerUserId,
    });
  return id;
}

async function readCampaign(id: string) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(emailCampaigns)
    .where(eq(emailCampaigns.id, id))
    .limit(1);
  return row;
}

// createTestUser bootstraps the Better Auth schema (needed because
// email_campaigns.created_by references user.id). One shared owner user for
// the whole file — intentionally not torn down, see the cleanup note above.
beforeAll(() => {
  ownerUserId = createTestUser({ name: "Campaign Owner" }).userId;
});

// ── enqueueCampaignSend — batching math ──────────────────────────────────

describe("enqueueCampaignSend — splits recipients into ceil(N / CAMPAIGN_BATCH_SIZE) batches", () => {
  it("splits an exact multiple of CAMPAIGN_BATCH_SIZE into N/BATCH_SIZE batches", async () => {
    const id = await insertDraftCampaign({ status: "draft" });
    const recipients = Array.from(
      { length: CAMPAIGN_BATCH_SIZE * 2 },
      (_, i) => `r${i}@example.com`,
    );

    const result = await enqueueCampaignSend({
      campaignId: id,
      subject: "Hi",
      html: "<p>Hi</p>",
      recipients,
    });

    expect(result.recipients).toBe(CAMPAIGN_BATCH_SIZE * 2);
    expect(result.batches).toBe(2);

    const row = await readCampaign(id);
    expect(row.recipient_count).toBe(CAMPAIGN_BATCH_SIZE * 2);
    expect(row.batches_total).toBe(2);
    expect(row.status).toBe("sending");
  });

  it("rounds UP (ceiling) when recipients don't divide evenly into batches", async () => {
    const id = await insertDraftCampaign({ status: "draft" });
    // One more than a single batch — must still take 2 batches, not 1 (floor)
    // or 1.02 (unrounded).
    const recipients = Array.from(
      { length: CAMPAIGN_BATCH_SIZE + 1 },
      (_, i) => `r${i}@example.com`,
    );

    const result = await enqueueCampaignSend({
      campaignId: id,
      subject: "Hi",
      html: "<p>Hi</p>",
      recipients,
    });

    expect(result.batches).toBe(2);

    const row = await readCampaign(id);
    expect(row.batches_total).toBe(2);
  });

  it("a single recipient still enqueues exactly 1 batch", async () => {
    const id = await insertDraftCampaign({ status: "draft" });

    const result = await enqueueCampaignSend({
      campaignId: id,
      subject: "Hi",
      html: "<p>Hi</p>",
      recipients: ["only@example.com"],
    });

    expect(result.batches).toBe(1);
    expect(result.recipients).toBe(1);
  });

  it("an empty recipient list enqueues ZERO batches and finalizes immediately to 'sent'", async () => {
    const id = await insertDraftCampaign({ status: "draft" });

    const result = await enqueueCampaignSend({
      campaignId: id,
      subject: "Hi",
      html: "<p>Hi</p>",
      recipients: [],
    });

    expect(result.batches).toBe(0);
    expect(result.recipients).toBe(0);

    const row = await readCampaign(id);
    expect(row.status).toBe("sent");
    expect(row.sent_count).toBe(0);
    expect(row.sent_at).toBeTruthy();
  });

  it("resets batches_done to 0 and sent_count to 0 on (re-)enqueue", async () => {
    // Simulates re-sending: prior progress must not leak into the new send.
    const id = await insertDraftCampaign({
      status: "sending",
      batches_total: 3,
      batches_done: 3,
    });

    await enqueueCampaignSend({
      campaignId: id,
      subject: "Hi",
      html: "<p>Hi</p>",
      recipients: ["a@example.com"],
    });

    const row = await readCampaign(id);
    expect(row.batches_done).toBe(0);
    expect(row.sent_count).toBe(0);
    expect(row.batches_total).toBe(1);
  });
});

// ── processCampaignBatch / finalizeIfComplete — batch bookkeeping ───────

describe("processCampaignBatch — batch bookkeeping (batches_done + finalize)", () => {
  it("increments batches_done by exactly 1 per processed batch, without finalizing early", async () => {
    const id = await insertDraftCampaign({
      status: "sending",
      batches_total: 2,
      batches_done: 0,
    });

    const payload: CampaignBatchPayload = {
      campaignId: id,
      subject: "Hi",
      html: "<p>Hi</p>",
      recipients: ["one@example.com"],
    };
    await processCampaignBatch(payload);

    const row = await readCampaign(id);
    expect(row.batches_done).toBe(1);
    // Only 1 of 2 batches done — must NOT finalize yet.
    expect(row.status).toBe("sending");
  });

  it("finalizes to 'sent' once the final batch brings batches_done to batches_total", async () => {
    const id = await insertDraftCampaign({
      status: "sending",
      batches_total: 2,
      batches_done: 1, // one batch already completed
    });

    await processCampaignBatch({
      campaignId: id,
      subject: "Hi",
      html: "<p>Hi</p>",
      recipients: ["two@example.com"],
    });

    const row = await readCampaign(id);
    expect(row.batches_done).toBe(2);
    expect(row.status).toBe("sent");
    expect(row.sent_at).toBeTruthy();
  });

  it("finalizeIfComplete does NOT touch a campaign that is already 'sent' (no double-finalize)", async () => {
    const id = await insertDraftCampaign({
      status: "sent",
      batches_total: 2,
      batches_done: 2,
    });
    const before = await readCampaign(id);

    await finalizeIfComplete(id);

    const after = await readCampaign(id);
    expect(after.status).toBe("sent");
    expect(after.sent_at).toBe(before.sent_at);
  });

  it("finalizeIfComplete leaves a 'sending' campaign alone when batches_done < batches_total", async () => {
    const id = await insertDraftCampaign({
      status: "sending",
      batches_total: 3,
      batches_done: 1,
    });

    await finalizeIfComplete(id);

    const row = await readCampaign(id);
    expect(row.status).toBe("sending");
    expect(row.sent_at).toBeNull();
  });

  it("processing multiple batches sequentially advances batches_done monotonically to batches_total", async () => {
    const id = await insertDraftCampaign({
      status: "sending",
      batches_total: 3,
      batches_done: 0,
    });

    for (let i = 0; i < 3; i++) {
      await processCampaignBatch({
        campaignId: id,
        subject: "Hi",
        html: "<p>Hi</p>",
        recipients: [`batch${i}@example.com`],
      });
      const row = await readCampaign(id);
      expect(row.batches_done).toBe(i + 1);
    }

    const final = await readCampaign(id);
    expect(final.status).toBe("sent");
  });
});

// ── isRateLimitError — requeue-vs-drop classification ────────────────────

describe("isRateLimitError", () => {
  it("recognizes common rate-limit / 429 phrasings", () => {
    expect(isRateLimitError(new Error("Cloudflare Email REST API error 429: Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("daily sending quota exceeded"))).toBe(true);
  });

  it("does not classify an unrelated/permanent error as rate-limited", () => {
    expect(isRateLimitError(new Error("invalid recipient address"))).toBe(false);
    expect(isRateLimitError(new Error("network timeout"))).toBe(false);
  });

  it("handles non-Error thrown values without throwing itself", () => {
    expect(isRateLimitError("429 too many requests")).toBe(true);
    expect(isRateLimitError({ weird: "object" })).toBe(false);
  });
});
