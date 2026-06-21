---
date: 2026-06-21
scope: [node, agents]
category: feature
files_changed:
  - apps/web/wrangler.toml
  - apps/agents/wrangler.toml
requires_migration: false
requires_env_vars: [CF_ANALYTICS_API_TOKEN]
breaking: false
---

## Enable Cloudflare AI Gateway routing + the AI usage dashboard

Created the `coomander-gateway` Cloudflare AI Gateway (unauthenticated, caching
off, no rate limiting) and set `AI_GATEWAY_ID = "coomander-gateway"` on the web
worker (`[vars]`) and the agents worker (`[env.production.vars]`).

- **Claude (Anthropic) chat now routes through the gateway in prod**, so per-model
  and per-user usage + cost are recorded and surfaced at `/admin/ai-usage`.
- The dashboard reads gateway analytics via the **`CF_ANALYTICS_API_TOKEN`** secret
  (a Cloudflare API token with **Account Analytics: Read**), set on the web worker.
- **Caching is off** (`cache_ttl=0`) so the chat never returns stale replies.
- **Dev stays direct** — the agents top-level `[vars]` `AI_GATEWAY_ID` is left unset,
  so local/dev chat doesn't pollute the prod gateway analytics.
- Workers AI open models still run via the `[ai]` binding (not the gateway); the
  gateway tracks the Claude/Anthropic tier.

Downstream projects set their own gateway name + `CF_ANALYTICS_API_TOKEN`; if
`AI_GATEWAY_ID` is unset, AI calls fall back to direct Anthropic (no behavior
change) and the dashboard shows a graceful empty-state.
