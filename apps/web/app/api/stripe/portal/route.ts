import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { user } from '@/lib/schema';
import { getStripe } from '@/lib/stripe';
import { queryFirst } from '@/lib/db-helpers';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  const row = await queryFirst(
    getDb()
      .select({ stripeCustomerId: user.stripeCustomerId })
      .from(user)
      .where(eq(user.id, session.user.id))
  );

  if (!row?.stripeCustomerId) {
    return NextResponse.json({ error: 'No Stripe customer found' }, { status: 404 });
  }

  const appUrl = process.env.APP_URL || 'http://localhost:3000';

  const portalSession = await getStripe().billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${appUrl}/app`,
  });

  return NextResponse.json({ url: portalSession.url });
}
