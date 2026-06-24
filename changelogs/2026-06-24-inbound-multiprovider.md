---
date: 2026-06-24
scope: [node]
category: fix
files_changed:
  - apps/web/lib/coomander/inbound.ts
  - apps/web/lib/coomander/inbound-model.ts
  - apps/web/lib/coomander/coomanderChat.ts
  - apps/web/wrangler.toml
  - apps/web/package.json
requires_migration: false
requires_env_vars: []
breaking: false
---

## Telegram inbound classifier routes through the multi-provider engine

The Telegram inbound classifier (`lib/coomander/inbound.ts`) hardcoded the model
(`new Anthropic()` + a `MODEL` env const) and bypassed the multi-provider engine,
so the admin/per-user model switcher did nothing for Telegram and the inbound
path could never run credit-free on Workers AI. Now it resolves the chosen model
via `resolveActiveModel`/`resolveActiveModelId` and dispatches Anthropic + Workers
AI through the Vercel AI SDK — mirroring the agents-worker chat path
(`apps/agents/src/chat-model.ts`). (Port of geology #282/#288.)

- **New `lib/coomander/inbound-model.ts`** — `resolveInboundModel(userId)` maps the
  chosen catalog entry to an AI SDK `LanguageModel`: `anthropic` → `createAnthropic`,
  `cloudflare` → `createWorkersAI({ binding: env.AI })`. Forced tool-calling means
  any model without tool support (or unknown id / missing `env.AI` binding / unwired
  provider) falls back to the Anthropic default, logged; classification never breaks.
- **`classifyMessage` → `generateText`** with `toolChoice: "required"`; tool defs
  converted to AI SDK `tool()` + zod (`inboundTools()`), keeping every tool/property
  name identical so `resolveToolUse`/`executeAction`/the webhook are untouched.
  Usage now logs the actually-resolved model id (AI-SDK `inputTokens`/`outputTokens`).
- **`[ai]` binding** added to `apps/web/wrangler.toml` (top-level + `[env.production]`)
  so the web worker can run Workers AI directly. In `next dev` there is no binding,
  so Workers-AI choices fall back to Anthropic (real WAI runs only in the deployed
  worker).
- **deps** (match `apps/agents`): `ai@6.0.206`, `@ai-sdk/anthropic@3.0.84`,
  `workers-ai-provider@3.2.0`. Lockfile regenerated without dropping Linux platform binaries.

The Anthropic-format tool schemas the agents-worker chat path consumes
(`coomanderChat.chatTools()`) were relocated there verbatim (no agent-path change);
they must stay in sync with `inboundTools()`. Note: coomander's `usage.ts` records
only raw token counts (no cost-rate table), so there is no Workers-AI cost
mispricing to fix here (unlike geology #287).
