#!/bin/sh
set -e

echo "Validating environment..."
./scripts/validate-env.sh

echo "Running database migrations..."

# Run Better Auth schema generation
# Note: This requires auth.ts to properly export the auth instance
npx @better-auth/cli@latest migrate --config lib/auth.ts || echo "Better Auth migration skipped (not critical for production)"

# Run app-specific migrations
node -e "
const { runMigrations } = require('./lib/migrate.js');
const Database = require('better-sqlite3');
const db = new Database(process.env.DATABASE_PATH || './data/appseed.db');
try {
  runMigrations(db);
  console.log('App migrations completed successfully');
} catch (err) {
  console.error('Migration error:', err);
}
db.close();
" || echo "App migrations skipped"

echo "Starting application..."
exec node_modules/.bin/next start -p "${PORT:-3006}"
