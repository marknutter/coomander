# Deploying MaddieHQ to Cloudflare Workers

MaddieHQ deploys as a **Cloudflare Worker** (not Pages) via OpenNext. The app lives
in `node/`, builds to `.open-next/`, and ships through a custom worker entrypoint
(`node/custom-worker.ts`) that wraps the OpenNext bundle and adds the Coomander
cron `scheduled()` handler.

- **Runtime:** Cloudflare Workers + D1 (SQLite) + R2 (object storage)
- **Custom domain:** `maddiehq.oqodo.com` (from `wrangler.toml` `routes`)
- **Cron triggers:** defined in `wrangler.toml` `[triggers]` (daily Coomander
  slots + the Sunday weekly review) — picked up automatically on deploy
- **DB driver in prod:** D1 (`DATABASE_DRIVER = "d1"` in `wrangler.toml [vars]`)

There is **no Docker production image** — Docker is local-dev only (see
`docker-compose.yml` + the dev container). Production is Workers.

---

## Option A — Cloudflare Workers Builds (Git integration, recommended)

Connect the GitHub repo to the Worker so Cloudflare builds + deploys on push to
`main`. Configure in the dashboard: **Workers & Pages → `maddiehq` → Settings →
Build → Connect to Git**.

| Field | Value |
|---|---|
| Repository | `marknutter/maddiehq` |
| Production branch | `main` |
| Non-production branch builds | **Disabled** (`develop` is local-dev-only; no preview deploys) |
| Root directory | `node` |
| Build command | `npx opennextjs-cloudflare build` |
| Deploy command | `npx wrangler d1 migrations apply maddiehq-db --remote && npx opennextjs-cloudflare deploy` |
| Node version | `22` (also pinned via `node/.node-version`) |

Notes:
- **Build** must be `opennextjs-cloudflare build` (runs `next build` + emits the
  `.open-next/` bundle). Plain `next build` does not produce a Workers-deployable
  artifact.
- **Deploy** applies D1 migrations FIRST (idempotent; aborts the deploy if they
  fail) so the schema is current before the new code goes live, then ships via
  OpenNext (which bundles `custom-worker.ts` per `wrangler.toml`).

### Build-time environment variables

Set these as **build variables** in the Workers Builds config (read by
`next build`; distinct from runtime secrets):

| Var | Value |
|---|---|
| `NODE_VERSION` | `22` |
| `BETTER_AUTH_URL` | `https://maddiehq.oqodo.com` |
| `APP_URL` | `https://maddiehq.oqodo.com` |
| `APP_NAME` | `MaddieHQ` |
| `BETTER_AUTH_SECRET` | any non-empty placeholder (the real value is a runtime secret) |

> Do **not** put real secrets in `node/.env.local` for prod — `next build` bakes
> `.env.local` values into the bundle (`.open-next/cloudflare/next-env.mjs`).
> Workers Builds uses the build variables above instead, which is the clean path.

---

## Option B — Manual deploy (from a machine with `wrangler` auth)

```bash
cd node
npm ci
npm run build:cf                                  # opennextjs-cloudflare build
npx wrangler d1 migrations apply maddiehq-db --remote
npm run deploy:cf                                 # opennextjs-cloudflare deploy
```

Requires `wrangler login` (or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` in
the environment). Use node 22.

---

## Runtime secrets (set once via `wrangler secret put`)

These live on the Worker (Settings → Variables and Secrets), NOT in git. Already
configured on the `maddiehq` Worker:

| Secret | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | AI chat + Coomander generation/classification |
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` | Auth |
| `INSTAGRAM_CLIENT_ID`, `INSTAGRAM_CLIENT_SECRET`, `INSTAGRAM_INITIAL_TOKEN` | IG sync |
| `VIDEO_PROCESSOR_SECRET` | Video-processor worker auth |
| `MADDIE_TELEGRAM_BOT_TOKEN` | Coomander Telegram bot (`@coomander_bot`) outbound |
| `COOMANDER_RUN_SECRET` | Guards the Coomander cron endpoints (`x-agent-secret`) |
| `MADDIE_TELEGRAM_WEBHOOK_SECRET` | Verifies inbound Telegram webhook requests |

To add or rotate one:
```bash
cd node
echo 'VALUE' | npx wrangler secret put SECRET_NAME
```

---

## Bindings (from `wrangler.toml`)

- **D1** `DB` → database `maddiehq-db` (`database_id` in `wrangler.toml`). Must
  exist before first deploy (`wrangler d1 create maddiehq-db` if not).
- **R2** `STORAGE` → bucket `maddiehq-storage` (enable R2 + create the bucket
  before first deploy).
- **Service** `VIDEO_PROCESSOR` → the separately-deployed `maddiehq-video-processor`
  worker (see `node/workers/video-processor/`).

---

## Cron triggers

Defined in `wrangler.toml` `[triggers]` and routed by `custom-worker.ts`:

| Cron (UTC) | Maps to | Local (US Central) |
|---|---|---|
| `0 12 * * *` | `/api/coomander/run` slot=morning | ~07:00 |
| `0 18 * * *` | slot=midday | ~13:00 |
| `0 21 * * *` | slot=check | ~16:00 |
| `0 1 * * *` | slot=evening | ~20:00 (prev day) |
| `0 1 * * 1` | `/api/coomander/weekly-review` | Sun ~20:00 |

They drift ~1h across DST; per-user local scheduling is a later milestone.

---

## After the first deploy — register the Telegram webhook (inbound)

The inbound Coomander reply path needs Telegram pointed at the deployed endpoint,
with the secret token matching `MADDIE_TELEGRAM_WEBHOOK_SECRET`. Run once from
`node/` (reads the secrets from `.env.local`, so nothing is printed):

```bash
cd node
TOKEN=$(grep '^MADDIE_TELEGRAM_BOT_TOKEN=' .env.local | cut -d= -f2)
SECRET=$(grep '^MADDIE_TELEGRAM_WEBHOOK_SECRET=' .env.local | cut -d= -f2)
curl -X POST "https://api.telegram.org/bot${TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d "{\"url\":\"https://maddiehq.oqodo.com/api/coomander/webhook\",\"secret_token\":\"${SECRET}\"}"
```

For dev testing you can point the webhook at the tailnet URL instead
(`https://maddiehq.<tailnet>.ts.net/api/coomander/webhook`) — real HTTPS, works.
`... /getWebhookInfo` shows status; `... /deleteWebhook` removes it.

---

## Gotchas

- **`build:cf` does not re-run on code change by itself** — always build before
  deploy (Option B). Workers Builds handles this for you.
- **Node 22** — pinned via `node/.node-version` and the build var; do not build on
  a newer major (native-module / compat churn).
- **`custom-worker.ts` is the entrypoint** (`wrangler.toml` `main`), not
  `.open-next/worker.js` directly — it adds the cron handler. Keep the
  `[triggers]` crons in sync with `custom-worker.ts` `CRON_SLOT` / `WEEKLY_REVIEW_CRON`.
- **wrangler.toml top-level scalars must stay above any `[table]` header** — a
  `[triggers]`/`[vars]` block placed too early silently absorbs the scalars after
  it. Validate with `npx wrangler deploy --dry-run` after edits.
