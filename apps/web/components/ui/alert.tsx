import { type ReactNode } from "react";
import { AlertCircle, CheckCircle2, AlertTriangle, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";

/** Alert variants */
export type AlertVariant = "info" | "success" | "warning" | "error";

export interface AlertProps {
  /** Visual variant */
  variant?: AlertVariant;
  /** Alert title (optional) */
  title?: string;
  /** Alert content */
  children: ReactNode;
  /** Called when the dismiss button is clicked. If not provided, no X button is shown. */
  onDismiss?: () => void;
  /** Additional CSS classes */
  className?: string;
}

const variantConfig: Record<
  AlertVariant,
  { bg: string; border: string; text: string; titleText: string; icon: ReactNode; dismissColor: string }
> = {
  info: {
    bg: "bg-blue-50 dark:bg-blue-900/20",
    border: "border-blue-200 dark:border-blue-800",
    text: "text-blue-700 dark:text-blue-300",
    titleText: "text-blue-800 dark:text-blue-200",
    icon: <Info className="w-5 h-5 text-blue-500 dark:text-blue-400 flex-shrink-0 mt-0.5" />,
    dismissColor: "text-blue-400 hover:text-blue-600 dark:hover:text-blue-300",
  },
  success: {
    bg: "bg-accent",
    border: "border-accent",
    text: "text-accent-foreground",
    titleText: "text-accent-foreground",
    icon: <CheckCircle2 className="w-5 h-5 text-primary flex-shrink-0 mt-0.5" />,
    dismissColor: "text-primary hover:text-primary/80",
  },
  warning: {
    bg: "bg-amber-50 dark:bg-amber-900/20",
    border: "border-amber-200 dark:border-amber-800",
    text: "text-amber-700 dark:text-amber-300",
    titleText: "text-amber-800 dark:text-amber-200",
    icon: <AlertTriangle className="w-5 h-5 text-amber-500 dark:text-amber-400 flex-shrink-0 mt-0.5" />,
    dismissColor: "text-amber-400 hover:text-amber-600 dark:hover:text-amber-300",
  },
  error: {
    bg: "bg-red-50 dark:bg-red-900/20",
    border: "border-red-200 dark:border-red-800",
    text: "text-red-600 dark:text-red-300",
    titleText: "text-red-700 dark:text-red-200",
    icon: <AlertCircle className="w-5 h-5 text-red-500 dark:text-red-400 flex-shrink-0 mt-0.5" />,
    dismissColor: "text-red-400 hover:text-red-600 dark:hover:text-red-300",
  },
};

/**
 * Inline alert banner for displaying messages to the user.
 *
 * @example
 * ```tsx
 * <Alert variant="error" onDismiss={() => setError(null)}>Something went wrong</Alert>
 * <Alert variant="success" title="Done!">Your changes have been saved.</Alert>
 * ```
 */
export function Alert({ variant = "info", title, children, onDismiss, className }: AlertProps) {
  const config = variantConfig[variant];

  return (
    <div
      className={cn(
        "rounded-xl p-4 border flex gap-3 items-start",
        config.bg,
        config.border,
        className
      )}
      role="alert"
      aria-live="polite"
    >
      {config.icon}
      <div className="flex-1 min-w-0">
        {title && <p className={cn("font-medium text-sm", config.titleText)}>{title}</p>}
        <div className={cn("text-sm", config.text)}>{children}</div>
      </div>
      {onDismiss && (
        <button
          onClick={onDismiss}
          className={cn("flex-shrink-0", config.dismissColor)}
          aria-label="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}
