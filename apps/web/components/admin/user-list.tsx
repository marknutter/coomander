"use client";

import Link from "next/link";
import { Badge } from "@/components/ui";

export interface UserRow {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  effectivePlan: string;
  hasOverride: boolean;
  created_at: string;
  is_admin: boolean;
  subscription_status: string;
  provider: string;
  disabled: boolean;
}

interface UserListProps {
  users: UserRow[];
}

function planVariant(plan: string): "pro" | "default" {
  return plan === "pro" ? "pro" : "default";
}

function statusVariant(
  status: string,
  disabled: boolean
): "danger" | "success" | "warning" | "default" {
  if (disabled) return "danger";
  if (status === "active") return "success";
  if (status === "trialing") return "warning";
  return "default";
}

export function UserList({ users }: UserListProps) {
  if (users.length === 0) {
    return (
      <div className="text-center py-12 text-zinc-500 dark:text-zinc-400">No users found.</div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 dark:border-gray-700">
            {["Email", "Plan", "Status", "Provider", "Joined"].map((h) => (
              <th
                key={h}
                className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr
              key={user.id}
              className="border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            >
              <td className="px-4 py-3">
                <Link
                  href={`/admin/users/${user.id}`}
                  className="font-medium text-zinc-900 dark:text-zinc-100 hover:text-primary/80 transition-colors"
                >
                  {user.email}
                  {user.is_admin && (
                    <Badge variant="info" className="ml-2">Admin</Badge>
                  )}
                </Link>
                {user.name && (
                  <p className="text-xs text-zinc-400 mt-0.5">{user.name}</p>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="flex items-center gap-1.5">
                  <Badge variant={planVariant(user.effectivePlan)}>{user.effectivePlan}</Badge>
                  {user.hasOverride && (
                    <Badge variant="warning" className="text-[10px]">override</Badge>
                  )}
                </span>
              </td>
              <td className="px-4 py-3">
                <Badge variant={statusVariant(user.subscription_status, user.disabled)}>
                  {user.disabled ? "disabled" : user.subscription_status}
                </Badge>
              </td>
              <td className="px-4 py-3 text-xs text-zinc-500">{user.provider}</td>
              <td className="px-4 py-3 text-xs text-zinc-500">
                {new Date(user.created_at).toLocaleDateString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
