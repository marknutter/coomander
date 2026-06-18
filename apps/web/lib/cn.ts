/**
 * Re-export of `cn()` from `lib/utils.ts` for backward compatibility with
 * existing `@/lib/cn` imports throughout the codebase. New code should
 * import from `@/lib/utils` directly (the shadcn convention).
 *
 * The implementation now uses `clsx` + `tailwind-merge` so conflicting
 * Tailwind utilities resolve correctly (e.g. `cn("px-2", "px-4")` → `"px-4"`).
 */
export { cn } from "./utils";
