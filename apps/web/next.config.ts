import path from "path";
import type { NextConfig } from "next";
import { createMDX } from "fumadocs-mdx/next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "pg"],
  // Monorepo: transpile the workspace-local @coomander/core (ships raw TS).
  transpilePackages: ["@coomander/core"],
  // Monorepo: trace from the repo root so hoisted workspace deps are found.
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // Force-include pg-cloudflare's workerd-conditional files in the standalone
  // server output. Next's File Tracer follows the `node` exports condition,
  // which maps pg-cloudflare to the empty stub (`dist/empty.js`). OpenNext's
  // Workers bundler then resolves with the `workerd` condition and looks for
  // `dist/index.js` / `esm/index.mjs`, which Tracer didn't copy. Including
  // them explicitly here keeps the OpenNext build resolvable. Has no effect
  // on Vercel/Node deploys — the empty stub is still chosen at runtime.
  outputFileTracingIncludes: {
    "*": [
      "../../node_modules/pg-cloudflare/**",
      "../../node_modules/pg/node_modules/pg-cloudflare/**",
    ],
  },
  // Allow Next dev (HMR websocket, dev endpoints) to be reached from hosts
  // other than the literal string "localhost". Without this, loading the
  // page from a tailnet URL or even `127.0.0.1` causes Next dev to reject
  // the HMR websocket handshake (ERR_INVALID_HTTP_RESPONSE), which blocks
  // React from hydrating. Dev-only — ignored in prod builds.
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
    "mark-nutters-macbook-pro-2.gate-cardassian.ts.net",
    "coomander.gate-cardassian.ts.net",
    "*.gate-cardassian.ts.net",
  ],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "media-src 'self' data: blob:",
              "connect-src 'self' https://api.stripe.com https://*.posthog.com https://*.plausible.io https://*.sentry.io https://*.ingest.sentry.io",
              "frame-src 'self' https://js.stripe.com https://hooks.stripe.com",
              "object-src 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
        ],
      },
    ];
  },
};

// Wrap with fumadocs MDX plugin (inner), then optionally Sentry (outer)
const withMDX = createMDX();
const configWithMDX = withMDX(nextConfig);

// Only wrap with Sentry if DSN is configured (dynamic import avoids crash when @sentry/nextjs isn't installed)
let finalConfig: NextConfig = configWithMDX;

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  try {
    const { withSentryConfig } = require("@sentry/nextjs");
    finalConfig = withSentryConfig(configWithMDX, {
      silent: !process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        disable: !process.env.SENTRY_AUTH_TOKEN,
      },
    });
  } catch {
    // @sentry/nextjs not installed — skip Sentry wrapping
  }
}

export default finalConfig;
