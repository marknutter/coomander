/**
 * Theme tokens for the Coomander mobile app — a neutral dark/light palette
 * that mirrors the web app's shadcn-style design tokens. React Native's color
 * parser accepts both hex and rgba() strings directly.
 *
 * Only the tokens the mobile shell actually consumes are mirrored here; add
 * more as later phases need them. The `ThemeColors` interface shape must stay
 * stable so the auth and account screens keep type-checking.
 */
export interface ThemeColors {
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  primary: string;
  primaryForeground: string;
  secondary: string;
  secondaryForeground: string;
  muted: string;
  mutedForeground: string;
  accent: string;
  accentForeground: string;
  destructive: string;
  destructiveForeground: string;
  border: string;
  input: string;
  ring: string;
}

// Light: clean neutral surface.
const light: ThemeColors = {
  background: "#ffffff",
  foreground: "#0a0a0a",
  card: "#ffffff",
  cardForeground: "#0a0a0a",
  primary: "#171717",
  primaryForeground: "#fafafa",
  secondary: "#f5f5f5",
  secondaryForeground: "#171717",
  muted: "#f5f5f5",
  mutedForeground: "#737373",
  accent: "#f5f5f5",
  accentForeground: "#171717",
  destructive: "#ef4444",
  destructiveForeground: "#fafafa",
  border: "rgba(10,10,10,0.10)",
  input: "rgba(10,10,10,0.10)",
  ring: "#171717",
};

// Dark: neutral charcoal surface.
const dark: ThemeColors = {
  background: "#0a0a0a",
  foreground: "#fafafa",
  card: "#171717",
  cardForeground: "#fafafa",
  primary: "#fafafa",
  primaryForeground: "#171717",
  secondary: "#262626",
  secondaryForeground: "#fafafa",
  muted: "#262626",
  mutedForeground: "#a1a1aa",
  accent: "#262626",
  accentForeground: "#fafafa",
  destructive: "#ef4444",
  destructiveForeground: "#fafafa",
  border: "rgba(250,250,250,0.12)",
  input: "rgba(250,250,250,0.12)",
  ring: "#fafafa",
};

export const palettes: Record<"light" | "dark", ThemeColors> = { light, dark };
