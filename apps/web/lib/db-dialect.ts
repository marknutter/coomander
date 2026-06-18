/**
 * Database dialect detection.
 *
 * Selection order:
 *   1. DATABASE_DRIVER=d1   → Cloudflare D1 (request-scoped binding)
 *   2. DATABASE_URL=postgres://…  → PostgreSQL
 *   3. otherwise            → local better-sqlite3
 *
 * D1 is SQLite-shaped at the schema layer but exposed via a Workers binding,
 * not a connection string — so it lives behind its own opt-in env var
 * rather than the URL.
 */

export type Dialect = "sqlite" | "pg" | "d1";

let _dialect: Dialect | null = null;

export function getDialect(): Dialect {
  if (_dialect) return _dialect;
  if (process.env.DATABASE_DRIVER === "d1") {
    _dialect = "d1";
    return _dialect;
  }
  const url = process.env.DATABASE_URL;
  _dialect = url && url.startsWith("postgres") ? "pg" : "sqlite";
  return _dialect;
}

export function isPg(): boolean {
  return getDialect() === "pg";
}

export function isD1(): boolean {
  return getDialect() === "d1";
}

/** Test seam — clears the cached dialect so getDialect() re-evaluates env. */
export function _resetDialectCache(): void {
  _dialect = null;
}
