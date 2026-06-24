---
date: 2026-06-23
scope: [node]
category: feature
files_changed:
  - docker-compose.yml
  - apps/web/scripts/telegram-webhook.ts
  - apps/web/package.json
  - .env.example
  - apps/web/.env.example
  - README.md
requires_migration: false
requires_env_vars: [CLOUDFLARE_TUNNEL_TOKEN, TELEGRAM_WEBHOOK_URL, COOMANDER_BOT_USERNAME]
breaking: false
---

## Local Telegram dev: per-developer dev bot + Cloudflare Tunnel

Lets any contributor run the dev server and use Telegram locally — the bot
replying and the **Connect Telegram** link flow — against their own machine.

Telegram allows **one webhook URL per bot**, and prod's `@coomander_bot` owns it,
so each developer runs **their own dev bot** (BotFather) plus a **persistent
Cloudflare named tunnel** that publishes a stable public hostname
(`dev-<you>.coomander.com`) scoped to just the `/api/coomander/webhook` path.
Everything is env-driven — **no app code changes**.

- **`cloudflared` sidecar** in `docker-compose.yml`, opt-in via
  `--profile telegram` (plain `docker compose up` is unaffected). Shares
  `caddy-dev`'s netns so the tunnel reaches next dev at `localhost:3000`. Reads
  `CLOUDFLARE_TUNNEL_TOKEN` (repo-root `.env`).
- **`npm run telegram:webhook -- set|info|delete`**
  (`apps/web/scripts/telegram-webhook.ts`) registers/inspects/clears the webhook
  from `MADDIE_TELEGRAM_BOT_TOKEN` + `MADDIE_TELEGRAM_WEBHOOK_SECRET` +
  `TELEGRAM_WEBHOOK_URL`. Prints the resolved bot `@username` (getMe) and
  requires `--yes` to `set` — a guard against repointing prod's bot.
- **`COOMANDER_BOT_USERNAME`** already drives the Connect deep link; set it to
  your dev bot's username so the flow points at the dev bot in dev.
- New convenience script `npm run docker:dev:telegram`; new env vars documented
  in both `.env.example` files; README gains a "Local Telegram dev" section.

Downstream projects with their own Telegram bot follow the same pattern: a dev
bot + a named tunnel, with `COOMANDER_BOT_USERNAME`/`TELEGRAM_WEBHOOK_URL` per
developer. Nothing here touches production.
