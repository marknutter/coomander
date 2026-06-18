-- Bridge migration: marks existing schema as managed by Drizzle ORM.
-- All tables already exist from migrations 001-007. This migration is a
-- no-op placeholder so that drizzle-kit's generated migrations start from
-- a clean baseline matching lib/schema.ts.
--
-- After this migration, new tables should be added via:
--   1. Update lib/schema.ts
--   2. Run `npm run db:generate` to create a drizzle migration
--   3. The generated SQL will be applied by drizzle-kit
--
-- The existing migration runner (lib/migrate.ts) continues to work for
-- migrations 001-008. It can be fully retired once all deployments have
-- applied this migration.

SELECT 1; -- no-op

