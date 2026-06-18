/**
 * SQLite-backed background job queue.
 *
 * Usage:
 *   import { registerJob, enqueueJob, processJobs } from "@/lib/jobs";
 *
 *   registerJob("send-email", async (payload) => { ... });
 *   await enqueueJob("send-email", { to: "user@example.com" });
 *   await processJobs(); // run pending jobs
 */

import crypto from "crypto";
import { eq, and, lte, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { jobs } from "@/lib/schema";
import { log } from "@/lib/logger";
import { queryFirst } from "@/lib/db-helpers";

type JobHandler = (payload: Record<string, unknown>) => void | Promise<void>;

const handlers = new Map<string, JobHandler>();

/**
 * Register a handler for a given job type.
 */
export function registerJob(
  type: string,
  handler: JobHandler,
): void {
  handlers.set(type, handler);
  log.debug("Registered job handler", { type });
}

/**
 * Enqueue a job to run immediately or at a scheduled time.
 * Returns the job ID.
 */
export async function enqueueJob(
  type: string,
  payload?: Record<string, unknown>,
  scheduledAt?: Date,
): Promise<string> {
  const db = getDb();
  const id = crypto.randomUUID();
  const scheduledEpoch = scheduledAt
    ? Math.floor(scheduledAt.getTime() / 1000)
    : Math.floor(Date.now() / 1000);

  await db.insert(jobs).values({
    id,
    type,
    payload: JSON.stringify(payload ?? {}),
    status: "pending",
    scheduledAt: scheduledEpoch,
  });

  log.info("Job enqueued", { jobId: id, type });
  return id;
}

/**
 * Process pending jobs. Supports both sync and async handlers.
 * Returns counts of processed and failed jobs.
 */
export async function processJobs(
  limit = 50,
): Promise<{ processed: number; failed: number }> {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const pending = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "pending"),
        lte(jobs.scheduledAt, now),
        sql`${jobs.attempts} < ${jobs.maxAttempts}`,
      ),
    )
    .orderBy(jobs.scheduledAt)
    .limit(limit);

  let processed = 0;
  let failed = 0;

  for (const job of pending) {
    const handler = handlers.get(job.type);
    if (!handler) {
      log.warn("No handler registered for job type", { type: job.type, jobId: job.id });
      await db.update(jobs)
        .set({
          status: "failed",
          lastError: `No handler registered for job type: ${job.type}`,
          attempts: sql`${jobs.attempts} + 1`,
        })
        .where(eq(jobs.id, job.id));
      failed++;
      continue;
    }

    // Mark as running
    await db.update(jobs)
      .set({
        status: "running",
        startedAt: now,
        attempts: sql`${jobs.attempts} + 1`,
      })
      .where(eq(jobs.id, job.id));

    try {
      const payload = JSON.parse(job.payload) as Record<string, unknown>;
      await handler(payload);

      await db.update(jobs)
        .set({
          status: "completed",
          completedAt: Math.floor(Date.now() / 1000),
        })
        .where(eq(jobs.id, job.id));

      log.info("Job completed", { jobId: job.id, type: job.type });
      processed++;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const currentAttempts = job.attempts + 1; // already incremented in DB
      if (currentAttempts >= job.maxAttempts) {
        await db.update(jobs)
          .set({ status: "failed", lastError: errorMsg })
          .where(eq(jobs.id, job.id));
        log.error("Job failed permanently", {
          jobId: job.id,
          type: job.type,
          error: errorMsg,
          attempts: currentAttempts,
        });
      } else {
        // Exponential backoff: 2^attempts * 60 seconds
        const backoffSeconds = Math.pow(2, currentAttempts) * 60;
        const nextRun = Math.floor(Date.now() / 1000) + backoffSeconds;
        await db.update(jobs)
          .set({
            status: "pending",
            lastError: errorMsg,
            scheduledAt: nextRun,
          })
          .where(eq(jobs.id, job.id));
        log.warn("Job failed, will retry", {
          jobId: job.id,
          type: job.type,
          error: errorMsg,
          attempts: currentAttempts,
          nextRunIn: `${backoffSeconds}s`,
        });
      }
      failed++;
    }
  }

  return { processed, failed };
}
