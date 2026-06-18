import { cn } from "@/lib/cn";

export type AvatarSize = "sm" | "md" | "lg";

export interface AvatarProps {
  /** User name (used for fallback initials) */
  name?: string;
  /** User email (used as fallback for initials if name not provided) */
  email?: string;
  /** Image URL */
  src?: string;
  /** Size preset */
  size?: AvatarSize;
  /** Additional CSS classes */
  className?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: "w-7 h-7 text-xs",
  md: "w-9 h-9 text-sm",
  lg: "w-12 h-12 text-base",
};

/**
 * Gets initials from a name or email.
 */
function getInitials(name?: string, email?: string): string {
  if (name) {
    const parts = name.split(" ").filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0]?.[0]?.toUpperCase() ?? "?";
  }
  if (email) {
    return email[0]?.toUpperCase() ?? "?";
  }
  return "?";
}

/**
 * User avatar with image support and fallback initials.
 *
 * @example
 * ```tsx
 * <Avatar name="John Doe" />
 * <Avatar email="john@example.com" size="lg" />
 * ```
 */
export function Avatar({ name, email, src, size = "md", className }: AvatarProps) {
  const initials = getInitials(name, email);

  if (src) {
    return (
      <img
        src={src}
        alt={name || email || "User avatar"}
        className={cn(
          "rounded-full object-cover",
          sizeClasses[size],
          className
        )}
      />
    );
  }

  return (
    <div
      className={cn(
        "rounded-full flex items-center justify-center font-medium",
        "bg-accent text-primary dark:bg-primary/50 ",
        sizeClasses[size],
        className
      )}
      aria-label={name || email || "User avatar"}
    >
      {initials}
    </div>
  );
}
