import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { emailEvents, newsletterSubscribers } from "@/lib/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EVENT_TYPE_MAP: Record<string, string> = {
  "email.delivered": "delivered",
  "email.opened": "opened",
  "email.clicked": "clicked",
  "email.bounced": "bounced",
  "email.complained": "complained",
};

interface ResendWebhookPayload {
  type: string;
  data: {
    email_id?: string;
    to?: string[];
    created_at?: string;
    click?: { link: string };
    tags?: { name: string; value: string }[];
  };
}

export async function POST(req: NextRequest) {
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;

  // Verify webhook signature if secret is configured
  if (webhookSecret) {
    const signature = req.headers.get("resend-signature") ?? "";
    if (!signature) {
      return NextResponse.json({ error: "Missing signature" }, { status: 401 });
    }
    // TODO: Replace with svix verification once svix package is added
    // For now, basic presence check — upgrade to full HMAC in production
  }

  let payload: ResendWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventType = EVENT_TYPE_MAP[payload.type];
  if (!eventType) {
    // Untracked event type — acknowledge but don't store
    return NextResponse.json({ received: true });
  }

  const db = getDb();
  const subscriberEmail = payload.data.to?.[0];

  // Extract campaign_id from Resend tags if present
  const campaignTag = payload.data.tags?.find((t) => t.name === "campaign_id");
  const campaignId = campaignTag?.value ?? null;

  await db.insert(emailEvents)
    .values({
      email_id: payload.data.email_id ?? null,
      campaign_id: campaignId,
      subscriber_email: subscriberEmail ?? null,
      event_type: eventType,
      link_url: payload.data.click?.link ?? null,
      metadata: JSON.stringify(payload.data),
    })
    .run();

  // Auto-unsubscribe on hard bounce or complaint
  if ((eventType === "bounced" || eventType === "complained") && subscriberEmail) {
    await db.update(newsletterSubscribers)
      .set({ status: "unsubscribed", unsubscribed_at: new Date().toISOString() })
      .where(eq(newsletterSubscribers.email, subscriberEmail))
      .run();
  }

  return NextResponse.json({ received: true });
}
