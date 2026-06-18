// OpenNext configuration for the Cloudflare Workers adapter.
//
// Step 7 of #275. Keeps the config minimal: defaults for everything except
// where Cloudflare-specific overrides are required. Caching, queue, and
// tag-cache overrides will be filled in once the first deploy is running
// and we know which features the app actually exercises (Step 8+).

import { defineCloudflareConfig } from "@opennextjs/cloudflare";

export default defineCloudflareConfig({
  // Default in-memory cache. Swap for an R2- or KV-backed incremental cache
  // once the first deploy is successful and we have measured cold-start /
  // hit-rate behavior. See @opennextjs/cloudflare/overrides/incremental-cache/.
});
