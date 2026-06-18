"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  Database,
  BarChart3,
  Mail,
  ScrollText,
  Shield,
  ArrowLeft,
  ListChecks,
  BookOpen,
  Megaphone,
} from "lucide-react";
import { cn } from "@/lib/cn";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/database", label: "Database", icon: Database },
  { href: "/admin/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/admin/crm", label: "CRM", icon: Mail },
  { href: "/admin/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/admin/roles", label: "Roles", icon: Shield },
  { href: "/admin/waitlist", label: "Waitlist", icon: ListChecks },
  { href: "/admin/logs", label: "Audit Logs", icon: ScrollText },
  { href: "/admin/docs", label: "Dev Wiki", icon: BookOpen },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 flex flex-col">
      <div className="p-4 border-b border-zinc-200 dark:border-zinc-800">
        <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Admin</h1>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname.startsWith(item.href);

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent text-primary "
                  : "text-zinc-600 hover:text-zinc-900 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:text-zinc-100 dark:hover:bg-zinc-800"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-zinc-200 dark:border-zinc-800">
        <Link
          href="/app"
          className="flex items-center gap-2 px-3 py-2 rounded-md text-sm text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to App
        </Link>
      </div>
    </aside>
  );
}
