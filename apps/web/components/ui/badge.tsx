import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Badge/Pill color variants */
export type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "pro";

export interface BadgeProps {
  /** Visual variant */
  variant?: BadgeVariant;
  /** Optional icon before text */
  icon?: ReactNode;
  /** Badge content */
  children: ReactNode;
  /** Additional CSS classes */
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300",
  success: "bg-accent text-primary dark:bg-primary/50 ",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-400",
  danger: "bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-400",
  info: "bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-400",
  pro: "bg-accent text-primary dark:bg-primary/50 ",
};

/**
 * Status indicator badge/pill.
 *
 * @example
 * ```tsx
 * <Badge variant="pro" icon={<Star className="w-3 h-3" />}>Pro</Badge>
 * <Badge variant="default">Free</Badge>
 * ```
 */
export function Badge({ variant = "default", icon, children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded-full",
        variantClasses[variant],
        className
      )}
    >
      {icon}
      {children}
    </span>
  );
}
