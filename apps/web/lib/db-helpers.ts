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
 * Normalizes SQLite's `result.changes`, Cloudflare D1's `result.meta.changes`,
 * and PG's `result.rowCount`.
 *
 * For Drizzle, all three dialects return an array-like/result-shaped object
 * from awaiting insert/update/delete builders. We inspect the underlying
 * result. Every compare-and-set / CAS gate in the app (campaign send,
 * scheduled dispatch, subscriber update, admin plan change, etc.) depends on
 * this returning an accurate count — a missing dialect branch here silently
 * misfires the gate on that dialect (see #605-family D1 parity bugs).
 */
export async function executeChanges(builder: PromiseLike<unknown>): Promise<number> {
  const result = await builder as Record<string, unknown>;

  if (typeof result !== "object" || result === null) {
    return 0;
  }

  // better-sqlite3 via Drizzle: result.changes
  if ("changes" in result && typeof result.changes === "number") {
    return result.changes;
  }

  // Cloudflare D1 via Drizzle: the raw D1Result carries the count at meta.changes
  if ("meta" in result) {
    const meta = result.meta as { changes?: unknown } | null | undefined;
    if (meta && typeof meta === "object" && typeof meta.changes === "number") {
      return meta.changes;
    }
  }

  // PG (node-postgres via Drizzle): result.rowCount
  if ("rowCount" in result && typeof result.rowCount === "number") {
    return result.rowCount;
  }

  // Drizzle returns an array for .returning() operations
  if (Array.isArray(result)) {
    return result.length;
  }

  return 0;
}
