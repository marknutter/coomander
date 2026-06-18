"use client";

import { Toaster } from "./sonner";

/**
 * Global toast container. Renders all toasts via Sonner.
 * Place once in your root layout.
 *
 * Re-exports Sonner's Toaster wrapped with our theme integration.
 * Kept named `ToastContainer` for backward compatibility with the
 * pre-shadcn API; new code can import `<Toaster>` from
 * `@/components/ui/sonner` directly.
 *
 * @example
 * ```tsx
 * // In layout.tsx:
 * <ToastContainer />
 * ```
 */
export function ToastContainer() {
  return <Toaster />;
}
