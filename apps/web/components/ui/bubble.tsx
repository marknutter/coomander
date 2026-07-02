/**
 * Bubble — message surface for chat transcripts.
 *
 * Adapted from shadcn's June 2026 chat components (Radix variant). Restyled
 * with Coomander's Tailwind + semantic tokens (the upstream `cn-*` variant
 * classes are not part of the published package). Variant colours match the
 * existing chat look: `primary` for the user, `default` (card) for the
 * assistant, `outline` for the live voice transcript.
 */

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/cn";

function BubbleGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="bubble-group"
      className={cn("flex min-w-0 flex-col gap-1.5", className)}
      {...props}
    />
  );
}

const bubbleVariants = cva(
  "relative flex w-fit min-w-0 max-w-[85%] flex-col rounded-2xl px-4 py-2.5 text-sm",
  {
    variants: {
      variant: {
        default:
          "border border-gray-200 bg-white text-gray-900 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100",
        primary: "bg-primary text-white",
        muted:
          "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
        outline:
          "border-2 border-dashed border-primary text-accent-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Bubble({
  variant = "default",
  align = "start",
  className,
  ...props
}: React.ComponentProps<"div"> &
  VariantProps<typeof bubbleVariants> & {
    align?: "start" | "end";
  }) {
  return (
    <div
      data-slot="bubble"
      data-variant={variant}
      data-align={align}
      className={cn(bubbleVariants({ variant }), className)}
      {...props}
    />
  );
}

function BubbleContent({
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot : "div";

  return (
    <Comp
      data-slot="bubble-content"
      className={cn(
        "w-fit max-w-full min-w-0 overflow-hidden break-words",
        className
      )}
      {...props}
    />
  );
}

export { BubbleGroup, Bubble, BubbleContent };
