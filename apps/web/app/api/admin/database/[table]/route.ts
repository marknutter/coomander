import { NextRequest, NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";
import { ForbiddenError, errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Tables hidden from database browser (contain sensitive auth data)
const RESTRICTED_TABLES = new Set(["session", "twoFactor", "verification"]);

// Columns redacted from results (shown as "***")
const REDACTED_COLUMNS = new Set([
  "password", "secret", "backupCodes", "token", "value",
  "accessToken", "refreshToken", "idToken",
]);

// Write-protected columns per table. The generic database editor must never be
// able to write privilege/billing/identity/ban fields — doing so is a vertical
// privilege escalation (e.g. an admin with only `admin:database` flipping their
// own `isAdmin` to 1 to bypass all RBAC). These fields are mutated exclusively
// through the dedicated `/api/admin/users/[id]/*` routes, which apply the
// correct authorization and side effects. Reads are unaffected — only writes
// (PATCH) are blocked for these (table, column) pairs.
const PROTECTED_COLUMNS_BY_TABLE: Record<string, Set<string>> = {
  user: new Set([
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
  ]),
};

// Tables that are read-only in the generic editor (PATCH and DELETE → 403).
// Writing them here is equivalent to the user.isAdmin escalation the column
// denylist blocks: `roles.permissions` grants your own role every permission,
// `user_roles.role_id` re-points an assignment, `plan_overrides` defeats the
// billing-column protection, and deleting from `admin_logs` tampers with the
// audit trail. All four have dedicated, audited admin routes.
const WRITE_PROTECTED_TABLES = new Set([
  "roles",
  "user_roles",
  "plan_overrides",
  "admin_logs",
]);

function redactRows(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const redacted: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      redacted[k] = REDACTED_COLUMNS.has(k) && v ? "***" : v;
    }
    return redacted;
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { error } = await requirePermission(request, PERMISSIONS.ADMIN_DATABASE);
  if (error) return error;

  const { table } = await params;
  const adapter = getRawAdapter();

  // Validate table name — block sensitive auth tables
  const validTables = await adapter.getTableNames();
  if (!validTables.has(table) || RESTRICTED_TABLES.has(table)) {
    return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10)));
  const sortParam = searchParams.get("sort");
  const order = searchParams.get("order") === "desc" ? "DESC" : "ASC";
  const filterParam = searchParams.get("filter");

  const columnInfo = await adapter.getTableColumns(table);
  const validColumns = new Set(columnInfo.map((c) => c.name));

  // Validate sort column
  let sortClause = "";
  if (sortParam && validColumns.has(sortParam)) {
    sortClause = `ORDER BY "${sortParam}" ${order}`;
  }

  // Build WHERE clause from filter (JSON-encoded column→value map)
  let whereClause = "";
  const bindValues: unknown[] = [];
  if (filterParam) {
    try {
      const filters = JSON.parse(filterParam) as Record<string, string>;
      const conditions: string[] = [];
      for (const [col, val] of Object.entries(filters)) {
        if (validColumns.has(col) && val !== "") {
          conditions.push(`"${col}" LIKE ?`);
          bindValues.push(`%${val}%`);
        }
      }
      if (conditions.length > 0) {
        whereClause = `WHERE ${conditions.join(" AND ")}`;
      }
    } catch {
      // Ignore malformed filter
    }
  }

  const countRow = await adapter.queryFirst<{ total: number }>(
    `SELECT COUNT(*) as total FROM "${table}" ${whereClause}`,
    ...bindValues
  );

  const rows = await adapter.queryAll(
    `SELECT * FROM "${table}" ${whereClause} ${sortClause} LIMIT ? OFFSET ?`,
    ...bindValues, limit, page * limit
  );

  return NextResponse.json({
    data: {
      rows: redactRows(rows as Record<string, unknown>[]),
      total: countRow?.total ?? 0,
      page,
      limit,
      columns: columnInfo,
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_DATABASE);
  if (error) return error;

  const { table } = await params;
  const adapter = getRawAdapter();

  // Validate table name — block writes to sensitive tables
  const validTables = await adapter.getTableNames();
  if (!validTables.has(table) || RESTRICTED_TABLES.has(table)) {
    return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
  }

  const body = (await request.json()) as { id: unknown; column: string; value: unknown };
  const { id, column, value } = body;

  if (id === undefined || id === null) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }
  if (!column) {
    return NextResponse.json({ error: "Missing column" }, { status: 400 });
  }

  // Block writes to sensitive columns
  if (REDACTED_COLUMNS.has(column)) {
    return NextResponse.json({ error: "Cannot modify sensitive column" }, { status: 403 });
  }

  // Read-only tables: RBAC/billing-override/audit tables must not be writable
  // through the generic editor (vertical privilege escalation / audit tampering).
  if (WRITE_PROTECTED_TABLES.has(table)) {
    return errorResponse(
      new ForbiddenError(
        `Table "${table}" is read-only in the database editor. ` +
          `Use the dedicated admin routes to modify it.`
      )
    );
  }

  // Block writes to privilege/billing/identity/ban columns. Allowing these
  // through the generic editor enables vertical privilege escalation (e.g.
  // setting your own user.isAdmin=1). They must be changed via the dedicated
  // /api/admin/users/[id]/* routes, which enforce the correct authorization.
  if (PROTECTED_COLUMNS_BY_TABLE[table]?.has(column)) {
    return errorResponse(
      new ForbiddenError(
        `Cannot modify protected column "${column}" on table "${table}" via the database editor. ` +
          `Use the dedicated /api/admin/users/[id]/* routes for this field.`
      )
    );
  }

  const columnInfo = await adapter.getTableColumns(table);
  if (!columnInfo.some((c) => c.name === column)) {
    return NextResponse.json({ error: "Invalid column name" }, { status: 400 });
  }

  const pkCol = columnInfo.find((c) => c.pk);
  if (!pkCol) {
    return NextResponse.json({ error: "Table has no primary key" }, { status: 400 });
  }

  const result = await adapter.run(
    `UPDATE "${table}" SET "${column}" = ? WHERE "${pkCol.name}" = ?`,
    value, id
  );

  if (result.changes === 0) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }

  await logAdminAction(session!.user.id, "db_edit", table, String(id), {
    column,
    value,
  });

  return NextResponse.json({ data: { success: true } });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ table: string }> }
) {
  const { session, error } = await requirePermission(request, PERMISSIONS.ADMIN_DATABASE);
  if (error) return error;

  const { table } = await params;
  const adapter = getRawAdapter();

  // Validate table name — block deletes from sensitive tables
  const validTables = await adapter.getTableNames();
  if (!validTables.has(table) || RESTRICTED_TABLES.has(table)) {
    return NextResponse.json({ error: "Invalid table name" }, { status: 400 });
  }

  // Read-only tables: deleting from RBAC/billing-override/audit tables via the
  // generic editor is blocked (e.g. admin_logs DELETE = audit-trail tampering).
  if (WRITE_PROTECTED_TABLES.has(table)) {
    return errorResponse(
      new ForbiddenError(
        `Table "${table}" is read-only in the database editor. ` +
          `Use the dedicated admin routes to modify it.`
      )
    );
  }

  const body = (await request.json()) as { id: unknown; confirm?: string };
  const { id, confirm } = body;

  if (confirm !== "DELETE") {
    return NextResponse.json({ error: "Confirmation required" }, { status: 400 });
  }

  if (id === undefined || id === null) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const columnInfo = await adapter.getTableColumns(table);
  const pkCol = columnInfo.find((c) => c.pk);
  if (!pkCol) {
    return NextResponse.json({ error: "Table has no primary key" }, { status: 400 });
  }

  const result = await adapter.run(
    `DELETE FROM "${table}" WHERE "${pkCol.name}" = ?`,
    id
  );

  if (result.changes === 0) {
    return NextResponse.json({ error: "Row not found" }, { status: 404 });
  }

  await logAdminAction(session!.user.id, "db_delete", table, String(id), {});

  return NextResponse.json({ data: { success: true } });
}
