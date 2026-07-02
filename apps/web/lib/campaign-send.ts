/**
 * Campaign send engine — batched producer/consumer (#454, epic #595, sync #222),
 * hardened against at-scale failures (hardening follow-up, sync #222).
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
 * recipient) so a retried batch never double-sends. A campaign finalizes to
 * 'sent' once batches_done + batches_failed >= batches_total and none failed,
 * else 'failed' — so a dropped/retry-exhausted batch no longer strands the
 * campaign in 'sending' forever. Permanent per-recipient failures are recorded
 * as `failed` email_events (visible in the admin UI), and a failed campaign can
 * be resent (resendCampaign) to just the recipients who never got it.
 *
 * NOTE: batch-boundary seams (enqueueCampaignSend / advanceBatchProgress /
 * finalizeIfComplete / recordFailedBatch) are kept clean of any
 * realtime/live-progress publishing — that's grafted on by a separate realtime
 * sync slice at integration time.
 */

import { and, eq, sql } from "drizzle-orm";
import { sendEmail, FROM } from "@/lib/email";
import { applyCampaignTracking } from "@/lib/email-tracking";
import { getDb } from "@/lib/db";
import { emailCampaigns, emailEvents, campaignSendBatches } from "@/lib/schema";
import { queryFirst, executeChanges } from "@/lib/db-helpers";
import { enqueueJob, processJobs } from "@/lib/jobs";
import { parseAudienceFilter, resolveAudience } from "@/lib/audiences";
import { log } from "@/lib/logger";

export const CAMPAIGN_BATCH_JOB = "send-campaign-batch";

/** Recipients per batch. CF Email Service is reputation-rate-limited, so keep
 * batches modest; one batch = one queue message / one job. */
export const CAMPAIGN_BATCH_SIZE = Math.max(
  1,
  parseInt(process.env.CAMPAIGN_BATCH_SIZE || "50", 10) || 50,
);

/** Producer-facing input: the whole resolved audience for a send, not yet
 * chunked into batches. */
export interface CampaignSendOpts {
  campaignId: string;
  subject: string;
  html: string;
  recipients: string[];
}

/** One queued batch's payload — what the CF Queue / job-queue transport
 * actually carries and processCampaignBatch consumes. */
export interface CampaignBatchPayload extends CampaignSendOpts {
  /** This batch's position within the current send attempt (0-based).
   * Combined with campaignId, forms the stable idempotency key
   * (campaign_send_batches) that makes a redelivered batch a no-op for
   * batches_done accounting — see advanceBatchProgress. */
  batchIndex: number;
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

/** All recipient emails that already have a `sent` event for this campaign,
 * in one query (for bulk unsent-filtering without an N+1). */
async function sentEmailSet(campaignId: string): Promise<Set<string>> {
  const db = getDb();
  const rows = await db
    .select({ email: emailEvents.subscriber_email })
    .from(emailEvents)
    .where(and(eq(emailEvents.campaign_id, campaignId), eq(emailEvents.event_type, "sent")))
    .all();
  return new Set(rows.map((r) => r.email).filter((e): e is string => !!e));
}

/**
 * Producer: split the resolved recipients into batches, record progress
 * targets, and enqueue each batch. Returns immediately (the batches are sent
 * asynchronously by the consumer). Sets the campaign to status='sending'.
 *
 * Callers must have already resolved the audience to `recipients`.
 */
export async function enqueueCampaignSend(opts: CampaignSendOpts): Promise<{
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
      batches_failed: 0,
      updated_at: now,
    })
    .where(eq(emailCampaigns.id, campaignId))
    .run();

  // A fresh send restarts batch numbering from 0 — clear any idempotency
  // rows left over from a prior attempt so they can't collide with (and
  // silently no-op) this attempt's batch ids.
  await resetBatchTracking(campaignId);

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

/** Delete any campaign_send_batches idempotency rows for this campaign — call
 * at the start of every fresh send/resend, alongside resetting batches_done,
 * so a new attempt's batch ids (positional, starting at 0) can't collide with
 * a prior attempt's already-recorded ids. */
async function resetBatchTracking(campaignId: string): Promise<void> {
  const db = getDb();
  await db
    .delete(campaignSendBatches)
    .where(eq(campaignSendBatches.campaign_id, campaignId))
    .run();
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
  for (let i = 0; i < batches.length; i++) {
    const payload: CampaignBatchPayload = {
      campaignId,
      subject,
      html,
      recipients: batches[i],
      batchIndex: i,
    };
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
 * Re-dispatch a campaign to the recipients in its audience that DON'T yet have
 * a `sent` event — for recovering a `failed` (or partially-sent) campaign.
 * Idempotent: already-sent recipients are excluded up front and skipped again
 * by the consumer, so no one is emailed twice. Preserves recipient_count/
 * sent_count; resets batch progress to the outstanding remainder and
 * status→sending.
 */
export async function resendCampaign(campaignId: string): Promise<{
  batches: number;
  recipients: number;
  alreadySent: number;
}> {
  const db = getDb();
  const campaign = await queryFirst(
    db.select().from(emailCampaigns).where(eq(emailCampaigns.id, campaignId)),
  );
  if (!campaign) throw new Error("[campaign-send] resend: campaign not found");

  const filter = parseAudienceFilter(campaign.audience_filter);
  const audience = await resolveAudience(filter);

  // One query for who's already been sent (vs. an await-per-member N+1).
  const sentSet = await sentEmailSet(campaignId);
  const unsent = audience.filter((email) => !sentSet.has(email));
  const alreadySentCount = audience.length - unsent.length;
  const now = new Date().toISOString();

  // Reset batch progress to the remainder; PRESERVE sent_count. Recompute
  // recipient_count to the CURRENT resolved audience so the "N of M delivered"
  // ratio stays consistent even if the audience grew/shrank since the first
  // send (re-resolving live could otherwise desync recipient_count from
  // sent_count).
  await db
    .update(emailCampaigns)
    .set({
      status: "sending",
      recipient_count: audience.length,
      batches_total: chunk(unsent, CAMPAIGN_BATCH_SIZE).length,
      batches_done: 0,
      batches_failed: 0,
      updated_at: now,
    })
    .where(eq(emailCampaigns.id, campaignId))
    .run();

  // Same reason as enqueueCampaignSend: a resend restarts batch numbering
  // from 0, so clear the prior attempt's idempotency rows first.
  await resetBatchTracking(campaignId);

  if (unsent.length === 0) {
    // Everyone already got it — finalize straight to sent.
    await db
      .update(emailCampaigns)
      .set({ status: "sent", sent_at: now, updated_at: now })
      .where(eq(emailCampaigns.id, campaignId))
      .run();
    return { batches: 0, recipients: 0, alreadySent: alreadySentCount };
  }

  const result = await enqueueBatches(campaignId, campaign.subject, campaign.html_content, unsent);
  return { ...result, alreadySent: alreadySentCount };
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
  const { campaignId, subject, html, recipients, batchIndex } = payload;
  if (!campaignId || !Array.isArray(recipients) || typeof batchIndex !== "number") {
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
        // Clear any stale `failed` row for this recipient — a resend that now
        // succeeds should not leave the recipient counted as dropped.
        await db
          .delete(emailEvents)
          .where(
            and(
              eq(emailEvents.campaign_id, campaignId),
              eq(emailEvents.subscriber_email, to),
              eq(emailEvents.event_type, "failed"),
            ),
          )
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
      // the batch, but RECORD it as a `failed` event so the recipient_count vs
      // sent_count gap is explainable and the admin can see who was dropped.
      log.error("[campaign-send] permanent send failure", {
        campaignId,
        to,
        error: err instanceof Error ? err.message : String(err),
      });
      await recordFailedRecipient(campaignId, to, err instanceof Error ? err.message : String(err));
    }
  }

  await advanceBatchProgress(campaignId, batchIndex);
}

/** Record a permanent per-recipient send failure as a `failed` event (deduped
 * by the migration-026 partial unique index), with the error in metadata. */
async function recordFailedRecipient(campaignId: string, email: string, error: string): Promise<void> {
  const db = getDb();
  try {
    await db
      .insert(emailEvents)
      .values({
        campaign_id: campaignId,
        subscriber_email: email,
        event_type: "failed",
        metadata: JSON.stringify({ error: error.slice(0, 500) }),
      })
      .onConflictDoNothing()
      .run();
  } catch (e) {
    log.error("[campaign-send] failed to record failed event", {
      campaignId,
      email,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/**
 * Record a whole batch as permanently failed (dead-letter / stuck
 * reconciliation) and re-evaluate finalize. Called by the DLQ consumer and the
 * reconciler, never on the happy path.
 */
export async function recordFailedBatch(campaignId: string, count = 1): Promise<void> {
  const db = getDb();
  // Guard the increment on status='sending' AND still-outstanding batches, so a
  // redelivered dead-letter message (CF Queues is at-least-once) can't push
  // batches_failed past batches_total or bump it after the campaign already
  // finalized — the increment is naturally idempotent-enough without a
  // per-batch dedup table.
  await db
    .update(emailCampaigns)
    .set({ batches_failed: sql`${emailCampaigns.batches_failed} + ${count}`, updated_at: new Date().toISOString() })
    .where(
      and(
        eq(emailCampaigns.id, campaignId),
        eq(emailCampaigns.status, "sending"),
        sql`${emailCampaigns.batches_done} + ${emailCampaigns.batches_failed} < ${emailCampaigns.batches_total}`,
      ),
    )
    .run();
  await finalizeIfComplete(campaignId);
}

/**
 * Record one completed batch, then re-evaluate finalize. IDEMPOTENT per
 * (campaignId, batchIndex): a Cloudflare Queues at-least-once REDELIVERY of a
 * batch that already ran to completion (processCampaignBatch's per-recipient
 * work is itself idempotent via alreadySent()) would otherwise increment
 * batches_done a second time for work that was already counted — pushing
 * batches_done toward batches_total and potentially finalizing the campaign
 * as 'sent' while a DIFFERENT, still-outstanding batch never ran.
 *
 * Guarded by inserting (campaignId, batchIndex) into campaign_send_batches
 * via INSERT ... ON CONFLICT DO NOTHING (unique on campaign_id+batch_id):
 * batches_done is only incremented when that insert actually added a row,
 * i.e. the first time this batch is recorded for the current send attempt.
 */
async function advanceBatchProgress(campaignId: string, batchIndex: number): Promise<void> {
  const db = getDb();
  const batchId = String(batchIndex);

  const inserted = await executeChanges(
    db
      .insert(campaignSendBatches)
      .values({ campaign_id: campaignId, batch_id: batchId })
      .onConflictDoNothing(),
  );

  if (inserted > 0) {
    await db
      .update(emailCampaigns)
      .set({ batches_done: sql`${emailCampaigns.batches_done} + 1`, updated_at: new Date().toISOString() })
      .where(eq(emailCampaigns.id, campaignId))
      .run();
  } else {
    log.info("[campaign-send] duplicate batch delivery ignored (idempotent)", {
      campaignId,
      batchIndex,
    });
  }

  await finalizeIfComplete(campaignId);
}

/**
 * Finalize a campaign once every batch is accounted for
 * (batches_done + batches_failed >= batches_total): to 'sent' when none
 * failed, else 'failed' (partially sent — sent_count reflects the
 * successes). The UPDATE is guarded on status='sending', so concurrent
 * batches racing to the threshold finalize exactly once.
 */
export async function finalizeIfComplete(campaignId: string): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  // Decide AND write in a single atomic statement against LIVE column values.
  // A separate SELECT-then-UPDATE would be a TOCTOU race: a success-finalize
  // that read batches_failed=0 could otherwise win the write and mask a batch
  // that failed concurrently (e.g. the DLQ consumer running as a separate
  // Worker invocation). The status is chosen by SQL CASE from the current row,
  // and the status='sending' + threshold guards make it fire exactly once.
  // Mirrors reconcileStuckCampaigns in jobs/index.ts.
  const changed = await executeChanges(
    db
      .update(emailCampaigns)
      .set({
        status: sql`CASE WHEN ${emailCampaigns.batches_failed} > 0 THEN 'failed' ELSE 'sent' END`,
        sent_at: now,
        updated_at: now,
      })
      .where(
        and(
          eq(emailCampaigns.id, campaignId),
          eq(emailCampaigns.status, "sending"),
          sql`${emailCampaigns.batches_total} > 0`,
          sql`${emailCampaigns.batches_done} + ${emailCampaigns.batches_failed} >= ${emailCampaigns.batches_total}`,
        ),
      ),
  );

  if (changed > 0) {
    log.info("[campaign-send] campaign finalized", { campaignId });
  }
}
