import { cn } from "@/lib/cn";

export interface SkeletonProps {
  /** Width class (e.g. "w-32", "w-full") */
  width?: string;
  /** Height class (e.g. "h-4", "h-10") */
  height?: string;
  /** Whether to render as a circle */
  circle?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Shimmer skeleton placeholder for loading states.
 *
 * @example
 * ```tsx
 * <Skeleton width="w-full" height="h-4" />
 * <Skeleton circle width="w-10" height="h-10" />
 * ```
 */
export function Skeleton({ width = "w-full", height = "h-4", circle = false, className }: SkeletonProps) {
  return (
    <div
      className={cn(
        "animate-pulse bg-gray-200 dark:bg-gray-700",
        circle ? "rounded-full" : "rounded-lg",
        width,
        height,
        className
      )}
      aria-hidden="true"
    />
  );
}

/** Skeleton matching a text line */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="h-4"
          width={i === lines - 1 ? "w-2/3" : "w-full"}
        />
      ))}
    </div>
  );
}

/** Skeleton matching a card layout */
export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div className={cn("bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-5", className)}>
      <div className="flex items-center gap-2 mb-4">
        <Skeleton circle width="w-5" height="h-5" />
        <Skeleton width="w-32" height="h-5" />
      </div>
      <SkeletonText lines={3} />
    </div>
  );
}

/** Skeleton matching a table row */
export function SkeletonTableRow({ columns = 4, className }: { columns?: number; className?: string }) {
  return (
    <div className={cn("flex items-center gap-4 py-3", className)}>
      {Array.from({ length: columns }).map((_, i) => (
        <Skeleton
          key={i}
          height="h-4"
          width={i === 0 ? "w-1/4" : "w-1/6"}
        />
      ))}
    </div>
  );
}

/** Skeleton matching a form field */
export function SkeletonFormField({ className }: { className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <Skeleton width="w-20" height="h-4" />
      <Skeleton width="w-full" height="h-10" />
    </div>
  );
}
