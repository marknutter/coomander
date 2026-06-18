import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "html",
  use: {
    baseURL: "http://localhost:3010",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    // Port 3010 to avoid collisions with sibling dev servers on 3000/3001/3005.
    command: "npm run dev -- -p 3010",
    url: "http://localhost:3010",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: {
      BETTER_AUTH_SECRET: "test-secret-do-not-use-in-production",
      BETTER_AUTH_URL: "http://localhost:3010",
      DATABASE_PATH: "./data/test-e2e.db",
      ADMIN_EMAILS: "e2e-admin@test.local",
      RATE_LIMIT_AUTH: "100",  // High limit for e2e tests (default: 5/min)
      INSTAGRAM_CLIENT_ID: "test-ig-client-id",
      INSTAGRAM_CLIENT_SECRET: "test-ig-client-secret",
    },
  },
});
