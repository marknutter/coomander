import type { Metadata } from "next";
import { ThemeProvider } from "@/lib/theme";
import { ToastContainer } from "@/components/ui/toast";
import { CommandPaletteProvider } from "@/components/ui/command-palette";
import { CookieConsent } from "@/components/cookie-consent";
import "./globals.css";

const siteUrl = process.env.BETTER_AUTH_URL || "https://coomander.example.com";

export const metadata: Metadata = {
  title: {
    default: "Coomander — Coomander",
    template: "%s | Coomander",
  },
  description: "Coomander.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    type: "website",
    locale: "en_US",
    url: siteUrl,
    siteName: "Coomander",
    title: "Coomander — Coomander",
    description: "Coomander.",
  },
  twitter: {
    card: "summary_large_image",
    title: "Coomander — Coomander",
    description: "Coomander.",
  },
  robots: {
    index: true,
    follow: true,
  },
  alternates: {
    canonical: siteUrl,
    types: {
      "application/rss+xml": `${siteUrl}/feed.xml`,
    },
  },
};

/**
 * Inline script to prevent flash of wrong theme on load.
 * Reads from localStorage before React hydrates.
 */
const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('coomander-theme');
    var theme = stored || 'system';
    var resolved = theme;
    if (theme === 'system') {
      resolved = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    document.documentElement.classList.add(resolved);
  } catch(e) {}
})()
`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="scroll-smooth" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider>
          <CommandPaletteProvider>
            {children}
          </CommandPaletteProvider>
          <ToastContainer />
          <CookieConsent />
        </ThemeProvider>
      </body>
    </html>
  );
}
