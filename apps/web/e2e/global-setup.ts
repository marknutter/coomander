/**
 * Playwright global setup — runs once before all E2E workers start.
 *
 * Removes the E2E test database so each CI run (or manual `npm run test:e2e`)
 * starts from a clean slate.  The dev server configured in playwright.config.ts
 * will recreate the database on first request.
 *
 * In non-CI environments with `reuseExistingServer: true`, the dev server
 * is already running before global-setup executes.  Deleting the DB while
 * the server is live causes it to transparently re-open the file on next
 * query (WAL mode / file-path re-open), so this is safe.
 */

import fs from "fs";

const E2E_DB_PATH = "./data/test-e2e.db";

export default async function globalSetup() {
  for (const suffix of ["", "-wal", "-shm"]) {
    const f = E2E_DB_PATH + suffix;
    try {
      if (fs.existsSync(f)) fs.unlinkSync(f);
    } catch {
      // Ignore — file may be locked on Windows or already gone
    }
  }
}
