---
date: 2026-06-18
scope: [node, agents, infra]
category: feature
files_changed:
  - apps/agents/**
  - apps/web/app/api/coomander/agent-context/route.ts
  - apps/web/app/api/coomander/agent-tool/route.ts
  - apps/web/app/api/coomander/messages/route.ts
  - apps/web/app/api/internal/conversation-message/route.ts
  - apps/web/app/api/internal/telegram-deliver/route.ts
  - apps/web/app/api/flags/route.ts
  - apps/web/lib/coomander/coomanderChat.ts
  - apps/web/lib/flags.ts
  - apps/web/lib/use-agent-chat.ts
  - apps/web/components/agent-chat-bridge.tsx
  - apps/web/app/app/chat/page.tsx
  - docker-compose.yml
  - tailscale/Caddyfile
requires_migration: false
requires_env_vars: [AGENTS_INTERNAL_SECRET, NEXT_PUBLIC_AGENTS_URL]
breaking: false
---

## Cloudflare Agents: `apps/agents` streaming AppAgent (Scope B)

In-app AI chat can now run on a Cloudflare Agents Worker — a per-user
`AppAgent` Durable Object with streaming WebSocket chat, tool use, and
DO-alarm scheduled wakes. Cron + Telegram inbound stay in `apps/web`.

### Design

- `apps/agents` has **no D1 binding** — it reads/writes only through web API
  routes using cookie-forward `callAsUser` (live turns) and a shared
  `AGENTS_INTERNAL_SECRET` `callInternal` (scheduled wakes).
- Coomander's ops prompt + tool schemas are mirrored into
  `apps/agents/src/chat-config.ts` (the Worker bundles independently); tools call
  `/api/coomander/*`. `coomanderChat.ts` now exports `chatSystemPrompt` /
  `chatTools` / `runCoomanderTool` (behavior unchanged).
- `onUndeliverable` falls back to **Telegram** (Coomander divergence from the
  template's in-app notification).
- Gated behind the `coomander-agents-chat` flag (**default OFF**); the existing
  JSON request/response chat remains the fallback.

### Operator follow-ups (prod)

1. Set `AGENTS_INTERNAL_SECRET` to the same value on both workers; set
   `NEXT_PUBLIC_AGENTS_URL` for the web client.
2. Deploy `apps/web` first, then uncomment the `routes` in
   `apps/agents/wrangler.toml`, `wrangler secret put ANTHROPIC_API_KEY` +
   `AGENTS_INTERNAL_SECRET`, then `npm run deploy:agents`.
3. Flip `coomander-agents-chat` on to enable the WebSocket path.

Note: agents tests are a smoke skeleton — fuller DO coverage is a follow-up.
