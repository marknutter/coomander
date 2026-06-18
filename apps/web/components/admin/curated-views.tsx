"use client";

import Link from "next/link";
import { Users, Package } from "lucide-react";

interface CuratedView {
  label: string;
  table: string;
  description: string;
  icon: React.ReactNode;
  defaultSort?: string;
}

const CURATED_VIEWS: CuratedView[] = [
  {
    label: "Users",
    table: "user",
    description: "All registered user accounts",
    icon: <Users className="h-5 w-5" />,
    defaultSort: "createdAt",
  },
  {
    label: "Items",
    table: "items",
    description: "User item entries",
    icon: <Package className="h-5 w-5" />,
    defaultSort: "created_at",
  },
];

export function CuratedViews() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {CURATED_VIEWS.map((view) => {
        const href = `/admin/database/raw?table=${encodeURIComponent(view.table)}${view.defaultSort ? `&sort=${view.defaultSort}&order=desc` : ""}`;
        return (
          <Link
            key={view.table}
            href={href}
            className="flex items-start gap-3 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:border-primary/90 hover:shadow-sm transition-all group"
          >
            <span className="mt-0.5 text-zinc-500 dark:text-zinc-400 group-hover:text-primary/80 dark:group-hover:text-primary/80 transition-colors">
              {view.icon}
            </span>
            <div>
              <p className="font-semibold text-zinc-900 dark:text-zinc-100 group-hover:text-primary/80 dark:group-hover:text-primary/80 transition-colors">
                {view.label}
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">{view.description}</p>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
