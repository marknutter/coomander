import { getResend, FROM } from './email';
import { getDb } from './db';
import { newsletterSubscribers } from './schema';
import { eq, and } from 'drizzle-orm';

export interface BroadcastPayload {
  name: string;
  subject: string;
  html: string;
  audienceId: string;
  previewText?: string;
  scheduledAt?: string;
}

/**
 * Create and send a broadcast via Resend Broadcasts API.
 * Two-step: create the broadcast, then send it.
 */
export async function sendBroadcast(payload: BroadcastPayload): Promise<{ id: string }> {
  const resend = getResend();

  // Step 1: Create the broadcast
  const createResult = await resend.broadcasts.create({
    from: FROM,
    audienceId: payload.audienceId,
    subject: payload.subject,
    html: payload.html,
    name: payload.name,
    previewText: payload.previewText,
  });

  const broadcastId = createResult.data?.id;
  if (!broadcastId) {
    throw new Error('Failed to create broadcast: no ID returned');
  }

  // Step 2: Send it (optionally schedule)
  await resend.broadcasts.send(broadcastId, payload.scheduledAt ? {
    scheduledAt: payload.scheduledAt,
  } : undefined);

  return { id: broadcastId };
}

/**
 * Sync active local subscribers to a Resend Audience.
 * Upserts contacts so it's safe to call repeatedly.
 */
export async function syncSubscribersToAudience(audienceId: string): Promise<{ synced: number }> {
  const resend = getResend();
  const db = getDb();

  const subscribers = await db
    .select({ email: newsletterSubscribers.email })
    .from(newsletterSubscribers)
    .where(
      and(
        eq(newsletterSubscribers.status, 'active'),
      )
    )
    .all();

  let synced = 0;
  for (const sub of subscribers) {
    try {
      await resend.contacts.create({
        audienceId,
        email: sub.email,
      });
      synced++;
    } catch {
      // Contact may already exist — ignore
    }
  }

  return { synced };
}

/**
 * Send a campaign directly to subscribers via individual emails.
 * Used when no Resend Audience is configured (sends via Resend batch API).
 */
export async function sendCampaignDirect(
  subject: string,
  html: string,
  emails: string[],
): Promise<{ sent: number; failed: number }> {
  const resend = getResend();
  let sent = 0;
  let failed = 0;

  // Send in batches of 100 (Resend batch limit)
  for (let i = 0; i < emails.length; i += 100) {
    const batch = emails.slice(i, i + 100).map((to) => ({
      from: FROM,
      to,
      subject,
      html,
    }));
    try {
      await resend.batch.send(batch);
      sent += batch.length;
    } catch (err) {
      console.error('[broadcasts] batch send failed:', err);
      failed += batch.length;
    }
  }

  return { sent, failed };
}
