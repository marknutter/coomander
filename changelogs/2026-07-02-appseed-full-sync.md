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

## AppSeed sync 2026-07-02 — realtime backbone, prod D1 fixes, admin/security hardening, email marketing

Large sync from the AppSeed template (issue #222, PR #223). Substantial portion complete; a
follow-up tracks the remainder (Postgres deploy-target fix, chat UI features, mobile).

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

Migrations: SQLite 023–027, PG 006–010 (025/008 intentionally unused). New Cloudflare Queue must
be created before prod deploy (`wrangler queues create coomander-campaign-send`).
