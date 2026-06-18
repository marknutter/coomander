import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { user } from '@/lib/schema';
import { getStripe } from '@/lib/stripe';
import { queryFirst } from '@/lib/db-helpers';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const limited = rateLimit.check(request);
  if (limited) return limited;
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const type = (body as { type?: string }).type ?? 'subscription';

  const db = getDb();
  const stripe = getStripe();

  const row = await queryFirst(
    db
      .select({ id: user.id, email: user.email, stripeCustomerId: user.stripeCustomerId })
      .from(user)
      .where(eq(user.id, session.user.id))
  );

  if (!row) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Get or create Stripe customer
  let customerId = row.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: row.email,
      metadata: { userId: row.id },
    });
    customerId = customer.id;
    await db.update(user).set({ stripeCustomerId: customerId }).where(eq(user.id, row.id));
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  if (type === 'lifetime') {
    const lifetimePriceId = process.env.STRIPE_LIFETIME_PRICE_ID;
    if (!lifetimePriceId) {
      console.error('[stripe/create-checkout] STRIPE_LIFETIME_PRICE_ID is not set');
      return NextResponse.json({ error: 'Lifetime checkout not configured' }, { status: 500 });
    }

    const checkoutSession = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [
        {
          price: lifetimePriceId,
          quantity: 1,
        },
      ],
      success_url: `${appUrl}/app?upgraded=1`,
      cancel_url: `${appUrl}/app`,
      allow_promotion_codes: true,
    });

    return NextResponse.json({ url: checkoutSession.url });
  }

  // Default: subscription checkout
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) {
    console.error('[stripe/create-checkout] STRIPE_PRICE_ID is not set');
    return NextResponse.json({ error: 'Checkout not configured' }, { status: 500 });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: 'subscription',
    line_items: [
      {
        price: priceId,
        quantity: 1,
      },
    ],
    success_url: `${appUrl}/app?upgraded=1`,
    cancel_url: `${appUrl}/app`,
    allow_promotion_codes: true,
  });

  return NextResponse.json({ url: checkoutSession.url });
}
