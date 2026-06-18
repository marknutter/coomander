import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { isAdmin, getEffectivePlan } from "@/lib/admin";
import { getRawAdapter } from "@/lib/db-raw";
import { isPg } from "@/lib/db-dialect";
import { UserDetailView } from "@/components/admin/user-detail";
import type { UserDetail } from "@/components/admin/user-detail";

interface PageProps {
  params: Promise<{ id: string }>;
}

async function fetchUserFromDb(id: string): Promise<UserDetail | null> {
  const adapter = getRawAdapter();
  const userTable = isPg() ? '"user"' : "user";
  const q = (col: string) => isPg() ? `"${col}"` : col;

  const user = await adapter.queryFirst<{
    id: string;
    email: string;
    name: string | null;
    plan: string;
    created_at: string | number;
    isAdmin: number;
    subscription_status: string;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
    emailVerified: number;
    disabled: number | null;
    provider: string | null;
    override_plan: string | null;
    override_reason: string | null;
    override_expires_at: string | null;
    override_created_at: string | null;
    override_granted_by: string | null;
    items_count: number;
  }>(
    `SELECT
       u.id,
       u.email,
       u.name,
       u.plan,
       u.${q("createdAt")} AS created_at,
       u.${q("isAdmin")} AS "isAdmin",
       u.${q("subscriptionStatus")} AS subscription_status,
       u.${q("stripeCustomerId")} AS "stripeCustomerId",
       u.${q("stripeSubscriptionId")} AS "stripeSubscriptionId",
       u.${q("emailVerified")} AS "emailVerified",
       u.disabled,
       (SELECT a.${q("providerId")} FROM account a WHERE a.${q("userId")} = u.id LIMIT 1) AS provider,
       po.plan AS override_plan,
       po.reason AS override_reason,
       po.expires_at AS override_expires_at,
       po.created_at AS override_created_at,
       po.granted_by AS override_granted_by,
       (SELECT COUNT(*) FROM items i WHERE i.user_id = u.id) AS items_count
     FROM ${userTable} u
     LEFT JOIN plan_overrides po ON po.user_id = u.id
     WHERE u.id = ?`,
    id
  );

  if (!user) return null;

  const effective = await getEffectivePlan(id);

  const createdAt = typeof user.created_at === "number"
    ? new Date(user.created_at).toISOString()
    : user.created_at;

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: user.plan ?? "free",
    effectivePlan: effective.plan,
    created_at: createdAt,
    isAdmin: user.isAdmin === 1,
    subscription_status: user.subscription_status ?? "inactive",
    stripeCustomerId: user.stripeCustomerId,
    stripeSubscriptionId: user.stripeSubscriptionId,
    provider: user.provider ?? "email",
    emailVerified: user.emailVerified === 1,
    disabled: user.disabled === 1,
    planOverride: user.override_plan
      ? {
          plan: user.override_plan,
          reason: user.override_reason,
          expiresAt: user.override_expires_at,
          createdAt: user.override_created_at,
          grantedBy: user.override_granted_by,
          active: effective.override,
        }
      : null,
    itemsCount: user.items_count,
  };
}

export default async function UserDetailPage({ params }: PageProps) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) redirect("/auth");
  if (!(await isAdmin(session.user.id))) redirect("/app");

  const { id } = await params;

  if (!id) notFound();

  const user = await fetchUserFromDb(id);
  if (!user) notFound();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          User: {user.email}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">ID: {user.id}</p>
      </div>
      <UserDetailView user={user} />
    </div>
  );
}
