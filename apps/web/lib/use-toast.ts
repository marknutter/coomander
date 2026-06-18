"use client";

import { toast as sonnerToast } from "sonner";

export type ToastType = "success" | "error" | "info" | "warning";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Optional action button */
  action?: ToastAction;
  /** Duration in ms before auto-dismiss (0 = no auto-dismiss) */
  duration?: number;
}

/**
 * Programmatic toast API — backed by Sonner. Can be called from anywhere
 * in the app, including non-React modules.
 *
 * @example
 * ```ts
 * import { toast } from "@/lib/use-toast";
 * toast.success("Changes saved!");
 * toast.error("Something went wrong");
 * toast.info("Processing...", { duration: 0 }); // persistent
 * toast.warning("Low storage", { action: { label: "Upgrade", onClick: handleUpgrade } });
 * ```
 */
function makeOptions(opts?: ToastOptions) {
  const out: Parameters<typeof sonnerToast>[1] = {};
  if (opts?.duration !== undefined) out.duration = opts.duration === 0 ? Infinity : opts.duration;
  if (opts?.action) {
    out.action = {
      label: opts.action.label,
      onClick: opts.action.onClick,
    };
  }
  return out;
}

export const toast = {
  success: (msg: string, opts?: ToastOptions) =>
    String(sonnerToast.success(msg, makeOptions(opts))),
  error: (msg: string, opts?: ToastOptions) =>
    String(sonnerToast.error(msg, makeOptions(opts))),
  info: (msg: string, opts?: ToastOptions) =>
    String(sonnerToast.info(msg, makeOptions(opts))),
  warning: (msg: string, opts?: ToastOptions) =>
    String(sonnerToast.warning(msg, makeOptions(opts))),
  dismiss: (id?: string) => sonnerToast.dismiss(id),
};

/**
 * Legacy hook — kept for backward compatibility with consumers that
 * imported `useToast()` to get the toast list. Sonner manages its own
 * state internally, so this returns an empty list and a no-op dismiss
 * for the small number of callers that destructured `{ toasts, dismiss }`.
 *
 * The right way to render toasts is to mount `<Toaster />` from
 * `@/components/ui/sonner` once in the root layout.
 */
export function useToast() {
  return {
    toasts: [] as Array<{ id: string; type: ToastType; message: string }>,
    dismiss: toast.dismiss,
  };
}
