"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

export interface AuditLog {
  id: number;
  admin_id: string;
  admin_email: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
  created_at: string;
}

interface AuditLogTableProps {
  logs: AuditLog[];
  isLoading?: boolean;
}

function getActionBadgeVariant(action: string): BadgeVariant {
  const lower = action.toLowerCase();
  if (lower.includes("delete") || lower.includes("ban") || lower.includes("revoke")) return "danger";
  if (lower.includes("create") || lower.includes("grant") || lower.includes("approve")) return "success";
  if (lower.includes("update") || lower.includes("edit") || lower.includes("change")) return "info";
  if (lower.includes("warn") || lower.includes("suspend")) return "warning";
  return "default";
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ExpandableRow({ log }: { log: AuditLog }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className={cn(
          "border-b border-gray-100 dark:border-gray-700 cursor-pointer transition-colors",
          "hover:bg-gray-50 dark:hover:bg-gray-700/50",
          expanded && "bg-gray-50 dark:bg-gray-700/30"
        )}
        onClick={() => setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 whitespace-nowrap">
          <div className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" />
            ) : (
              <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
            )}
            {formatDate(log.created_at)}
          </div>
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
          {log.admin_email}
        </td>
        <td className="px-4 py-3">
          <Badge variant={getActionBadgeVariant(log.action)}>
            {log.action}
          </Badge>
        </td>
        <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
          {log.target_type && (
            <span>
              <span className="font-medium">{log.target_type}</span>
              {log.target_id && (
                <span className="ml-1 text-gray-400 dark:text-gray-500">#{log.target_id}</span>
              )}
            </span>
          )}
          {!log.target_type && <span className="text-gray-400 dark:text-gray-500">—</span>}
        </td>
        <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400 max-w-xs truncate">
          {log.details ? JSON.stringify(log.details).slice(0, 80) : "—"}
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/20">
          <td colSpan={5} className="px-8 py-4">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2">
              Full Details
            </div>
            {log.details ? (
              <pre className="text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
                {JSON.stringify(log.details, null, 2)}
              </pre>
            ) : (
              <p className="text-sm text-gray-400 dark:text-gray-500 italic">No details recorded.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function AuditLogTable({ logs, isLoading }: AuditLogTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <TableHeader />
        </thead>
        <tbody>
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <tr key={i} className="border-b border-gray-100 dark:border-gray-700">
                {Array.from({ length: 5 }).map((__, j) => (
                  <td key={j} className="px-4 py-3">
                    <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
                  </td>
                ))}
              </tr>
            ))
          ) : logs.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-4 py-12 text-center">
                <p className="text-gray-500 dark:text-gray-400">No audit logs found.</p>
              </td>
            </tr>
          ) : (
            logs.map((log) => <ExpandableRow key={log.id} log={log} />)
          )}
        </tbody>
      </table>
    </div>
  );
}

function TableHeader() {
  return (
    <tr className="border-b border-gray-200 dark:border-gray-700">
      {["Date", "Admin", "Action", "Target", "Details"].map((label) => (
        <th
          key={label}
          className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider"
        >
          {label}
        </th>
      ))}
    </tr>
  );
}
