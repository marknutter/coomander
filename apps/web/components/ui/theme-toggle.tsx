"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/cn";

interface ThemeToggleProps {
  /** Compact mode shows only the current icon (for header) */
  compact?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * Theme toggle component.
 * In compact mode: cycles through light -> dark -> system on click (icon button).
 * In full mode: shows all three options as segmented control (for settings).
 */
export function ThemeToggle({ compact = false, className }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();

  if (compact) {
    const nextTheme: Record<Theme, Theme> = {
      light: "dark",
      dark: "system",
      system: "light",
    };

    return (
      <button
        onClick={() => setTheme(nextTheme[theme])}
        className={cn(
          "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors",
          className
        )}
        title={`Theme: ${theme} (${resolvedTheme})`}
        aria-label={`Switch theme (currently ${theme})`}
      >
        {theme === "system" ? (
          <Monitor className="w-4 h-4" />
        ) : resolvedTheme === "dark" ? (
          <Moon className="w-4 h-4" />
        ) : (
          <Sun className="w-4 h-4" />
        )}
      </button>
    );
  }

  // Full mode: segmented control
  const options: { key: Theme; label: string; icon: React.ReactNode }[] = [
    { key: "light", label: "Light", icon: <Sun className="w-4 h-4" /> },
    { key: "dark", label: "Dark", icon: <Moon className="w-4 h-4" /> },
    { key: "system", label: "System", icon: <Monitor className="w-4 h-4" /> },
  ];

  return (
    <div className={cn("flex rounded-xl bg-gray-100 dark:bg-gray-700 p-1", className)}>
      {options.map((opt) => (
        <button
          key={opt.key}
          onClick={() => setTheme(opt.key)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-lg transition-all",
            theme === opt.key
              ? "bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 shadow-sm"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          )}
          aria-pressed={theme === opt.key}
        >
          {opt.icon}
          {opt.label}
        </button>
      ))}
    </div>
  );
}
