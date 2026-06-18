import { sendEmail, FROM } from './email';
import { applyCampaignTracking } from './email-tracking';
import { getDb } from './db';
import { emailEvents } from './schema';

/**
 * Send a campaign directly to subscribers via individual emails.
 *
 * Cloudflare Email Service has no audience/broadcast or contact API, so a
 * campaign is sent one email per recipient through the unified sendEmail()
 * transport (Workers binding → REST API → console fallback). Sends are
 * sequential to avoid rate-limit issues.
 *
 * Each recipient's HTML is personalized with open/click tracking (a unique
 * signed token per recipient), and a `sent` event is recorded in email_events
 * with the provider message id — the correlation key the delivery poller uses
 * to attribute Delivered/Bounced later.
 */
export async function sendCampaignDirect(
  campaignId: string,
  subject: string,
  html: string,
  emails: string[],
): Promise<{ sent: number; failed: number }> {
  const db = getDb();
  let sent = 0;
  let failed = 0;

  for (const to of emails) {
    try {
      const trackedHtml = applyCampaignTracking(html, { campaignId, email: to });
      const { messageId } = await sendEmail({ from: FROM, to, subject, html: trackedHtml });

      try {
        await db
          .insert(emailEvents)
          .values({
            email_id: messageId ?? null,
            campaign_id: campaignId,
            subscriber_email: to,
            event_type: "sent",
          })
          .run();
      } catch (logErr) {
        // A logging failure must not count the send itself as failed.
        console.error(`[broadcasts] failed to record sent event for ${to}:`, logErr);
      }

      sent++;
    } catch (err) {
      console.error(`[broadcasts] send to ${to} failed:`, err);
      failed++;
    }
  }

  return { sent, failed };
}
