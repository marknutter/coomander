/**
 * Lightweight in-process cron scheduler using setInterval.
 *
 * Usage:
 *   import { registerCron, startCron, stopCron } from "@/lib/cron";
 *
 *   registerCron("cleanup", 60_000, () => { ... });
 *   startCron();   // starts all registered intervals
 *   stopCron();    // clears all intervals
 */

import { log } from "@/lib/logger";

interface CronEntry {
  name: string;
  intervalMs: number;
  handler: () => void | Promise<void>;
  timer?: ReturnType<typeof setInterval>;
}

const entries: CronEntry[] = [];
let running = false;

/**
 * Register a cron job. Must be called before startCron().
 */
export function registerCron(
  name: string,
  intervalMs: number,
  handler: () => void | Promise<void>,
): void {
  entries.push({ name, intervalMs, handler });
  log.debug("Registered cron job", { name, intervalMs });
}

/**
 * Start all registered cron jobs.
 */
export function startCron(): void {
  if (running) {
    log.warn("Cron scheduler already running");
    return;
  }

  running = true;

  for (const entry of entries) {
    entry.timer = setInterval(async () => {
      log.info("Cron executing", { name: entry.name });
      try {
        await entry.handler();
        log.info("Cron completed", { name: entry.name });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error("Cron failed", { name: entry.name, error: message });
      }
    }, entry.intervalMs);

    log.info("Cron scheduled", {
      name: entry.name,
      intervalMs: entry.intervalMs,
    });
  }

  log.info("Cron scheduler started", { jobCount: entries.length });
}

/**
 * Stop all cron jobs.
 */
export function stopCron(): void {
  for (const entry of entries) {
    if (entry.timer) {
      clearInterval(entry.timer);
      entry.timer = undefined;
    }
  }
  running = false;
  log.info("Cron scheduler stopped");
}
