---
date: 2026-06-20
scope: [node, agents, core, mobile]
category: feature
files_changed:
  - packages/core/src/chat/model-catalog.ts
  - packages/core/src/chat/messages.ts
  - packages/core/src/chat/index.ts
  - apps/agents/src/chat.ts
  - apps/agents/src/chat-model.ts
  - apps/agents/src/chat-config.ts
  - apps/agents/wrangler.toml
  - apps/agents/.dev.vars.example
  - apps/web/lib/active-model.ts
  - apps/web/lib/provider-keys.ts
  - apps/web/lib/secrets-crypto.ts
  - apps/web/lib/model-catalog.ts
  - apps/web/lib/coomander/coomanderChat.ts
  - apps/web/app/admin/ai-models/page.tsx
  - apps/web/app/admin/ai-usage/page.tsx
  - apps/web/app/settings/page.tsx
  - apps/web/app/api/admin/ai-models/route.ts
  - apps/web/app/api/admin/ai-models/keys/route.ts
  - apps/web/app/api/settings/model-preference/route.ts
  - apps/web/app/api/coomander/agent-context/route.ts
  - apps/web/app/api/coomander/chat/route.ts
  - apps/web/app/api/flags/route.ts
  - apps/web/migrations/022_create_ai_settings.sql
  - apps/web/migrations-pg/005_create_ai_settings.sql
  - apps/web/lib/schema.sqlite.ts
  - apps/web/lib/schema.pg.ts
  - apps/web/.env.example
  - apps/web/content/docs/dev/ai-models.mdx
requires_migration: true
requires_env_vars: [PROVIDER_KEY_KEK, AI_GATEWAY_ID, AI_GATEWAY_TOKEN, CF_ANALYTICS_API_TOKEN, CLOUDFLARE_API_TOKEN]
breaking: true
---

## Multi-provider AI chat on the agents WebSocket (epic #203)

In-app AI chat is now **multi-provider** and runs on a single provider-agnostic
engine built on the **Vercel AI SDK** (`streamText`), executed by the agents
Worker over a WebSocket.

### What changed

- **Multi-provider engine** — both **Claude (BYOK Anthropic)** and **open
  Cloudflare Workers AI** models run through one `streamText` path. Claude uses
  `@ai-sdk/anthropic` (`createAnthropic`); open `@cf/...` models use
  `workers-ai-provider` (`createWorkersAI` over the `AI` binding, no provider
  key). `openai`/`google` entries are reserved (throw "not yet wired").
- **Tiered model catalog in `@coomander/core`** (`packages/core/src/chat/`) —
  one shared, env-free copy of catalog entries, capability-gated message
  building, and model-aware context trimming. The web app imports it via the
  `@/lib/model-catalog` re-export shim. Add/change models there, never inline.
- **AI Gateway routing (optional)** — set `AI_GATEWAY_ID` (+
  `CLOUDFLARE_ACCOUNT_ID`, + `AI_GATEWAY_TOKEN` if authenticated) to route the
  Claude tier through a Cloudflare AI Gateway for usage/cost analytics, caching,
  and fallback. Unset → direct Anthropic (no behavior change).
- **Admin model switcher + encrypted provider keys** (`/admin/ai-models`) —
  admins set the default model and set/rotate provider keys, encrypted at rest
  (AES-256-GCM via Web Crypto; key derived from `PROVIDER_KEY_KEK`, falling back
  to `BETTER_AUTH_SECRET`). Keys are write-only/masked and admin-gated. **Adds
  migration 022** (`provider_keys` + `app_settings` tables; pg dialect: 005).
- **Per-user model preference** (`/settings`) — users pick their own model.
  Resolution precedence: per-user pref > admin default > `CHAT_MODEL` env >
  `DEFAULT_MODEL_ID`. The agent resolves the active model per turn via
  `GET /api/coomander/agent-context`.
- **AI usage / cost dashboard** (`/admin/ai-usage`) — per-model + per-user
  requests/tokens/cost/latency/cache-hit from the Cloudflare GraphQL Analytics
  API. Needs `CF_ANALYTICS_API_TOKEN` (Account Analytics: Read) +
  `CLOUDFLARE_ACCOUNT_ID` + `AI_GATEWAY_ID`; otherwise shows an empty-state.
- **Stale default model fixed** — the retired `claude-sonnet-4-20250514` id
  (Anthropic now 404s it) was replaced with `claude-sonnet-4-6` across the
  non-chat AI features (`lib/ai/analyze-content.ts`, the video-processor
  container) and the `CHAT_MODEL` example in `.env.example`.

### ⚠️ Breaking

- **The SSE / `POST /api/chat` chat path is removed.** Chat is **WebSocket-only**
  on **both web and mobile**, served by the agents Worker (`apps/agents`).
  `GET /api/coomander/chat` only hydrates the thread on mount; there is no POST
  send handler. The old `lib/chat-engine.ts` and `lib/chat-config.ts` were
  deleted.
- **The `coomander-agents-chat` feature flag was removed** — it gated the
  WS-vs-SSE choice and gates nothing now. `/api/flags` returns `{ flags: {} }`.
- **The agents Worker is now required for chat.** Downstream projects inherit
  this via coomander-sync.

### Dev gotcha: Workers AI needs `CLOUDFLARE_API_TOKEN` in local/Docker dev

Workers AI inference can't run in local miniflare, so `wrangler dev` proxies the
`AI` binding to remote Cloudflare by deploying a temporary **preview Worker** —
which needs **Workers Scripts** access, not just Workers AI. Set
**`CLOUDFLARE_API_TOKEN`** (from the **"Edit Cloudflare Workers"** template **+
`Workers AI: Read`**) + `CLOUDFLARE_ACCOUNT_ID`. A Workers-AI-only token 403s on
`edge-preview`. Because the `[ai]` binding opens this proxy **at boot**, the
agents-dev Worker won't start in Docker at all — even for Claude-only chat —
without valid CF auth. Non-Docker dev can `wrangler login` instead. Prod (on
Workers) needs neither. See `content/docs/dev/ai-models.mdx`.

### Migration

Run `npm run db:migrate` to apply `migrations/022_create_ai_settings.sql`
(SQLite) / `migrations-pg/005_create_ai_settings.sql` (Postgres), which add the
`app_settings` and `provider_keys` tables.
