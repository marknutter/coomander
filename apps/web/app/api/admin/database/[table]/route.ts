import { NextRequest, NextResponse } from "next/server";
import { logAdminAction } from "@/lib/admin";
import { requirePermission } from "@/lib/rbac";
import { PERMISSIONS } from "@/lib/permissions";
import { getRawAdapter } from "@/lib/db-raw";

// Tables hidden from database browser (contain sensitive auth data)
const RESTRICTED_TABLES = new Set(["session", "twoFactor", "verification"]);

// Columns redacted from results (shown as "***")
const REDACTED_COLUMNS = new Set([
  "password", "secret", "backupCodes", "token", "value",
  "accessToken", "refreshToken", "idToken",
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
