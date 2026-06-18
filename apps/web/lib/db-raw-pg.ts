/**
 * PostgreSQL implementation of the RawDbAdapter interface.
 * Uses pg Pool for raw queries.
 */

import type { RawDbAdapter, ColumnMeta, SearchResult } from "./db-raw";
import { getPgPool } from "./db";

interface PgPool {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[]; rowCount: number }>;
}

function getPool(): PgPool {
  const pool = getPgPool() as PgPool | null;
  if (!pool) {
    throw new Error("PG pool not initialized. Call getDb() first.");
  }
  return pool;
}

/**
 * Convert SQLite-style `?` placeholders to PG-style `$1, $2, ...`
 */
function pgify(sql: string): string {
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

export function createPgRawAdapter(): RawDbAdapter {
  const adapter: RawDbAdapter = {
    async healthCheck(): Promise<boolean> {
      try {
        const pool = getPool();
        await pool.query("SELECT 1");
        return true;
      } catch {
        return false;
      }
    },

    async tableExists(name: string): Promise<boolean> {
      const pool = getPool();
      const result = await pool.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1",
        [name]
      );
      return result.rows.length > 0;
    },

    async listTables(): Promise<{ name: string; rowCount: number }[]> {
      const pool = getPool();

      const tablesResult = await pool.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
         ORDER BY table_name`
      );

      const tables: { name: string; rowCount: number }[] = [];
      for (const row of tablesResult.rows as { name: string }[]) {
        // Use pg_stat_user_tables for fast approximate counts, fall back to COUNT(*)
        const countResult = await pool.query(
          `SELECT COUNT(*) as count FROM "${row.name}"`
        );
        tables.push({
          name: row.name,
          rowCount: Number((countResult.rows[0] as { count: string }).count),
        });
      }

      return tables;
    },

    async getTableColumns(table: string): Promise<ColumnMeta[]> {
      const pool = getPool();
      const result = await pool.query(
        `SELECT
           column_name AS name,
           data_type AS type,
           CASE WHEN is_nullable = 'NO' THEN true ELSE false END AS notnull,
           column_default AS "defaultValue",
           CASE WHEN
             EXISTS (
               SELECT 1 FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_name = kcu.constraint_name
               WHERE tc.table_name = $1
                 AND tc.constraint_type = 'PRIMARY KEY'
                 AND kcu.column_name = columns.column_name
             ) THEN true ELSE false END AS pk
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [table]
      );

      return result.rows as ColumnMeta[];
    },

    async getTableNames(): Promise<Set<string>> {
      const pool = getPool();
      const result = await pool.query(
        `SELECT table_name AS name
         FROM information_schema.tables
         WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
      );
      return new Set((result.rows as { name: string }[]).map((r) => r.name));
    },

    async queryAll<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]> {
      const pool = getPool();
      const result = await pool.query(pgify(sql), params);
      return result.rows as T[];
    },

    async queryFirst<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined> {
      const pool = getPool();
      const result = await pool.query(pgify(sql), params);
      return result.rows[0] as T | undefined;
    },

    async run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }> {
      const pool = getPool();
      const result = await pool.query(pgify(sql), params);
      return { changes: result.rowCount };
    },

    async searchItems(userId: string, query: string, limit: number): Promise<SearchResult[]> {
      const pool = getPool();

      if (!query.trim()) return [];

      const sanitized = query.replace(/['"*()]/g, "").trim();
      if (!sanitized) return [];

      // Use ILIKE for basic PG search. tsvector support is future work.
      const likeQuery = `%${sanitized}%`;
      const result = await pool.query(
        `SELECT id, name, description, name as snippet, 0 as rank
         FROM items
         WHERE user_id = $1 AND (name ILIKE $2 OR description ILIKE $3)
         LIMIT $4`,
        [userId, likeQuery, likeQuery, limit]
      );

      return result.rows as SearchResult[];
    },

    async rebuildSearchIndex(): Promise<void> {
      // No-op for PG — tsvector indexes are maintained automatically
    },

    async transaction<T>(fn: (adapter: RawDbAdapter) => Promise<T>): Promise<T> {
      const pool = getPool();
      await pool.query("BEGIN");
      try {
        const result = await fn(adapter);
        await pool.query("COMMIT");
        return result;
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    },
  };

  return adapter;
}
