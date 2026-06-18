/**
 * Thin async helpers that normalize Drizzle query results across dialects.
 *
 * Drizzle query builders are thenable — `await builder` returns rows.
 * These helpers provide semantic wrappers for common patterns.
 */

/**
 * Execute a select-style query and return the first row, or undefined.
 * Replaces `.get()` calls.
 */
export async function queryFirst<T>(builder: PromiseLike<T[]>): Promise<T | undefined> {
  const rows = await builder;
  return rows[0];
}

/**
 * Execute an insert/update/delete and return the number of affected rows.
 * Normalizes SQLite's `result.changes` vs PG's `result.rowCount`.
 *
 * For Drizzle, both dialects return an array-like result from awaiting
 * insert/update/delete builders. We inspect the underlying result.
 */
export async function executeChanges(builder: PromiseLike<unknown>): Promise<number> {
  const result = await builder as Record<string, unknown>;

  // SQLite (better-sqlite3 via Drizzle): result has .changes
  if (typeof result === "object" && result !== null && "changes" in result) {
    return result.changes as number;
  }

  // PG (node-postgres via Drizzle): result has .rowCount
  if (typeof result === "object" && result !== null && "rowCount" in result) {
    return result.rowCount as number;
  }

  // Drizzle returns an array for some operations
  if (Array.isArray(result)) {
    return result.length;
  }

  return 0;
}
