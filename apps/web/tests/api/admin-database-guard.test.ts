import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
// Importing the db helper bootstraps the Better Auth schema. Importing getDb()
// (below, lazily) runs all SQL migrations, which create the protected `user`
// columns (isAdmin/role/banned/...) and the RBAC tables (roles/user_roles).
import { createTestUser, cleanupTestUser, makeSession } from "../helpers/db";
import { getRawDb } from "@/lib/db";
import { PATCH } from "@/app/api/admin/database/[table]/route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a PATCH NextRequest hitting the admin database editor for `table`.
 * The route reads { id, column, value } from the JSON body.
 */
function makePatchRequest(
  table: string,
  body: { id: unknown; column: string; value: unknown }
): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/admin/database/${table}`,
    {
      method: "PATCH",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    }
  );
}

/** Wrap the [table] dynamic-route param the way Next.js passes it. */
function params(table: string): { params: Promise<{ table: string }> } {
  return { params: Promise.resolve({ table }) };
}

/**
 * Grant the test user the `admin:database` permission via a real RBAC role —
 * NOT via isAdmin=1. This is the precise escalation scenario under test: a
 * caller who legitimately holds `admin:database` (and therefore passes the
 * route's requirePermission gate) but is NOT a superadmin, attempting to use
 * the generic editor to flip privilege/billing/identity/ban fields.
 *
 * Returns the role id so it can be cleaned up.
 */
function grantDatabasePermission(userId: string): string {
  const db = getRawDb();
  const roleId = `role_dbonly_${Math.random().toString(36).slice(2)}`;
  // A custom role carrying ONLY admin:database — no wildcard, no admin:users.
  db.prepare(
    `INSERT INTO roles (id, name, description, permissions, is_system)
     VALUES (?, ?, 'db editor only', ?, 0)`
  ).run(roleId, roleId, JSON.stringify(["admin:database"]));
  db.prepare(
    `INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)`
  ).run(userId, roleId);
  return roleId;
}

function revokeDatabasePermission(userId: string, roleId: string): void {
  const db = getRawDb();
  db.prepare(`DELETE FROM user_roles WHERE user_id = ? AND role_id = ?`).run(
    userId,
    roleId
  );
  db.prepare(`DELETE FROM roles WHERE id = ?`).run(roleId);
}

/** Read a single column value off the user row directly. */
function readUserColumn(userId: string, column: string): unknown {
  const row = getRawDb()
    .prepare(`SELECT "${column}" AS v FROM user WHERE id = ?`)
    .get(userId) as { v: unknown } | undefined;
  return row?.v;
}

/** Insert a minimal `posts` row (a benign, non-protected, user-owned table). */
function createTestPost(userId: string, caption: string): number {
  const db = getRawDb();
  const info = db
    .prepare(
      `INSERT INTO posts (user_id, platform_post_id, platform, caption)
       VALUES (?, ?, 'instagram', ?)`
    )
    .run(userId, `post_${Math.random().toString(36).slice(2)}`, caption);
  return Number(info.lastInsertRowid);
}

// The exact set of protected user columns the security fix must reject.
// isAdmin/stripeCustomerId/stripeSubscriptionId/subscriptionStatus/plan/
// emailVerified exist on Coomander's `user` table today. role/banned/
// banReason/banExpires are added by the admin-plugin migration (#222 item G)
// but the guard blocks the column NAME regardless of whether the column has
// landed yet — the check runs before the route validates the column exists.
const PROTECTED_USER_COLUMNS = [
  "isAdmin",
  "role",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "subscriptionStatus",
  "plan",
  "emailVerified",
  "banned",
  "banReason",
  "banExpires",
] as const;

// ---------------------------------------------------------------------------
// PATCH /api/admin/database/[table] — privilege-escalation guard
// ---------------------------------------------------------------------------

describe("PATCH /api/admin/database/[table] — protected-column guard", () => {
  let userId: string;
  let email: string;
  let roleId: string;

  beforeEach(() => {
    const u = createTestUser();
    userId = u.userId;
    email = u.email;
    // Caller holds admin:database via RBAC but is NOT a superadmin (isAdmin=0).
    roleId = grantDatabasePermission(userId);
    // Every test in this block acts as that authenticated, permitted caller.
    vi.spyOn(auth.api, "getSession").mockResolvedValue(
      makeSession(userId, email) as never
    );
  });

  afterEach(() => {
    // A successful PATCH calls logAdminAction(), which writes rows into
    // admin_logs (admin_id → user). That FK reference must be cleared before
    // cleanupTestUser() deletes the user row, or the DELETE fails with
    // "FOREIGN KEY constraint failed".
    const db = getRawDb();
    db.prepare(`DELETE FROM admin_logs WHERE admin_id = ?`).run(userId);
    db.prepare(`DELETE FROM posts WHERE user_id = ?`).run(userId);
    revokeDatabasePermission(userId, roleId);
    cleanupTestUser(userId, email);
    vi.restoreAllMocks();
  });

  // — Point 1: setting user.isAdmin is rejected with 403 and does not write —

  it("returns 403 when setting user.isAdmin and does NOT perform the update", async () => {
    const before = readUserColumn(userId, "isAdmin");
    expect(before).toBe(0); // sanity: not already a superadmin

    const req = makePatchRequest("user", {
      id: userId,
      column: "isAdmin",
      value: 1,
    });
    const res = await PATCH(req, params("user"));

    expect(res.status).toBe(403);
    const json = await res.json();
    // ForbiddenError → errorResponse → { error, code: "FORBIDDEN" }
    expect(json.code).toBe("FORBIDDEN");

    // The escalation must NOT have happened.
    expect(readUserColumn(userId, "isAdmin")).toBe(0);
  });

  // — Point 2: every protected user column is rejected with 403 —

  it.each(PROTECTED_USER_COLUMNS)(
    "returns 403 when writing protected user column %s",
    async (column) => {
      const req = makePatchRequest("user", {
        id: userId,
        column,
        value: column === "isAdmin" || column === "banned" ? 1 : "evil",
      });
      const res = await PATCH(req, params("user"));

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("FORBIDDEN");
    }
  );

  // — Point 3: a benign user column is NOT blocked by this guard —

  it("does NOT block a benign user column (name) with the protected-column 403", async () => {
    const req = makePatchRequest("user", {
      id: userId,
      column: "name",
      value: "Renamed User",
    });
    const res = await PATCH(req, params("user"));

    // The guard must let `name` through. The route then performs the update.
    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data?.success).toBe(true);
    // And the benign write actually took effect.
    expect(readUserColumn(userId, "name")).toBe("Renamed User");
  });

  // — Point 4: protected column NAMES on a DIFFERENT table are not blocked —

  it("does NOT block protected column names on a non-protected table (posts.caption)", async () => {
    // `posts` is not in PROTECTED_COLUMNS_BY_TABLE. Seed a real row so the
    // update succeeds, proving the guard let the request through.
    const postId = createTestPost(userId, "Original");

    const req = makePatchRequest("posts", {
      id: postId,
      column: "caption", // benign on posts; not a protected mapping for this table
      value: "Updated",
    });
    const res = await PATCH(req, params("posts"));

    expect(res.status).not.toBe(403);
    expect(res.status).toBe(200);
  });

  it("does NOT block the literal name 'plan' when written to a non-user table", async () => {
    // `plan` is protected ONLY on `user`. On a table that has no protected-column
    // mapping, a column named `plan` (if present) must not trigger the 403 guard.
    // We assert via the posts table: posts has no `plan` column, so the route
    // proceeds past the protected-column guard and fails later with the
    // route's own 400 "Invalid column name" — which is NOT the protected 403.
    const postId = createTestPost(userId, "Plan Test");

    const req = makePatchRequest("posts", {
      id: postId,
      column: "plan",
      value: "pro",
    });
    const res = await PATCH(req, params("posts"));

    expect(res.status).not.toBe(403);
    // Route's own invalid-column-name check (proves the guard was bypassed).
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/Invalid column name/i);
  });

  // — Point 5: pre-existing protections still hold —

  it.each(["session", "twoFactor", "verification"])(
    "still rejects writes to the restricted table %s with 400 (Invalid table name)",
    async (table) => {
      const req = makePatchRequest(table, {
        id: "anything",
        column: "id",
        value: "x",
      });
      const res = await PATCH(req, params(table));

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toMatch(/Invalid table name/i);
    }
  );

  it("still rejects writes to a redacted column (password) with 403", async () => {
    // `account` is a valid, non-restricted table that has a `password` column.
    const req = makePatchRequest("account", {
      id: "some-account-id",
      column: "password",
      value: "newhash",
    });
    const res = await PATCH(req, params("account"));

    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error).toMatch(/sensitive column/i);
  });

  // — Point 6: RBAC/billing-override/audit tables are read-only (Coomander addition) —

  it.each(["roles", "user_roles", "plan_overrides", "admin_logs"])(
    "rejects writes to write-protected table %s with 403",
    async (table) => {
      const req = makePatchRequest(table, {
        id: "anything",
        column: "name",
        value: "x",
      });
      const res = await PATCH(req, params(table));

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe("FORBIDDEN");
    }
  );
});
