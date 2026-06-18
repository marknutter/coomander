import { betterAuth } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { sendWelcomeEmail, sendVerificationEmail, sendPasswordResetEmail } from "./email";
import { trackSignup } from "./marketing";
import { isPg, isD1 } from "./db-dialect";
import { bootstrapAuthSchema, bootstrapAuthSchemaPg } from "./auth-schema";
import { getDb } from "./db";
import { user as userTable } from "./schema";
import * as authDrizzleSchema from "./schema.auth";

const appName = process.env.APP_NAME || "Coomander";

// ─── Lazy auth initialization ──────────────────────────────────────────────
//
// Why lazy: on Cloudflare Workers (D1 path), the D1 binding is request-scoped
// and doesn't exist at module load. Eagerly building the betterAuth() instance
// at top level — which the previous version of this file did — would crash
// the Worker bundle before any request runs.
//
// Pattern: a Proxy that defers betterAuth() construction until the first
// property access. The OpenNext adapter (Step 7 of #275) calls
// setD1Binding(env.DB) at request entry, well before any code touches `auth`.
// On the SQLite/PG paths the lazy init still happens, just on first access
// instead of at import time — a one-time cost in exchange for D1 viability.

type AuthInstance = ReturnType<typeof betterAuth>;

let _authCache: AuthInstance | null = null;

function buildAuthDatabase(): Parameters<typeof betterAuth>[0]["database"] {
  // D1: use Better Auth's Drizzle adapter against the D1-backed Drizzle
  // instance. Schema and migrations are pre-applied via `wrangler d1
  // migrations apply` at deploy time (Step 5 of #275); no runtime bootstrap.
  if (isD1()) {
    // Pass the auth-specific schema (with mode:boolean / mode:timestamp on
    // the auth columns) so Better Auth's drizzleAdapter converts JS
    // booleans → 0/1 and Date objects → unix epoch seconds at the
    // boundary. The bare schema.sqlite.ts uses plain integer() columns,
    // which Drizzle would pass through unconverted and D1 would reject.
    return drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: authDrizzleSchema,
    });
  }

  // PostgreSQL: Better Auth supports pg Pool natively
  if (isPg()) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Pool } = require("pg");
    const pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
    // Bootstrap schema (idempotent) — fire-and-forget; the catch lets
    // startup proceed if the tables already exist.
    bootstrapAuthSchemaPg(pgPool).catch((e: Error) =>
      console.warn("[auth] PG schema bootstrap failed (may already exist):", e.message)
    );
    return pgPool;
  }

  // SQLite: better-sqlite3, lazily required so the static-import chain on
  // Workers doesn't pull in the native binding (matches the lib/db.ts
  // pattern from #290).
  const dbPath = process.env.DATABASE_PATH || "./data/coomander.db";
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const DatabaseCtor = require("better-sqlite3");
  const sqliteDb: InstanceType<typeof Database> = new DatabaseCtor(dbPath);
  // WAL mode doesn't work reliably through Docker bind mounts on macOS.
  // Use DELETE journal mode in dev, WAL in prod (which uses a Docker volume).
  sqliteDb.pragma(process.env.NODE_ENV === "production" ? "journal_mode = WAL" : "journal_mode = DELETE");
  sqliteDb.pragma("busy_timeout = 5000");
  // Initialize Better Auth schema on first run (idempotent). Belt-and-braces —
  // migration 000_better_auth_init.sql also creates these tables (#284), but
  // this covers fresh installs that haven't run migrations yet.
  bootstrapAuthSchema(sqliteDb);
  return sqliteDb;
}

function buildAuth(): AuthInstance {
  return betterAuth({
    database: buildAuthDatabase(),
    secret: process.env.BETTER_AUTH_SECRET,
    baseURL: process.env.BETTER_AUTH_URL,
    trustedOrigins: (() => {
      const origins: string[] = [];
      if (process.env.BETTER_AUTH_URL) origins.push(process.env.BETTER_AUTH_URL);
      // Mobile app (apps/mobile, Expo) origins. The mobile auth client has no
      // expo() server plugin counterpart; it injects `Origin: EXPO_PUBLIC_API_URL`
      // on every request to satisfy Better Auth's CSRF origin check, so the
      // tailnet (dev) and prod API URLs it can point at must be trusted here.
      // The `coomander://` scheme is the app's deep-link scheme used for OAuth
      // callbacks. Trusted in all environments (mobile hits both dev and prod).
      origins.push(
        "coomander://",
        "https://coomander.gate-cardassian.ts.net",
        "https://coomander.com",
      );
      // In development, trust common localhost variants (0.0.0.0, 127.0.0.1)
      // so Docker and direct access both work. Also trust any Tailscale
      // tailnet hostname (*.ts.net) on any port so you can hit the dev
      // server from your phone or other tailnet devices for QA.
      if (process.env.NODE_ENV !== "production") {
        // Wildcard pattern for any tailnet hostname on any scheme/port.
        origins.push("http://*.ts.net", "https://*.ts.net", "http://*.ts.net:*", "https://*.ts.net:*");
        // Always trust localhost variants in dev so both Tailscale and
        // direct localhost access work without switching BETTER_AUTH_URL.
        const devPort = process.env.DEV_PORT || "3005";
        for (const host of ["localhost", "127.0.0.1", "0.0.0.0"]) {
          for (const scheme of ["http", "https"]) {
            const variant = `${scheme}://${host}:${devPort}`;
            if (!origins.includes(variant)) origins.push(variant);
          }
        }
      }
      return origins;
    })(),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        void sendPasswordResetEmail(user.email, url);
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        void sendVerificationEmail(user.email, url);
      },
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || "",
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
      },
      github: {
        clientId: process.env.GITHUB_CLIENT_ID || "",
        clientSecret: process.env.GITHUB_CLIENT_SECRET || "",
      },
      apple: {
        clientId: process.env.APPLE_CLIENT_ID || "",
        clientSecret: process.env.APPLE_CLIENT_SECRET || "",
      },
      facebook: {
        clientId: process.env.FACEBOOK_CLIENT_ID || "",
        clientSecret: process.env.FACEBOOK_CLIENT_SECRET || "",
      },
      microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID || "",
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
        tenantId: process.env.MICROSOFT_TENANT_ID || "common",
      },
    },
    account: {
      accountLinking: {
        enabled: true,
        trustedProviders: ["google", "github", "apple", "facebook", "microsoft"],
      },
    },
    user: {
      additionalFields: {
        plan: {
          type: "string",
          required: false,
          defaultValue: "free",
          input: false,
        },
        stripeCustomerId: {
          type: "string",
          required: false,
          input: false,
        },
        stripeSubscriptionId: {
          type: "string",
          required: false,
          input: false,
        },
        subscriptionStatus: {
          type: "string",
          required: false,
          defaultValue: "inactive",
          input: false,
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: appName,
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            try { void sendWelcomeEmail(user.email); } catch (e) { console.warn("[email] Welcome email skipped:", (e as Error).message); }
            trackSignup({ email: user.email, userId: user.id, createdAt: new Date().toISOString() });
            // Promote to admin if ADMIN_EMAILS contains this user's email.
            // The one-shot bootstrap in lib/db.ts only processes users that
            // exist at init time, so users signing up afterward need this hook.
            //
            // Drizzle update — works on sqlite, pg, and d1. Replaces the
            // previous raw better-sqlite3 prepared statement, which threw on
            // D1 because the sync prepare API isn't available there.
            const adminEmails = process.env.ADMIN_EMAILS;
            if (adminEmails) {
              const allowed = adminEmails
                .split(",")
                .map((e) => e.trim().toLowerCase())
                .filter(Boolean);
              if (allowed.includes(user.email.toLowerCase())) {
                try {
                  await getDb().update(userTable).set({ isAdmin: 1 }).where(eq(userTable.id, user.id));
                } catch (e) {
                  console.warn("[auth] Failed to promote admin user:", (e as Error).message);
                }
              }
            }
          },
        },
      },
    },
  });
}

function getAuth(): AuthInstance {
  if (_authCache) return _authCache;
  _authCache = buildAuth();
  return _authCache;
}

/**
 * The Better Auth instance.
 *
 * Constructed lazily on first property access so the D1 binding (set per
 * request by the Workers adapter) is available by the time the underlying
 * betterAuth() runs. On SQLite / PG this proxy is functionally identical
 * to a top-level `export const auth = betterAuth(...)` — it just defers
 * init from import time to first access.
 *
 * The `has` trap is required because `better-auth/next-js`'s `toNextJsHandler`
 * does `"handler" in auth ? auth.handler(request) : auth(request)`. Without a
 * `has` trap, the `in` check falls back to the empty Proxy target and returns
 * false, causing the integration to attempt to call the Proxy as a function
 * (the underlying object isn't callable, so this throws). Delegating `has`
 * to the real auth instance lets `"handler" in auth` resolve correctly.
 */
export const auth = new Proxy({} as AuthInstance, {
  get(_, prop, receiver) {
    return Reflect.get(getAuth(), prop, receiver);
  },
  has(_, prop) {
    return Reflect.has(getAuth(), prop);
  },
}) as AuthInstance;

/**
 * Test seam — clears the cached auth instance so the next access rebuilds.
 * Useful when tests swap dialects via _resetDialectCache + setD1Binding.
 */
export function _resetAuthCache(): void {
  _authCache = null;
}
