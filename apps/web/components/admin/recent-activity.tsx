import { UserPlus, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";

export interface ActivityItem {
  type: "signup" | "admin_action";
  description: string;
  timestamp: string;
}

const activityIcons = {
  signup: UserPlus,
  admin_action: ShieldCheck,
};

const activityIconColors = {
  signup: "text-primary",
  admin_action: "text-blue-500",
};

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

interface RecentActivityProps {
  items: ActivityItem[];
}

export function RecentActivity({ items }: RecentActivityProps) {
  return (
    <Card title="Recent Activity">
      {items.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-500 py-4 text-center">
          No recent activity.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-700 -mx-5">
          {items.map((item, idx) => {
            const Icon = activityIcons[item.type];
            const iconColor = activityIconColors[item.type];
            return (
              <li key={idx} className="flex items-start gap-3 px-5 py-3">
                <span
                  className={cn("mt-0.5 flex-shrink-0", iconColor)}
                  aria-hidden="true"
                >
                  <Icon className="h-4 w-4" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-800 dark:text-zinc-200 truncate">
                    {item.description}
                  </p>
                </div>
                <time
                  dateTime={item.timestamp}
                  className="flex-shrink-0 text-xs text-zinc-400 dark:text-zinc-500 mt-0.5"
                >
                  {formatTimestamp(item.timestamp)}
                </time>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
