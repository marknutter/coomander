---
date: 2026-06-21
scope: [node]
category: fix
files_changed:
  - apps/web/lib/ai-usage.ts
  - apps/web/app/admin/ai-usage/page.tsx
  - apps/web/tests/ai-usage.test.ts
requires_migration: false
requires_env_vars: [CF_ANALYTICS_API_TOKEN]
breaking: false
---

## Fix the AI usage dashboard's Cloudflare GraphQL query (was built on a wrong schema)

Synced from AppSeed (`2026-06-20-ai-usage-schema-fix`). The `/admin/ai-usage`
dashboard's GraphQL Analytics query (`lib/ai-usage.ts`) was written against
guessed, unverified field names, so the dashboard rendered empty even with a
correctly-permissioned `CF_ANALYTICS_API_TOKEN`. Corrected to the verified
`aiGatewayRequestsAdaptiveGroups` schema:

- **Requests** from the group-level `count` (no `sum.requests`).
- **Tokens** from the cached/uncached split: `tokensIn = cachedTokensIn +
  uncachedTokensIn`, `tokensOut = cachedTokensOut + uncachedTokensOut`.
- **Daily series bucket** is `date` (not the non-existent `datetimeDay`).
- **Per-user filter** uses `metadataValues_has: <userId>` (not the invalid
  `metadataKey`/`metadataValue` equality).

Cloudflare's AI Gateway dataset has **no `quantiles` field**, so request latency
(p50/p90) isn't available — the "Avg Latency" headline tile and per-model
p50/p90 columns were removed; the freed tile now shows **Cache Hit** rate. The
reader still skips gracefully (empty-state, never throws) when
`CF_ANALYTICS_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` / `AI_GATEWAY_ID` are unset.
