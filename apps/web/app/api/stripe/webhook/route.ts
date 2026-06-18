import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { user } from '@/lib/schema';
import { getStripe } from '@/lib/stripe';
import { sendLifetimePurchaseEmail, sendSubscriptionConfirmationEmail, sendSubscriptionCancelledEmail, sendPaymentFailedEmail } from '@/lib/email';
import { queryFirst } from '@/lib/db-helpers';
import { trackSubscriptionChange } from '@/lib/marketing';
import Stripe from 'stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get('stripe-signature') || '';
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error('[stripe/webhook] STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error('[stripe/webhook] signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  const db = getDb();

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = session.customer as string;

        if (session.mode === 'payment') {
          // Lifetime one-time payment
          await db.update(user)
            .set({ plan: 'lifetime', subscriptionStatus: 'active' })
            .where(eq(user.stripeCustomerId, customerId));

          // Send confirmation email
          const row = await queryFirst(
            db
              .select({ email: user.email })
              .from(user)
              .where(eq(user.stripeCustomerId, customerId))
          );
          if (row?.email) {
            sendLifetimePurchaseEmail(row.email).catch((err) =>
              console.error('[stripe/webhook] sendLifetimePurchaseEmail failed:', err)
            );
          }
        } else {
          // Subscription checkout
          const subscriptionId = session.subscription as string;
          await db.update(user)
            .set({ plan: 'pro', subscriptionStatus: 'active', stripeSubscriptionId: subscriptionId })
            .where(eq(user.stripeCustomerId, customerId));

          // Send subscription confirmation email
          const subRow = await queryFirst(
            db
              .select({ email: user.email })
              .from(user)
              .where(eq(user.stripeCustomerId, customerId))
          );
          if (subRow?.email) {
            sendSubscriptionConfirmationEmail(subRow.email, 'Pro').catch((err) =>
              console.error('[stripe/webhook] sendSubscriptionConfirmationEmail failed:', err)
            );
            trackSubscriptionChange(subRow.email, 'pro', 'active');
          }
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;
        await db.update(user)
          .set({ subscriptionStatus: sub.status })
          .where(eq(user.stripeCustomerId, customerId));
        break;
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = sub.customer as string;

        // Guard: never downgrade lifetime users when a subscription is deleted
        const row = await queryFirst(
          db
            .select({ plan: user.plan })
            .from(user)
            .where(eq(user.stripeCustomerId, customerId))
        );

        if (row?.plan === 'lifetime') {
          break;
        }

        await db.update(user)
          .set({ plan: 'free', subscriptionStatus: 'inactive', stripeSubscriptionId: null })
          .where(eq(user.stripeCustomerId, customerId));

        // Send cancellation email
        const cancelRow = await queryFirst(
          db
            .select({ email: user.email })
            .from(user)
            .where(eq(user.stripeCustomerId, customerId))
        );
        if (cancelRow?.email) {
          sendSubscriptionCancelledEmail(cancelRow.email).catch((err) =>
            console.error('[stripe/webhook] sendSubscriptionCancelledEmail failed:', err)
          );
          trackSubscriptionChange(cancelRow.email, 'free', 'inactive');
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = invoice.customer as string;
        await db.update(user)
          .set({ subscriptionStatus: 'past_due' })
          .where(eq(user.stripeCustomerId, customerId));

        // Send payment failed email
        const failRow = await queryFirst(
          db
            .select({ email: user.email })
            .from(user)
            .where(eq(user.stripeCustomerId, customerId))
        );
        if (failRow?.email) {
          sendPaymentFailedEmail(failRow.email).catch((err) =>
            console.error('[stripe/webhook] sendPaymentFailedEmail failed:', err)
          );
          trackSubscriptionChange(failRow.email, 'pro', 'past_due');
        }
        break;
      }

      default:
        // Unhandled event type — ignore
        break;
    }
  } catch (err) {
    console.error('[stripe/webhook] error handling event:', event.type, err);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
