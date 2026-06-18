"use client";

import { type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

// ——— MetricCard ———

export interface MetricCardProps {
  label: string;
  value: string | number;
  /** Optional subtitle or secondary value */
  sub?: string;
  /** Positive = up, negative = down, zero / undefined = neutral */
  change?: number;
  className?: string;
}

export function MetricCard({ label, value, sub, change, className }: MetricCardProps) {
  const ChangeIcon =
    change == null || change === 0
      ? Minus
      : change > 0
      ? TrendingUp
      : TrendingDown;

  const changeColor =
    change == null || change === 0
      ? "text-zinc-400"
      : change > 0
      ? "text-primary"
      : "text-red-600 dark:text-red-400";

  return (
    <div
      className={cn(
        "bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-5 flex flex-col gap-1",
        className
      )}
    >
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
        {label}
      </p>
      <p className="text-3xl font-bold text-zinc-900 dark:text-zinc-100">{value}</p>
      {(sub !== undefined || change !== undefined) && (
        <div className="flex items-center gap-1 mt-0.5">
          {change !== undefined && (
            <ChangeIcon className={cn("h-3.5 w-3.5", changeColor)} />
          )}
          {sub && (
            <p className={cn("text-xs", change !== undefined ? changeColor : "text-zinc-500 dark:text-zinc-400")}>
              {sub}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ——— DataTable ———

export interface DataTableColumn {
  key: string;
  label: string;
  align?: "left" | "center" | "right";
  render?: (value: unknown, row: Record<string, unknown>) => ReactNode;
}

export interface DataTableProps {
  columns: DataTableColumn[];
  rows: Record<string, unknown>[];
  emptyMessage?: string;
  className?: string;
}

export function DataTable({ columns, rows, emptyMessage = "No data", className }: DataTableProps) {
  return (
    <div className={cn("overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800", className)}>
      <table className="w-full text-sm">
        <thead className="bg-zinc-50 dark:bg-zinc-800/50">
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={cn(
                  "px-4 py-3 text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider",
                  col.align === "center" && "text-center",
                  col.align === "right" && "text-right",
                  !col.align && "text-left"
                )}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white dark:bg-zinc-900 divide-y divide-zinc-100 dark:divide-zinc-800">
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-8 text-center text-zinc-500 dark:text-zinc-400"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row, i) => (
              <tr key={i} className="hover:bg-zinc-50 dark:hover:bg-zinc-800/50 transition-colors">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-3 text-zinc-900 dark:text-zinc-200",
                      col.align === "center" && "text-center",
                      col.align === "right" && "text-right"
                    )}
                  >
                    {col.render
                      ? col.render(row[col.key], row)
                      : String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

// ——— PercentageBar ———

export interface PercentageBarProps {
  value: number; // 0–1
  label?: string;
  colorClass?: string;
  showPercent?: boolean;
  className?: string;
}

export function PercentageBar({
  value,
  label,
  colorClass = "bg-primary",
  showPercent = true,
  className,
}: PercentageBarProps) {
  const pct = Math.round(Math.min(Math.max(value, 0), 1) * 100);

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {label && (
        <span className="text-sm text-zinc-700 dark:text-zinc-300 min-w-[8rem] truncate">{label}</span>
      )}
      <div className="flex-1 bg-zinc-100 dark:bg-zinc-800 rounded-full h-2 overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all", colorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      {showPercent && (
        <span className="text-xs text-zinc-500 dark:text-zinc-400 w-10 text-right">{pct}%</span>
      )}
    </div>
  );
}
