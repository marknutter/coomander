/**
 * Marker — status updates, system notes, and labelled separators.
 *
 * Adapted from shadcn's June 2026 chat components (Radix variant), restyled
 * with Coomander's Tailwind + semantic tokens. Used for connecting/reconnecting
 * status, streaming state, and date breaks in the transcript.
 *
 * - `variant="default"`  — inline status row (icon + content)
 * - `variant="separator"` — centred label flanked by hairlines (date breaks)
 * - `variant="border"`    — bordered pill row (notices)
 *
 * Pair `MarkerContent` with the `shimmer` utility (see globals.css) for an
 * animated "working…" treatment, e.g. `<MarkerContent className="shimmer">`.
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/cn";

const markerVariants = cva(
  "group/marker relative flex w-full items-center gap-2 text-xs text-muted-foreground",
  {
    variants: {
      variant: {
        default: "justify-center",
        separator:
          "justify-center gap-3 before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border",
        border:
          "justify-center rounded-lg border border-border bg-muted/40 px-3 py-1.5",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Marker({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof markerVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="marker"
      data-variant={variant}
      className={cn(markerVariants({ variant }), className)}
      {...props}
    />
  );
}

function MarkerIcon({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-icon"
      aria-hidden="true"
      className={cn("flex shrink-0 items-center", className)}
      {...props}
    />
  );
}

function MarkerContent({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="marker-content"
      className={cn("min-w-0 break-words", className)}
      {...props}
    />
  );
}

export { Marker, MarkerIcon, MarkerContent, markerVariants };
