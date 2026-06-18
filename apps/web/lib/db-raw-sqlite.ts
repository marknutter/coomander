/**
 * SQLite implementation of the RawDbAdapter interface.
 * Wraps better-sqlite3 synchronous calls in async for API compatibility.
 */

import type { RawDbAdapter, ColumnMeta, SearchResult } from "./db-raw";
import { getRawDb } from "./db";

export function createSqliteRawAdapter(): RawDbAdapter {
  const adapter: RawDbAdapter = {
    async healthCheck(): Promise<boolean> {
      try {
        const db = getRawDb();
        db.prepare("SELECT 1").get();
        return true;
      } catch {
        return false;
      }
    },

    async tableExists(name: string): Promise<boolean> {
      const db = getRawDb();
      const row = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
        .get(name) as { name: string } | undefined;
      return !!row;
    },

    async listTables(): Promise<{ name: string; rowCount: number }[]> {
      const db = getRawDb();
      const tables = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        .all() as { name: string }[];

      return tables.map((t) => {
        const countRow = db
          .prepare(`SELECT COUNT(*) as count FROM "${t.name}"`)
          .get() as { count: number };
        return { name: t.name, rowCount: countRow.count };
      });
    },

    async getTableColumns(table: string): Promise<ColumnMeta[]> {
      const db = getRawDb();
      const rows = db.prepare(`PRAGMA table_info("${table}")`).all() as {
        cid: number;
        name: string;
        type: string;
        notnull: number;
        dflt_value: string | null;
        pk: number;
      }[];

      return rows.map((r) => ({
        name: r.name,
        type: r.type,
        notnull: r.notnull === 1,
        defaultValue: r.dflt_value,
        pk: r.pk === 1,
      }));
    },

    async getTableNames(): Promise<Set<string>> {
      const db = getRawDb();
      const rows = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        )
        .all() as { name: string }[];
      return new Set(rows.map((r) => r.name));
    },

    async queryAll<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      const db = getRawDb();
      return db.prepare(sql).all(...params) as T[];
    },

    async queryFirst<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const db = getRawDb();
      return db.prepare(sql).get(...params) as T | undefined;
    },

    async run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
      const db = getRawDb();
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
    },

    async searchItems(userId: string, query: string, limit: number): Promise<SearchResult[]> {
      const db = getRawDb();

      if (!query.trim()) return [];

      const sanitized = query.replace(/['"*()]/g, "").trim();
      if (!sanitized) return [];

      const ftsQuery = sanitized
        .split(/\s+/)
        .map((term) => `"${term}"*`)
        .join(" ");

      try {
        return db
          .prepare(
            `SELECT
              items.id,
              items.name,
              items.description,
              snippet(items_fts, 0, '<mark>', '</mark>', '...', 32) as snippet,
              rank
            FROM items_fts
            JOIN items ON items.rowid = items_fts.rowid
            WHERE items_fts MATCH ?
              AND items.user_id = ?
            ORDER BY rank
            LIMIT ?`
          )
          .all(ftsQuery, userId, limit) as SearchResult[];
      } catch {
        // FTS query syntax error — fall back to LIKE
        const likeQuery = `%${sanitized}%`;
        return db
          .prepare(
            `SELECT id, name, description, name as snippet, 0 as rank
            FROM items
            WHERE user_id = ? AND (name LIKE ? OR description LIKE ?)
            LIMIT ?`
          )
          .all(userId, likeQuery, likeQuery, limit) as SearchResult[];
      }
    },

    async rebuildSearchIndex(): Promise<void> {
      const db = getRawDb();
      db.prepare("INSERT INTO items_fts(items_fts) VALUES('rebuild')").run();
    },

    async transaction<T>(fn: (adapter: RawDbAdapter) => Promise<T>): Promise<T> {
      const db = getRawDb();
      // better-sqlite3 transactions are synchronous, but our adapter is async.
      // We run the callback directly — it will use the same connection.
      return db.transaction(async () => {
        return await fn(adapter);
      })() as unknown as Promise<T>;
    },
  };

  return adapter;
}
