import { describe, it, expect } from "vitest";
import { executeChanges } from "@/lib/db-helpers";

// ─── executeChanges() dialect-shape normalization ────────────────────────────
//
// executeChanges(builder) awaits a Drizzle insert/update/delete builder and
// returns the affected-row count. The three dialects this app runs on each
// report that count in a different place:
//
//   better-sqlite3 (dev/Docker) : result.changes
//   Cloudflare D1  (prod/Workers): result.meta.changes  (a raw D1Result)
//   node-postgres               : result.rowCount
//
// The D1 case is the regression this test guards: Drizzle's D1 driver returns
// the raw D1Result whose count lives under `meta`, not at the top level. Before
// this fix executeChanges only checked top-level `.changes`/`.rowCount`, so on
// D1 it fell through to 0 for EVERY update/delete — silently breaking every
// compare-and-swap that gates on the affected-row count.
//
// executeChanges accepts a PromiseLike, so we hand it resolved promises whose
// values mimic each driver's real result shape.

describe("executeChanges — affected-row count across dialect result shapes", () => {
  it("reads better-sqlite3 result.changes", async () => {
    const result = { changes: 1, lastInsertRowid: 42 };
    expect(await executeChanges(Promise.resolve(result))).toBe(1);
  });

  it("reads Cloudflare D1 result.meta.changes (the D1 regression)", async () => {
    // Shape of a real D1Result returned by Drizzle's D1 driver for an
    // UPDATE/DELETE with no .returning().
    const d1Result = {
      success: true,
      results: [],
      meta: {
        duration: 0.4,
        changes: 1,
        last_row_id: 0,
        changed_db: true,
        rows_read: 1,
        rows_written: 1,
      },
    };
    expect(await executeChanges(Promise.resolve(d1Result))).toBe(1);
  });

  it("returns 0 when a D1 UPDATE matched no rows (meta.changes = 0)", async () => {
    const d1Result = { success: true, results: [], meta: { changes: 0 } };
    expect(await executeChanges(Promise.resolve(d1Result))).toBe(0);
  });

  it("reads a D1 multi-row change count", async () => {
    const d1Result = { success: true, results: [], meta: { changes: 5 } };
    expect(await executeChanges(Promise.resolve(d1Result))).toBe(5);
  });

  it("reads node-postgres result.rowCount", async () => {
    const pgResult = { command: "UPDATE", rowCount: 3, rows: [] };
    expect(await executeChanges(Promise.resolve(pgResult))).toBe(3);
  });

  it("falls back to array length for .returning() results", async () => {
    expect(await executeChanges(Promise.resolve([{ id: "a" }, { id: "b" }]))).toBe(2);
  });

  it("returns 0 for an empty .returning() array", async () => {
    expect(await executeChanges(Promise.resolve([]))).toBe(0);
  });

  it("returns 0 for an unrecognized / null result", async () => {
    expect(await executeChanges(Promise.resolve(null))).toBe(0);
    expect(await executeChanges(Promise.resolve(undefined))).toBe(0);
    expect(await executeChanges(Promise.resolve({ nonsense: true }))).toBe(0);
  });

  it("prefers top-level changes over meta when both are present (sqlite never has meta, but be deterministic)", async () => {
    const result = { changes: 2, meta: { changes: 99 } };
    expect(await executeChanges(Promise.resolve(result))).toBe(2);
  });
});
