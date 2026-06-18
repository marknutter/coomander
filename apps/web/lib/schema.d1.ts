/**
 * Drizzle ORM schema for Cloudflare D1.
 *
 * D1 is SQLite-on-Cloudflare, so the schema is structurally identical to
 * schema.sqlite.ts. This file is a re-export shim — keeping it as a separate
 * module preserves the "one schema file per dialect" architecture that
 * schema.sqlite.ts and schema.pg.ts already follow, and gives D1 its own
 * file if the schemas ever need to diverge.
 */

export * from "./schema.sqlite";
