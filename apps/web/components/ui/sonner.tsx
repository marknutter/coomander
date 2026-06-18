"use client";

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

import { useTheme } from "@/lib/theme";

/**
 * Sonner-backed toast container. Place once in the root layout.
 *
 * Themed via the existing `useTheme()` hook so it follows light/dark mode
 * and uses our semantic tokens for colors.
 */
export function Toaster({ ...props }: ToasterProps) {
  const { resolvedTheme } = useTheme();

  return (
    <SonnerToaster
      theme={resolvedTheme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-card group-[.toaster]:text-card-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
