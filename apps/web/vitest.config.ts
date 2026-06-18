import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e", ".open-next"],
    setupFiles: ["./tests/setup.ts"],
    // Run test files sequentially so parallel forks don't race on the same
    // SQLite test.db file (e.g. concurrent migration inserts).
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "html"],
      include: ["app/api/**/*.ts", "lib/**/*.ts"],
      exclude: [
        // Auth pass-through — no logic to test
        "app/api/auth/**",
        // Stripe routes require external API keys / webhooks
        "app/api/stripe/**",
        // Client-side React code (not runnable in node environment)
        "lib/auth-client.ts",
        "lib/use-toast.ts",
        "lib/commands.ts",
        // Content helpers (MDX/blog) — complex FS setup, low ROI for unit tests
        "lib/mdx.ts",
        // External-service singleton — tested via integration not unit
        "lib/stripe.ts",
        // Standard exclusions
        "**/*.d.ts",
        "**/*.test.ts",
        "**/node_modules/**",
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
    env: {
      BETTER_AUTH_SECRET: "test-secret-do-not-use-in-production",
      BETTER_AUTH_URL: "http://localhost:3000",
      DATABASE_PATH: "./data/test.db",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
