import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Combine class names with `clsx` and resolve Tailwind conflicts via `tailwind-merge`.
 * Standard shadcn/ui helper. Use this whenever composing className strings,
 * especially across multiple sources (props, conditional logic, defaults).
 *
 * @example
 * cn("px-4 py-2", isActive && "bg-primary", className)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
