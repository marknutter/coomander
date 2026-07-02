/**
 * Live campaign progress fan-out (#222).
 *
 * Thin, best-effort bridge from the campaign send/open paths to the agents
 * Worker's realtime channel layer: it publishes progress + open events on the
 * per-campaign channel `campaign:<id>`, which the admin campaign detail page
 * subscribes to via useRealtime (admin-only — see
 * apps/agents/src/channel/routing.ts `authorizeChannel`). This turns the old
 * "Sending in progress: N sent. Refresh to see the latest status." into a
 * live view with no manual refresh.
 *
 * INVARIANT: this is a UX layer on top of the D1 source of truth and must NEVER
 * affect send correctness. `publish()` is already non-throwing, but these
 * wrappers ALSO swallow any read/serialize error, so a broken realtime hop can
 * never fail a batch, drop a recipient, or skew sent_count. The DB row is
 * authoritative; the socket is just an instant-delivery optimization.
 */

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { emailCampaigns } from "@/lib/schema";
import { queryFirst } from "@/lib/db-helpers";
import { publish } from "@/lib/realtime";
import { log } from "@/lib/logger";

/** The realtime channel a campaign's live events fan out on. */
export function campaignChannel(campaignId: string): string {
  return `campaign:${campaignId}`;
}

export interface CampaignProgressEvent {
  type: "campaign-progress";
  campaignId: string;
  status: string;
  sentCount: number;
  recipientCount: number;
  batchesDone: number;
  batchesTotal: number;
  batchesFailed: number;
}

/**
 * Read the campaign's current progress counters and publish them to the
 * `campaign:<id>` channel. Called once per completed batch and on finalize, so
 * the cadence is per-batch (batch size 50) — NOT per recipient — which keeps a
 * large send from flooding the channel DO. Because the event carries the live
 * `status`, a single event type doubles as both "progress" and "finalized": when
 * `status` flips to `sent`/`failed`, subscribers render the terminal state.
 *
 * Best-effort: any error (read failure, no realtime binding) is logged and
 * swallowed — the send has already persisted its authoritative state.
 */
export async function publishCampaignState(campaignId: string): Promise<void> {
  try {
    const db = getDb();
    const c = await queryFirst(
      db
        .select({
          status: emailCampaigns.status,
          sent_count: emailCampaigns.sent_count,
          recipient_count: emailCampaigns.recipient_count,
          batches_done: emailCampaigns.batches_done,
          batches_total: emailCampaigns.batches_total,
          batches_failed: emailCampaigns.batches_failed,
        })
        .from(emailCampaigns)
        .where(eq(emailCampaigns.id, campaignId)),
    );
    if (!c) return;

    const event: CampaignProgressEvent = {
      type: "campaign-progress",
      campaignId,
      status: c.status,
      sentCount: c.sent_count ?? 0,
      recipientCount: c.recipient_count ?? 0,
      batchesDone: c.batches_done ?? 0,
      batchesTotal: c.batches_total ?? 0,
      batchesFailed: c.batches_failed ?? 0,
    };
    await publish(campaignChannel(campaignId), event as unknown as Record<string, unknown>);
  } catch (err) {
    log.warn("[campaign-realtime] publishCampaignState failed", {
      campaignId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Coalesce opens per campaign within a short window. Open tracking is bursty —
 * Apple Mail Privacy Protection and Gmail's image proxy pre-fetch pixels, so a
 * single campaign can take many pixel hits in a few seconds. The client already
 * debounces the analytics refetch, so it only needs "opens changed" nudges, not
 * one per pixel. This drops the server→realtime publish volume by skipping
 * repeat opens for the same campaign inside OPEN_COALESCE_MS.
 *
 * Caveat: this is PER-ISOLATE (Workers has no shared memory across isolates), so
 * it thins bursts that land on one isolate rather than globally coalescing — but
 * combined with the client debounce that's enough to keep a pixel storm from
 * fanning out unbounded. The map is capped so it can't grow without bound.
 */
const OPEN_COALESCE_MS = 750;
const OPEN_COALESCE_MAX_ENTRIES = 1000;
const lastOpenPublish = new Map<string, number>();

/**
 * Publish a lightweight "a recipient opened" signal to the campaign channel. The
 * client debounces this into an analytics refetch (the accurate unique-openers
 * count lives on the analytics endpoint), so the payload only needs to nudge —
 * we include the email for a richer UI, which is safe because the channel is
 * admin-only. Best-effort / non-throwing, like publishCampaignState. Coalesced
 * per campaign (see OPEN_COALESCE_MS) so a pixel-prefetch burst can't flood.
 */
export async function publishCampaignOpened(campaignId: string, email?: string): Promise<void> {
  try {
    const now = Date.now();
    const last = lastOpenPublish.get(campaignId) ?? 0;
    if (now - last < OPEN_COALESCE_MS) return; // recent open already nudged the client
    // Bound memory: a fresh Map is cheaper than tracking insertion order to evict.
    if (lastOpenPublish.size >= OPEN_COALESCE_MAX_ENTRIES) lastOpenPublish.clear();
    lastOpenPublish.set(campaignId, now);

    await publish(campaignChannel(campaignId), {
      type: "campaign-opened",
      campaignId,
      ...(email ? { email } : {}),
    });
  } catch (err) {
    log.warn("[campaign-realtime] publishCampaignOpened failed", {
      campaignId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
