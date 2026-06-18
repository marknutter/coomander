import { getEffectivePlan } from '@/lib/admin';

/**
 * Returns true if the user has any paid plan (pro, lifetime, or override).
 */
export async function hasPaidPlan(userId: string): Promise<boolean> {
  const { plan } = await getEffectivePlan(userId);
  return plan === 'pro' || plan === 'lifetime';
}

/**
 * Returns true if the user has a lifetime deal.
 */
export async function isLifetime(userId: string): Promise<boolean> {
  const { plan } = await getEffectivePlan(userId);
  return plan === 'lifetime';
}
