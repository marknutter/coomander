---
date: 2026-07-02
scope: [node]
category: feature
files_changed:
  - apps/agents/src/channel/
  - apps/web/lib/realtime.ts
  - apps/web/lib/use-realtime.ts
  - apps/web/lib/ssrf.ts
  - apps/web/lib/db-raw-d1.ts
  - apps/web/lib/db-helpers.ts
  - apps/web/lib/campaign-send.ts
  - apps/web/lib/audiences.ts
  - apps/web/lib/auth.ts
  - apps/web/wrangler.toml
  - apps/agents/wrangler.toml
requires_migration: true
requires_env_vars: [WEBHOOK_ALLOW_PRIVATE_TARGETS, CAMPAIGN_BATCH_SIZE, STUCK_CAMPAIGN_MINUTES]
breaking: false
---

## AppSeed sync 2026-07-02 — realtime, prod D1 fixes, admin/security, email marketing, chat charts/image-gen, Postgres

Large sync from the AppSeed template (issue #222, PR #223). **All 27 checklist items ported**
(minus the 3 irrelevant). 850 tests green; typecheck clean across web/agents/core; Postgres
live-verified on 16.

**Realtime backbone** — replaced the in-process SSE pub/sub (broken across Worker isolates under
OpenNext) with a `RealtimeChannel` Durable Object in `apps/agents`, DO-backed `publish()` via a
`REALTIME` service binding, and a WebSocket `useRealtime` client. Agent proactive delivery now
publishes to the `user:{id}` channel (Telegram fallback preserved). Migration tag `v2` on the
agents worker.

**Prod-broken D1 fixes** — D1 raw-SQL adapter (`db-raw-d1.ts`) fixes admin users/table-browser
500s; `executeChanges()` now reads D1 `meta.changes` so every compare-and-set (campaign send,
plan changes, webhooks) works on prod.

**Security / admin hardening** — webhook SSRF guard (`lib/ssrf.ts`, fetch-time validation,
`redirect: manual`); admin DB-editor privilege/billing-column write guard + pk-fix; quick-wins
(constant-time cron secret, input clamping, voice/speak cap+rate-limit, waitlist info-leak,
blog-editor CSP, `force-dynamic` sweep); working admin password-reset + enforced account disable
via the Better Auth `admin()` plugin (adds `role`/`banned`/`banReason`/`banExpires`). Microsoft
OAuth removed. Voice headers fixed (`microphone=(self)` + CSP `media-src`).

**Email marketing** — audiences/tags, batched queued campaign send (Cloudflare Queue
`coomander-campaign-send`), scheduled send, resend/cancel, failed-state + stuck-campaign
reconciler. Send route reverts to `failed` on enqueue error; batch progress is idempotent per
`(campaignId, batchIndex)` against Cloudflare Queues at-least-once redelivery.

**Chat** — connecting/reconnecting indicator + send-gating; safeSend guard + stream abort +
inactivity watchdog; worker-side error surfacing; rich-block pipeline in `@coomander/core`
(consolidated 4 stripTags impls); `[CHART:]` charts (Recharts); shadcn chat components
(MessageScroller); `[IMAGE:]` AI image generation (flux via Workers AI + R2 serving, auth-scoped
keys + per-user/day quota); dev/prod AI-gateway split docs.

**Mobile** — Expo `useRealtime` + proactive delivery; Android edge-to-edge keyboard fix.
**Live campaign progress** — admin campaign page subscribes to the `campaign:{id}` realtime channel.
**PostgreSQL target fixed** — dialect-aware `scripts/migrate.ts`, `getEffectivePlan` PG branch,
authored PG migrations for all 43 `schema.pg.ts` tables, schema↔migration drift-guard test.

New deps: `recharts@3.9.0`, `@shadcn/react@0.1.0` (run `npm install`). Migrations: SQLite 023–027,
PG 001/006–011 (025/008 intentionally unused). New Cloudflare Queue must be created before prod
deploy (`wrangler queues create coomander-campaign-send`); image-gen needs `CLOUDFLARE_ACCOUNT_ID`
+ a Workers-AI-scoped `CLOUDFLARE_API_TOKEN` on the agents worker.
