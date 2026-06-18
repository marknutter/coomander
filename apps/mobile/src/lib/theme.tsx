import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  type ReactNode,
} from "react";
import { useColorScheme } from "react-native";
import * as SecureStore from "expo-secure-store";

import { palettes, type ThemeColors } from "./colors";

/**
 * Native theme provider — the mobile mirror of `apps/web/lib/theme.tsx`.
 *
 * Same three-state preference model (`light | dark | system`). On native we
 * resolve `system` against the OS appearance via React Native's
 * `useColorScheme()` (driven by `userInterfaceStyle: "automatic"` in app.json),
 * persist the user's choice in encrypted secure-store, and expose the resolved
 * token palette so screens can style without a className system.
 */
export type Theme = "light" | "dark" | "system";

interface ThemeContextValue {
  /** Current theme preference (light | dark | system) */
  theme: Theme;
  /** Resolved theme (light | dark) after applying system preference */
  resolvedTheme: "light" | "dark";
  /** Update and persist the theme preference */
  setTheme: (theme: Theme) => void;
  /** Resolved color tokens for the active theme */
  colors: ThemeColors;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "coomander-theme";

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [theme, setThemeState] = useState<Theme>("system");

  // Hydrate the persisted preference on mount.
  useEffect(() => {
    let active = true;
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((stored) => {
        if (active && isTheme(stored)) setThemeState(stored);
      })
      .catch(() => {
        // No stored preference yet — keep the "system" default.
      });
    return () => {
      active = false;
    };
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    // Fire-and-forget persistence; UI updates immediately from state.
    SecureStore.setItemAsync(STORAGE_KEY, next).catch(() => {});
  }, []);

  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (systemScheme === "dark" ? "dark" : "light") : theme;

  return (
    <ThemeContext.Provider
      value={{ theme, resolvedTheme, setTheme, colors: palettes[resolvedTheme] }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

/**
 * Access and control the current theme.
 *
 * @example
 * const { resolvedTheme, colors, setTheme } = useTheme();
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
