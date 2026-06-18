import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { getDb } from '@/lib/db';
import { user } from '@/lib/schema';
import { getEffectivePlan } from '@/lib/admin';
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
      .select({ subscriptionStatus: user.subscriptionStatus })
      .from(user)
      .where(eq(user.id, session.user.id))
  );

  if (!row) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const { plan } = await getEffectivePlan(session.user.id);

  return NextResponse.json({
    plan,
    status: row.subscriptionStatus ?? 'inactive',
  });
}
