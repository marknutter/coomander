/**
 * Test database helpers.
 *
 * When this module is imported it uses the app's singleton getRawDb() to create
 * Better Auth tables via CREATE TABLE IF NOT EXISTS.  Using the singleton
 * (rather than a separate new Database() connection) avoids file-lock
 * conflicts between parallel vitest worker processes.
 *
 * Better Auth creates these tables lazily on first production use; tests need
 * them available immediately so they can seed rows directly via SQL.
 */

import { eq } from "drizzle-orm";
import { getRawDb, getDb } from "@/lib/db";
import { user, verification, twoFactor, session as sessionTable, account } from "@/lib/schema";

// ── Bootstrap Better Auth schema ─────────────────────────────────────────────
// Runs once at import time.  getRawDb() is a per-process singleton, so this is
// safe and idempotent across multiple imports within the same worker.
getRawDb().exec(`
  CREATE TABLE IF NOT EXISTS "user" (
    "id" text not null primary key,
    "name" text not null,
    "email" text not null unique,
    "emailVerified" integer not null,
    "image" text,
    "createdAt" date not null,
    "updatedAt" date not null,
    "twoFactorEnabled" integer,
    "plan" text,
    "stripeCustomerId" text,
    "stripeSubscriptionId" text,
    "subscriptionStatus" text
  );

  CREATE TABLE IF NOT EXISTS "session" (
    "id" text not null primary key,
    "expiresAt" date not null,
    "token" text not null unique,
    "createdAt" date not null,
    "updatedAt" date not null,
    "ipAddress" text,
    "userAgent" text,
    "userId" text not null references "user" ("id") on delete cascade
  );

  CREATE TABLE IF NOT EXISTS "account" (
    "id" text not null primary key,
    "accountId" text not null,
    "providerId" text not null,
    "userId" text not null references "user" ("id") on delete cascade,
    "accessToken" text,
    "refreshToken" text,
    "idToken" text,
    "accessTokenExpiresAt" date,
    "refreshTokenExpiresAt" date,
    "scope" text,
    "password" text,
    "createdAt" date not null,
    "updatedAt" date not null
  );

  CREATE TABLE IF NOT EXISTS "verification" (
    "id" text not null primary key,
    "identifier" text not null,
    "value" text not null,
    "expiresAt" date not null,
    "createdAt" date not null,
    "updatedAt" date not null
  );

  CREATE TABLE IF NOT EXISTS "twoFactor" (
    "id" text not null primary key,
    "secret" text not null,
    "backupCodes" text not null,
    "userId" text not null references "user" ("id") on delete cascade
  );

  CREATE INDEX IF NOT EXISTS "session_userId_idx" on "session" ("userId");
  CREATE INDEX IF NOT EXISTS "account_userId_idx" on "account" ("userId");
  CREATE INDEX IF NOT EXISTS "verification_identifier_idx" on "verification" ("identifier");
  CREATE INDEX IF NOT EXISTS "twoFactor_userId_idx" on "twoFactor" ("userId");
`);

export interface TestUser {
  userId: string;
  email: string;
  name: string;
}

/**
 * Insert a test user directly into the Better Auth `user` table.
 * Returns the inserted user's id, email, and name.
 */
export function createTestUser(opts: Partial<TestUser> = {}): TestUser {
  const userId =
    opts.userId ?? `test-${Math.random().toString(36).slice(2)}`;
  const email =
    opts.email ?? `test-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const name = opts.name ?? email.split("@")[0];
  const now = new Date().toISOString();

  // Use raw DB for INSERT OR REPLACE (Drizzle onConflictDoUpdate is verbose for tests)
  getRawDb()
    .prepare(
      `INSERT OR REPLACE INTO user
         (id, email, emailVerified, name, image, createdAt, updatedAt, plan, subscriptionStatus)
       VALUES (?, ?, 1, ?, NULL, ?, ?, 'free', 'inactive')`
    )
    .run(userId, email, name, now, now);

  return { userId, email, name };
}

/**
 * Delete a test user and all their associated data.
 * Safe to call even if the user doesn't exist.
 */
export function cleanupTestUser(userId: string, email?: string): void {
  const db = getDb();
  if (email) {
    db.delete(verification).where(eq(verification.identifier, email)).run();
  }
  db.delete(twoFactor).where(eq(twoFactor.userId, userId)).run();
  db.delete(sessionTable).where(eq(sessionTable.userId, userId)).run();
  db.delete(account).where(eq(account.userId, userId)).run();
  db.delete(user).where(eq(user.id, userId)).run();
}

/**
 * Build a minimal mock session object that satisfies the shape expected by
 * auth.api.getSession callers.
 */
export function makeSession(userId: string, email: string) {
  return {
    user: {
      id: userId,
      email,
      name: email.split("@")[0],
      emailVerified: true,
      image: null as string | null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    session: {
      id: `session-${Math.random().toString(36).slice(2)}`,
      userId,
      expiresAt: new Date(Date.now() + 86_400_000),
      token: `tok-${Math.random().toString(36).slice(2)}`,
      ipAddress: null as string | null,
      userAgent: null as string | null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}
