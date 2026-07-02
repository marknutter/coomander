/**
 * Cloudflare Queue consumer dispatch for campaign sends (#454, epic #595, sync
 * #222).
 *
 * On Workers, the CAMPAIGN_QUEUE consumer is bound to THIS worker (see
 * `[[queues.consumers]]` in wrangler.toml). Like the ping cron's `scheduled()`
 * handler, the queue handler can't touch D1 directly from the consumer context
 * (the OpenNext request context — and thus the DB binding — isn't set up), so
 * each message is replayed through the app's own fetch pipeline as an internal
 * POST to `/api/internal/campaign-batch`, which runs processCampaignBatch().
 *
 * Per-message ack/retry maps onto CF Queue's native retry/backoff:
 *   - 2xx  → ack (batch done, or permanently-skipped recipients)
 *   - else → retry (e.g. 429 rate-limit; the batch is idempotent so already-sent
 *            recipients are skipped on replay)
 *
 * Auth: the internal route is protected by AGENTS_INTERNAL_SECRET (Coomander's
 * existing shared-secret pattern for server-to-server calls — see
 * lib/internal-auth.ts), presented via the `x-agents-internal-secret` header.
 * Deliberately NOT AppSeed's CRON_SECRET.
 *
 * Pure and typed for unit testing; custom-worker.ts wires it to the real fetch
 * handler.
 */

interface QueueMessageLike {
  body: unknown;
  ack(): void;
  retry(): void;
}

interface QueueBatchLike {
  messages: QueueMessageLike[];
  /** The queue this batch came from; the dead-letter queue ends with "-dlq". */
  queue?: string;
}

interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

type QueueEnv = Record<string, string | undefined>;

type FetchHandler = (
  request: Request,
  env: QueueEnv,
  ctx: ExecutionContextLike,
) => Promise<Response> | Response;

/** Build the internal request that runs one campaign batch, or null if the
 * worker isn't configured (no AGENTS_INTERNAL_SECRET → batches are retried
 * until set). When `dead` is true the batch is instead recorded as a
 * permanently-failed batch (dead-letter path, hardening follow-up) so the
 * campaign finalizes to 'failed' rather than sitting in 'sending' forever. */
export function buildCampaignBatchRequest(body: unknown, env: QueueEnv, dead = false): Request | null {
  const secret = env.AGENTS_INTERNAL_SECRET;
  if (!secret) return null;
  const base = env.APP_URL || env.BETTER_AUTH_URL || "https://localhost";
  const url = new URL("/api/internal/campaign-batch", base);
  if (dead) url.searchParams.set("dead", "1");
  return new Request(url.toString(), {
    method: "POST",
    headers: {
      "x-agents-internal-secret": secret,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

/**
 * Handle a CAMPAIGN_QUEUE batch. Each message is dispatched independently and
 * ack/retried on its own outcome. Never throws.
 */
export async function handleQueueBatch(
  batch: QueueBatchLike,
  env: QueueEnv,
  ctx: ExecutionContextLike,
  fetchHandler: FetchHandler,
): Promise<void> {
  // Batches arriving on the dead-letter queue exhausted their retries — record
  // them as failed batches instead of trying to send again (hardening
  // follow-up).
  const dead = typeof batch.queue === "string" && batch.queue.endsWith("-dlq");
  for (const message of batch.messages) {
    const req = buildCampaignBatchRequest(message.body, env, dead);
    if (!req) {
      console.warn("[campaign-queue] no AGENTS_INTERNAL_SECRET configured — retrying batch later");
      message.retry();
      continue;
    }
    try {
      const res = await Promise.resolve(fetchHandler(req, env, ctx));
      if (res.ok) {
        message.ack();
      } else {
        const body = await res.text().catch(() => "");
        console.warn(`[campaign-queue] batch failed: ${res.status} ${body} — retrying`);
        message.retry();
      }
    } catch (err) {
      console.error("[campaign-queue] batch dispatch threw — retrying:", err);
      message.retry();
    }
  }
}
