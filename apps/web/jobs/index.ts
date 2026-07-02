/**
 * Built-in job handlers and cron schedule registration.
 *
 * Called once at DB init time to register all handlers.
 * Cron scheduling is only started when ENABLE_CRON=true.
 */

import { eq, lt, lte, and, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { user, session as sessionTable, emailCampaigns } from "@/lib/schema";
import { log } from "@/lib/logger";
import { registerJob, enqueueJob, processJobs } from "@/lib/jobs";
import { registerCron, startCron } from "@/lib/cron";
import { executeChanges } from "@/lib/db-helpers";
import { parseAudienceFilter, resolveAudience } from "@/lib/audiences";
import { publishCampaignState } from "@/lib/campaign-realtime";

// ─── Job Handlers ────────────────────────────────────────────────────────────

async function cleanupSessions(): Promise<void> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const deleted = await executeChanges(
    db.delete(sessionTable).where(lt(sessionTable.expiresAt, now))
  );
  log.info("Cleaned up expired sessions", { deleted });
}

async function cleanupUnverified(): Promise<void> {
  const db = getDb();
  const sevenDaysAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
  const deleted = await executeChanges(
    db
      .delete(user)
      .where(and(eq(user.emailVerified, 0), lt(user.createdAt, sevenDaysAgo)))
  );
  log.info("Cleaned up unverified users", { deleted });
}

async function syncStripeStatus(): Promise<void> {
  if (!process.env.STRIPE_SECRET_KEY) {
    log.debug("STRIPE_SECRET_KEY not set, skipping sync-stripe-status");
    return;
  }

  // Lazy import to avoid requiring stripe when not configured
  const { getStripe } = await import("@/lib/stripe");
  const stripe = getStripe();
  const db = getDb();

  const users = await db
    .select({ id: user.id, stripeCustomerId: user.stripeCustomerId })
    .from(user)
    .where(isNotNull(user.stripeCustomerId));

  let updated = 0;
  for (const u of users) {
    try {
      const subscriptions = await stripe.subscriptions.list({
        customer: u.stripeCustomerId!,
        limit: 1,
      });

      const status =
        subscriptions.data.length > 0
          ? subscriptions.data[0].status
          : "inactive";

      await db.update(user).set({ subscriptionStatus: status }).where(eq(user.id, u.id));
      updated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("Failed to sync stripe status for user", {
        userId: u.id,
        error: msg,
      });
    }
  }

  log.info("Synced stripe subscription statuses", {
    total: users.length,
    updated,
  });
}

/**
 * Dispatch due scheduled campaigns (#597, epic #595, sync #222). Scans for
 * status='scheduled' whose scheduled_at has passed, atomically claims each
 * (scheduled→sending, guarding against double-dispatch on overlapping ticks),
 * resolves its audience, and enqueues the send via the #454 batched producer.
 */
export async function dispatchScheduledCampaigns(): Promise<void> {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const due = await db
    .select({
      id: emailCampaigns.id,
      subject: emailCampaigns.subject,
      html_content: emailCampaigns.html_content,
      audience_filter: emailCampaigns.audience_filter,
    })
    .from(emailCampaigns)
    .where(and(eq(emailCampaigns.status, "scheduled"), lte(emailCampaigns.scheduled_at, nowIso)))
    .all();

  if (due.length === 0) return;

  // Lazy-imported so campaign-send's Cloudflare-context probe doesn't run at
  // module load time (mirrors handleCampaignBatch above).
  const { enqueueCampaignSend } = await import("@/lib/campaign-send");

  let dispatched = 0;
  for (const c of due) {
    // Atomic claim: only the tick that flips scheduled→sending proceeds.
    const claimed = await executeChanges(
      db
        .update(emailCampaigns)
        .set({ status: "sending", updated_at: new Date().toISOString() })
        .where(and(eq(emailCampaigns.id, c.id), eq(emailCampaigns.status, "scheduled"))),
    );
    if (claimed === 0) continue;

    try {
      const recipients = await resolveAudience(parseAudienceFilter(c.audience_filter));
      await enqueueCampaignSend({
        campaignId: c.id,
        subject: c.subject,
        html: c.html_content,
        recipients,
      });
      dispatched++;
    } catch (err) {
      log.error("Failed to dispatch scheduled campaign", {
        campaignId: c.id,
        error: err instanceof Error ? err.message : String(err),
      });
      await db
        .update(emailCampaigns)
        .set({ status: "failed", updated_at: new Date().toISOString() })
        .where(eq(emailCampaigns.id, c.id))
        .run();
      // Live-notify watchers that a scheduled send failed to dispatch (#222).
      await publishCampaignState(c.id);
    }
  }

  log.info("Dispatched scheduled campaigns", { due: due.length, dispatched });
}

/**
 * Reconcile stuck campaigns (hardening follow-up, sync #222). A campaign
 * whose batch failed to complete (retry exhaustion / a dropped queue message
 * with no dead-letter consumer configured) can sit in status='sending'
 * forever, since finalize only fires when all batches are accounted for.
 * This backstop marks such campaigns 'failed': status='sending' with no
 * progress update for STUCK_CAMPAIGN_MINUTES and batches still outstanding. A
 * genuinely-progressing send refreshes updated_at on every completed batch,
 * so it never trips. Atomic + idempotent (guarded on status='sending').
 */
const STUCK_CAMPAIGN_MINUTES = Math.max(
  1,
  parseInt(process.env.STUCK_CAMPAIGN_MINUTES || "60", 10) || 60,
);

export async function reconcileStuckCampaigns(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - STUCK_CAMPAIGN_MINUTES * 60_000).toISOString();

  const stuckPredicate = and(
    eq(emailCampaigns.status, "sending"),
    lt(emailCampaigns.updated_at, cutoff),
    sql`${emailCampaigns.batches_total} > 0`,
    sql`${emailCampaigns.batches_done} + ${emailCampaigns.batches_failed} < ${emailCampaigns.batches_total}`,
  );

  // Capture the ids about to be reconciled BEFORE the bulk update, so we can
  // fan out a live "failed" event per campaign afterwards (#222) — the bulk
  // UPDATE only returns a count. A campaign that finalizes on its own between
  // this select and the update simply won't match the update; re-publishing its
  // (now-terminal) state is still harmless since publishCampaignState reads live.
  const stuck = await db
    .select({ id: emailCampaigns.id })
    .from(emailCampaigns)
    .where(stuckPredicate)
    .all();

  const changed = await executeChanges(
    db
      .update(emailCampaigns)
      .set({
        status: "failed",
        batches_failed: sql`${emailCampaigns.batches_total} - ${emailCampaigns.batches_done}`,
        updated_at: now,
      })
      .where(stuckPredicate),
  );

  if (changed > 0) {
    log.warn("Reconciled stuck campaigns to failed", { count: changed, thresholdMinutes: STUCK_CAMPAIGN_MINUTES });
    // Live-notify anyone watching a stuck campaign that it flipped to failed, so
    // the detail page doesn't sit on "Sending… Updating live…" until a refresh.
    for (const c of stuck) {
      await publishCampaignState(c.id);
    }
  }
}

// ─── Registration ────────────────────────────────────────────────────────────

const ONE_MINUTE = 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const TWENTY_FOUR_HOURS = 24 * ONE_HOUR;

/**
 * Register all built-in job handlers. Always called at startup.
 */
async function handleDeliverWebhook(payload: Record<string, unknown>): Promise<void> {
  const { deliverWebhook } = await import("@/lib/webhooks");
  await deliverWebhook(payload);
}

// Campaign send batch (#454, epic #595, sync #222): the dev/non-Workers
// transport for lib/campaign-send.ts's producer/consumer. Lazy-imported so
// campaign-send's Cloudflare-context probe doesn't run at module load time.
async function handleCampaignBatch(payload: Record<string, unknown>): Promise<void> {
  const { processCampaignBatch } = await import("@/lib/campaign-send");
  await processCampaignBatch(payload as unknown as import("@/lib/campaign-send").CampaignBatchPayload);
}

export function registerBuiltinJobs(): void {
  registerJob("cleanup-sessions", cleanupSessions);
  registerJob("cleanup-unverified", cleanupUnverified);
  registerJob("sync-stripe-status", syncStripeStatus);
  registerJob("deliver-webhook", handleDeliverWebhook);
  registerJob("send-campaign-batch", handleCampaignBatch);
  registerJob("dispatch-scheduled-campaigns", dispatchScheduledCampaigns);
  registerJob("reconcile-stuck-campaigns", reconcileStuckCampaigns);
  log.info("Built-in job handlers registered");
}

/**
 * Register cron schedules and start the scheduler.
 * Only called when ENABLE_CRON=true.
 */
export function startBuiltinCrons(): void {
  registerCron("cleanup-sessions", TWENTY_FOUR_HOURS, async () => {
    await enqueueJob("cleanup-sessions");
    await processJobs(10);
  });

  registerCron("cleanup-unverified", TWENTY_FOUR_HOURS, async () => {
    await enqueueJob("cleanup-unverified");
    await processJobs(10);
  });

  registerCron("sync-stripe-status", ONE_HOUR, async () => {
    await enqueueJob("sync-stripe-status");
    await processJobs(10);
  });

  // Scheduled one-off campaign sends (#597/#222). Checked every minute in dev
  // for a snappy "schedule it 2 min out and watch it fire" QA loop; prod runs
  // it off the */15 Workers Cron Trigger (see custom-worker.ts + wrangler.toml
  // [triggers]). The dispatcher enqueues per-batch send jobs, so drain a
  // generous batch here.
  registerCron("dispatch-scheduled-campaigns", ONE_MINUTE, async () => {
    await enqueueJob("dispatch-scheduled-campaigns");
    await processJobs(50);
  });

  // Stuck-campaign backstop (hardening follow-up, sync #222). Prod runs it off
  // the same 15-minute Workers Cron Trigger as dispatch-scheduled-campaigns
  // (see custom-worker.ts + wrangler.toml [triggers]).
  registerCron("reconcile-stuck-campaigns", FIFTEEN_MINUTES, async () => {
    await enqueueJob("reconcile-stuck-campaigns");
    await processJobs(10);
  });

  startCron();
}
