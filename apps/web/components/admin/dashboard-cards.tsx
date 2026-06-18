import { Card } from "@/components/ui";

interface MetricCardProps {
  label: string;
  value: number | string;
  subLabel?: string;
}

function MetricCard({ label, value, subLabel }: MetricCardProps) {
  return (
    <Card>
      <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <p className="mt-2 text-3xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
      {subLabel && (
        <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">{subLabel}</p>
      )}
    </Card>
  );
}

interface DashboardCardsProps {
  data: {
    totalUsers: number;
    activeUsers: number;
    planBreakdown: { pro: number; free: number };
    totalItems: number;
  };
}

export function DashboardCards({ data }: DashboardCardsProps) {
  const { totalUsers, activeUsers, planBreakdown, totalItems } = data;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <MetricCard label="Total Users" value={totalUsers} />
      <MetricCard
        label="Active Users"
        value={activeUsers}
        subLabel="Items added in last 30 days"
      />
      <MetricCard
        label="Pro Users"
        value={planBreakdown.pro}
        subLabel={`${planBreakdown.free} on free plan`}
      />
      <MetricCard label="Total Items" value={totalItems} />
    </div>
  );
}
