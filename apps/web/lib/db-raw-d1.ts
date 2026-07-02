/**
 * Cloudflare D1 implementation of the RawDbAdapter interface.
 *
 * The SQLite adapter (db-raw-sqlite.ts) uses better-sqlite3's synchronous API,
 * which does not exist on Workers/D1 (getRawDb() throws under D1). This adapter
 * uses the request-scoped D1 binding's async prepared-statement API instead, so
 * the admin raw-SQL features (users list, generic table browser, search) work in
 * production on D1 — not just on the dev SQLite / Postgres paths.
 */

import type { RawDbAdapter, ColumnMeta, SearchResult } from "./db-raw";
import { resolveD1Binding } from "./db";

// Minimal shape of the Cloudflare D1 runtime API we rely on. Typed locally so
// non-Workers builds don't need @cloudflare/workers-types.
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run(): Promise<{ meta?: { changes?: number; last_row_id?: number } }>;
}
interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatement;
}

function d1(): D1DatabaseLike {
  const binding = resolveD1Binding();
  if (!binding) {
    throw new Error(
      "D1 binding not available for the raw adapter — getCloudflareContext().env.DB was empty.",
    );
  }
  return binding as unknown as D1DatabaseLike;
}

/** Only allow simple identifiers when a table name must be interpolated
 * (D1 can't bind identifiers). Callers also validate against getTableNames(). */
function safeIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Unsafe identifier: ${name}`);
  }
  return name;
}

function stmt(sql: string, params: unknown[]): D1PreparedStatement {
  const p = d1().prepare(sql);
  return params.length ? p.bind(...params) : p;
}

export function createD1RawAdapter(): RawDbAdapter {
  const adapter: RawDbAdapter = {
    async healthCheck(): Promise<boolean> {
      try {
        await d1().prepare("SELECT 1 AS ok").first();
        return true;
      } catch {
        return false;
      }
    },

    async tableExists(name: string): Promise<boolean> {
      const row = await d1()
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .bind(name)
        .first();
      return !!row;
    },

    async listTables(): Promise<{ name: string; rowCount: number }[]> {
      const { results } = await d1()
        .prepare(
          // Exclude sqlite_* AND D1's internal _cf_* tables (e.g. _cf_KV,
          // _cf_METADATA) — counting those raises D1_ERROR: not authorized
          // (SQLITE_AUTH).
          "SELECT name FROM sqlite_master WHERE type='table' " +
            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
        )
        .all<{ name: string }>();

      const out: { name: string; rowCount: number }[] = [];
      for (const t of results) {
        let rowCount = 0;
        try {
          const count = await d1()
            .prepare(`SELECT COUNT(*) AS count FROM "${safeIdent(t.name)}"`)
            .first<number>("count");
          rowCount = Number(count ?? 0);
        } catch {
          // A table we can't count (restricted / odd name) shouldn't 500 the
          // whole browser — surface it with an unknown count instead.
          rowCount = -1;
        }
        out.push({ name: t.name, rowCount });
      }
      return out;
    },

    async getTableColumns(table: string): Promise<ColumnMeta[]> {
      const { results } = await d1()
        .prepare(`PRAGMA table_info("${safeIdent(table)}")`)
        .all<{
          name: string;
          type: string;
          notnull: number;
          dflt_value: string | null;
          pk: number;
        }>();

      return results.map((r) => ({
        name: r.name,
        type: r.type,
        notnull: r.notnull === 1,
        defaultValue: r.dflt_value,
        pk: r.pk === 1,
      }));
    },

    async getTableNames(): Promise<Set<string>> {
      const { results } = await d1()
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' " +
            "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
        )
        .all<{ name: string }>();
      return new Set(results.map((r) => r.name));
    },

    async queryAll<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      const { results } = await stmt(sql, params).all<T>();
      return results;
    },

    async queryFirst<T = Record<string, unknown>>(
      sql: string,
      ...params: unknown[]
    ): Promise<T | undefined> {
      const row = await stmt(sql, params).first<T>();
      return row ?? undefined;
    },

    async run(
      sql: string,
      ...params: unknown[]
    ): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
      const res = await stmt(sql, params).run();
      return { changes: res.meta?.changes ?? 0, lastInsertRowid: res.meta?.last_row_id };
    },

    async searchItems(userId: string, query: string, limit: number): Promise<SearchResult[]> {
      // FTS5 availability is not guaranteed on D1, so use the LIKE path (the same
      // fallback the SQLite adapter uses when FTS errors) — reliable everywhere.
      if (!query.trim()) return [];
      const sanitized = query.replace(/['"*()]/g, "").trim();
      if (!sanitized) return [];
      const like = `%${sanitized}%`;
      const { results } = await d1()
        .prepare(
          `SELECT id, name, description, name AS snippet, 0 AS rank
           FROM items
           WHERE user_id = ? AND (name LIKE ? OR description LIKE ?)
           LIMIT ?`,
        )
        .bind(userId, like, like, limit)
        .all<SearchResult>();
      return results;
    },

    async rebuildSearchIndex(): Promise<void> {
      // No FTS maintenance on the D1 path (search falls back to LIKE).
    },

    async transaction<T>(fn: (adapter: RawDbAdapter) => Promise<T>): Promise<T> {
      // D1 has no interactive transactions (only batch()); run the callback
      // against this adapter directly. Admin raw-SQL usage here is single
      // statements, so this is sufficient.
      return fn(adapter);
    },
  };

  return adapter;
}
