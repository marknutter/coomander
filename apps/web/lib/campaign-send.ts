/**
 * Campaign send engine — batched producer/consumer (#454, epic #595, sync #222).
 *
 * Replaces the old inline "one request sends every email sequentially" loop
 * (lib/broadcasts.ts → sendCampaignDirect) which dies on Workers CPU/wall-clock
 * limits for large lists. The send route now RESOLVES an audience, records the
 * batch count, and ENQUEUES batches, returning immediately.
 *
 * Transport (chosen at runtime by binding availability):
 *   - PROD (Cloudflare Workers): the CAMPAIGN_QUEUE binding. A queue consumer on
 *     the same Worker (custom-worker.ts → lib/queue-consumer.ts → POST
 *     /api/internal/campaign-batch) drains batches with CF Queue retry/backoff.
 *   - DEV / non-Workers: the existing SQLite/D1 job queue (lib/jobs.ts). The
 *     producer kicks a background drain so an admin-triggered send completes in
 *     seconds without waiting for a cron tick.
 *
 * The consumer logic (processCampaignBatch) is identical across transports — it
 * sends one tracked email per recipient, records a `sent` event for delivery
 * correlation, increments sent_count, and is idempotent per (campaign,
 * recipient) so a retried batch never double-sends. The campaign finalizes to
 * status='sent' when batches_done == batches_total (order-independent).
 *
 * NOTE: batch-boundary seams (enqueueCampaignSend / advanceBatchProgress /
 * finalizeIfComplete) are kept clean of any realtime/live-progress publishing —
 * that's grafted on by a separate realtime sync slice at integration time.
 */

import { and, eq, sql } from "drizzle-orm";
import { sendEmail, FROM } from "@/lib/email";
import { applyCampaignTracking } from "@/lib/email-tracking";
import { getDb } from "@/lib/db";
import { emailCampaigns, emailEvents } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";
import { enqueueJob, processJobs } from "@/lib/jobs";
import { log } from "@/lib/logger";

export const CAMPAIGN_BATCH_JOB = "send-campaign-batch";

/** Recipients per batch. CF Email Service is reputation-rate-limited, so keep
 * batches modest; one batch = one queue message / one job. */
export const CAMPAIGN_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.CAMPAIGN_BATCH_SIZE || "50", 10) || 50,
);

export interface CampaignBatchPayload {
  campaignId: string;
  subject: string;
  html: string;
  recipients: string[];
}

interface CampaignQueue {
  send(body: unknown): Promise<void>;
}

/** Resolve the CF Queue producer binding, or null off-Workers (→ job-queue). */
function getCampaignQueue(): CampaignQueue | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    return (ctx?.env?.CAMPAIGN_QUEUE as CampaignQueue | undefined) ?? null;
  } catch {
    return null;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Heuristic: is this error a provider rate-limit / daily-cap signal that should
 * REQUEUE the batch (vs. a permanent per-recipient failure)? The REST transport
 * throws `Cloudflare Email REST API error 429: …`; the Workers binding may throw
 * other shapes — match common phrasings defensively.
 */
export function isRateLimitError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    /rate.?limit/.test(msg) ||
    /too many requests/.test(msg) ||
    /\b429\b/.test(msg) ||
    /daily.*(limit|cap|quota)/.test(msg) ||
    /quota.*exceeded/.test(msg) ||
    /exceeded.*quota/.test(msg)
  );
}

async function alreadySent(campaignId: string, email: string): Promise<boolean> {
  const db = getDb();
  const row = await queryFirst(
    db
      .select({ id: emailEvents.id })
      .from(emailEvents)
      .where(
        and(
          eq(emailEvents.campaign_id, campaignId),
          eq(emailEvents.subscriber_email, email),
          eq(emailEvents.event_type, "sent"),
        ),
      )
      .limit(1),
  );
  return !!row;
}

/**
 * Producer: split the resolved recipients into batches, record progress
 * targets, and enqueue each batch. Returns immediately (the batches are sent
 * asynchronously by the consumer). Sets the campaign to status='sending'.
 *
 * Callers must have already resolved the audience to `recipients`.
 */
export async function enqueueCampaignSend(opts: CampaignBatchPayload): Promise<{
  batches: number;
  recipients: number;
}> {
  const { campaignId, subject, html, recipients } = opts;
  const db = getDb();
  const now = new Date().toISOString();

  // Record targets BEFORE enqueuing so a fast consumer can't finalize against a
  // stale batches_total. Reset all progress counters for a fresh send.
  await db
    .update(emailCampaigns)
    .set({
      status: "sending",
      recipient_count: recipients.length,
      sent_count: 0,
      batches_total: chunk(recipients, CAMPAIGN_BATCH_SIZE).length,
      batches_done: 0,
      updated_at: now,
    })
    .where(eq(emailCampaigns.id, campaignId))
    .run();

  if (recipients.length === 0) {
    // Empty audience — nothing to enqueue; finalize immediately.
    await db
      .update(emailCampaigns)
      .set({ status: "sent", sent_at: now, sent_count: 0, updated_at: now })
      .where(eq(emailCampaigns.id, campaignId))
      .run();
    log.info("[campaign-send] empty audience, finalized", { campaignId });
    return { batches: 0, recipients: 0 };
  }

  return enqueueBatches(campaignId, subject, html, recipients);
}

/**
 * Chunk recipients into batches and enqueue them on the active transport
 * (CF Queue on Workers, job queue in dev). Does NOT touch the campaign's
 * progress counters — the caller sets those first. Kicks a background drain in
 * dev so an interactive send completes without waiting for a cron tick.
 */
async function enqueueBatches(
  campaignId: string,
  subject: string,
  html: string,
  recipients: string[],
): Promise<{ batches: number; recipients: number }> {
  const batches = chunk(recipients, CAMPAIGN_BATCH_SIZE);
  const queue = getCampaignQueue();
  for (const batch of batches) {
    const payload: CampaignBatchPayload = { campaignId, subject, html, recipients: batch };
    if (queue) {
      await queue.send(payload);
    } else {
      await enqueueJob(CAMPAIGN_BATCH_JOB, payload as unknown as Record<string, unknown>);
    }
  }

  log.info("[campaign-send] enqueued", {
    campaignId,
    batches: batches.length,
    recipients: recipients.length,
    transport: queue ? "cf-queue" : "job-queue",
  });

  if (!queue) {
    void drainCampaignBatches();
  }

  return { batches: batches.length, recipients: recipients.length };
}

/**
 * Drain due jobs (dev/non-Workers only) until nothing more is runnable. Batches
 * that hit a rate-limit back off with a future scheduledAt, so they fall out of
 * the "due" set and this loop terminates — the regular cron tick picks them up
 * later. Bounded to avoid any pathological spin.
 */
async function drainCampaignBatches(): Promise<void> {
  try {
    for (let i = 0; i < 1000; i++) {
      const { processed, failed } = await processJobs(CAMPAIGN_BATCH_SIZE);
      if (processed === 0 && failed === 0) break;
    }
  } catch (err) {
    log.error("[campaign-send] background drain failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Consumer: send one batch. Idempotent per (campaign, recipient) so a retry
 * after a rate-limit backoff never double-sends. On a rate-limit error it THROWS
 * so the transport requeues the whole batch (already-sent recipients are then
 * skipped); permanent per-recipient errors are logged and skipped without
 * failing the batch. Advances batch progress on full completion.
 */
export async function processCampaignBatch(payload: CampaignBatchPayload): Promise<void> {
  const { campaignId, subject, html, recipients } = payload;
  if (!campaignId || !Array.isArray(recipients)) {
    throw new Error("[campaign-send] invalid batch payload");
  }
  const db = getDb();

  for (const to of recipients) {
    if (await alreadySent(campaignId, to)) continue;

    try {
      const trackedHtml = applyCampaignTracking(html, { campaignId, email: to });
      const { messageId } = await sendEmail({ from: FROM, to, subject, html: trackedHtml });

      // Record the `sent` event idempotently: the partial unique index on
      // (campaign_id, subscriber_email) WHERE event_type='sent' (migration 024)
      // makes a duplicate a no-op via ON CONFLICT DO NOTHING. We only increment
      // sent_count when a row was ACTUALLY inserted, so a redelivered/concurrent
      // batch can't over-count (or double-finalize) even though the pre-send
      // alreadySent() check is a TOCTOU optimization, not a hard guarantee.
      let recorded = false;
      try {
        const inserted = await executeChanges(
          db
            .insert(emailEvents)
            .values({
              email_id: messageId ?? null,
              campaign_id: campaignId,
              subscriber_email: to,
              event_type: "sent",
            })
            .onConflictDoNothing(),
        );
        recorded = inserted > 0;
      } catch (logErr) {
        // A logging failure must not count the send as failed (the email went
        // out). Delivery correlation degrades, send succeeds.
        log.error("[campaign-send] failed to record sent event", {
          campaignId,
          to,
          error: logErr instanceof Error ? logErr.message : String(logErr),
        });
      }

      if (recorded) {
        await db
          .update(emailCampaigns)
          .set({ sent_count: sql`${emailCampaigns.sent_count} + 1` })
          .where(eq(emailCampaigns.id, campaignId))
          .run();
      }
    } catch (err) {
      if (isRateLimitError(err)) {
        // Requeue the batch with backoff. Recipients already sent above are
        // skipped on the retry via alreadySent(); progress is NOT advanced.
        log.warn("[campaign-send] rate-limited, requeueing batch", {
          campaignId,
          error: err instanceof Error ? err.message : String(err),
        });
        throw err;
      }
      // Permanent per-recipient failure (e.g. a malformed address). Don't stall
      // the batch — log and move on. Dropped-recipient tracking + resend land in
      // the hardening follow-up.
      log.error("[campaign-send] permanent send failure", {
        campaignId,
        to,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await advanceBatchProgress(campaignId);
}

/**
 * Atomically record one completed batch, then re-evaluate finalize.
 */
async function advanceBatchProgress(campaignId: string): Promise<void> {
  const db = getDb();
  await db
    .update(emailCampaigns)
    .set({ batches_done: sql`${emailCampaigns.batches_done} + 1`, updated_at: new Date().toISOString() })
    .where(eq(emailCampaigns.id, campaignId))
    .run();
  await finalizeIfComplete(campaignId);
}

/**
 * Finalize a campaign to 'sent' once every batch has completed
 * (batches_done >= batches_total). The UPDATE is guarded on status='sending',
 * so concurrent batches racing to the threshold finalize exactly once.
 */
export async function finalizeIfComplete(campaignId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  const changed = await executeChanges(
    db
      .update(emailCampaigns)
      .set({ status: "sent", sent_at: now, updated_at: now })
      .where(
        and(
          eq(emailCampaigns.id, campaignId),
          eq(emailCampaigns.status, "sending"),
          sql`${emailCampaigns.batches_total} > 0`,
          sql`${emailCampaigns.batches_done} >= ${emailCampaigns.batches_total}`,
        ),
      ),
  );

  if (changed > 0) {
    log.info("[campaign-send] campaign finalized", { campaignId });
  }
}
