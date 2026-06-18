import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

// Runs tests inside workerd via miniflare, so Durable Objects (and their
// SQLite state) behave exactly as in `wrangler dev` / production.
//
// NOTE: @cloudflare/vitest-pool-workers@0.16.x removed the legacy
// `./config` subpath export (`defineWorkersConfig`) — it was dropped in
// 0.13.0. The current API wires the pool via the `cloudflareTest` Vite
// plugin from the package's main export. wrangler.toml provides the
// AppAgent Durable Object binding + new_sqlite_classes migration.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.toml" },
    }),
  ],
});
