import { type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface CardProps {
  /** Optional header icon */
  icon?: ReactNode;
  /** Optional header title */
  title?: string;
  /** Optional header right-side content */
  headerAction?: ReactNode;
  /** Card body content */
  children: ReactNode;
  /** Optional footer content */
  footer?: ReactNode;
  /** Additional CSS classes */
  className?: string;
  /** Padding size preset */
  padding?: "sm" | "md" | "lg";
}

const paddingClasses = {
  sm: "p-4",
  md: "p-5",
  lg: "p-6",
};

/**
 * Consistent card container with optional header (icon + title), body, and footer.
 *
 * @example
 * ```tsx
 * <Card icon={<User className="w-4 h-4 text-primary" />} title="Account">
 *   <p>Card content here</p>
 * </Card>
 * ```
 */
export function Card({
  icon,
  title,
  headerAction,
  children,
  footer,
  className,
  padding = "md",
}: CardProps) {
  return (
    <div
      className={cn(
        "bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700",
        paddingClasses[padding],
        className
      )}
    >
      {/* Header */}
      {(title || headerAction) && (
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {icon}
            {title && <h2 className="font-semibold text-gray-900 dark:text-gray-100">{title}</h2>}
          </div>
          {headerAction}
        </div>
      )}

      {/* Body */}
      {children}

      {/* Footer */}
      {footer && (
        <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">{footer}</div>
      )}
    </div>
  );
}
