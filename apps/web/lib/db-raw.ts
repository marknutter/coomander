/**
 * Dialect-agnostic raw SQL adapter interface.
 *
 * Abstracts SQLite-specific calls (PRAGMA, sqlite_master, FTS5) behind a
 * common interface with PG equivalents (information_schema, ILIKE).
 */

export interface ColumnMeta {
  name: string;
  type: string;
  notnull: boolean;
  defaultValue: string | null;
  pk: boolean;
}

export interface SearchResult {
  id: string;
  name: string;
  description: string;
  snippet: string;
  rank: number;
}

export interface RawDbAdapter {
  /** Simple liveness check */
  healthCheck(): Promise<boolean>;

  /** Check if a table exists */
  tableExists(name: string): Promise<boolean>;

  /** List all application tables with row counts */
  listTables(): Promise<{ name: string; rowCount: number }[]>;

  /** Get column metadata for a table */
  getTableColumns(table: string): Promise<ColumnMeta[]>;

  /** Get all valid table names */
  getTableNames(): Promise<Set<string>>;

  /** Execute a SELECT query returning multiple rows */
  queryAll<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T[]>;

  /** Execute a SELECT query returning the first row */
  queryFirst<T = Record<string, unknown>>(sql: string, ...params: unknown[]): Promise<T | undefined>;

  /** Execute an INSERT/UPDATE/DELETE returning affected row count */
  run(sql: string, ...params: unknown[]): Promise<{ changes: number; lastInsertRowid?: number | bigint }>;

  /** Search items using FTS5 (SQLite) or ILIKE (PG) */
  searchItems(userId: string, query: string, limit: number): Promise<SearchResult[]>;

  /** Rebuild the search index (FTS5 only; no-op for PG) */
  rebuildSearchIndex(): Promise<void>;

  /** Execute a function within a transaction */
  transaction<T>(fn: (adapter: RawDbAdapter) => Promise<T>): Promise<T>;
}

import { isPg } from "./db-dialect";
// Static imports — Vitest can resolve these where CommonJS require cannot.
// Both adapter factories are lightweight (no side effects at module load).
import { createSqliteRawAdapter } from "./db-raw-sqlite";
import { createPgRawAdapter } from "./db-raw-pg";

let _adapter: RawDbAdapter | null = null;

/**
 * Get the dialect-appropriate raw DB adapter.
 * Use this instead of getRawDb() for dialect-agnostic code.
 */
export function getRawAdapter(): RawDbAdapter {
  if (_adapter) return _adapter;

  _adapter = isPg() ? createPgRawAdapter() : createSqliteRawAdapter();
  return _adapter;
}
