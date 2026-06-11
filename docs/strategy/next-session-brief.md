# Next session brief — picking up Coomander implementation

**Audience:** Mark, or any agent Mark hands this to.
**Status:** All strategy decisions are made. Issue set is filed. Zero code has been written yet.
**Length:** Long on purpose. Read it once cold and you should be unblocked.

---

## 1. Where we are

Coomander is an OF-creator analytics + operations product. The strategic direction was sharpened across a series of working sessions ending 2026-06-04, after Maddie (the dogfood creator) shared 4 months of WhatsApp transcripts with her management team and her personal learning notes from the program.

Two product surfaces are live in the issue tracker:

- **Insight epics** (#146–#149) — predict reach, clone top performers, score audience fit, co-write captions+hooks. Pure analysis, builds on existing data. Differentiator: closed-loop grading of every prediction against the post that ships from it. Out of scope for this session — these are post-MVP.
- **Ops epics** (#150–#157) — Coomander, the AI accountability + fan-chat-assist agent. Pings the creator on Telegram to keep her on cadence, classifies inbound replies into structured actions, generates scripts and response drafts for the chatting team to send. **This is what we're building first.**

Coomander's full design lives in `docs/strategy/coomander-direction.md`. The communication policy (what we will and won't ever send) lives in `docs/strategy/communication-policy.md`. **Read both before writing code.**

The big decisions, in case you only read this file:

1. **OF-only scope.** No parallel-project tracking, no MadiMade brand work, no Twitch streaming integration. Just the OF flywheel.
2. **Light-companion persona now, full-companion later.** Coomander has warmth but doesn't fabricate memory of the creator's life. The substrate for full-companion (indefinite chat-log retention) lands in v1 so we don't retrofit.
3. **Fan-chat assistance is in scope, but humans send.** Path (b) — we generate scripts and response drafts, the chatting team sends. No automated outbound to fans on any platform in v1.
4. **IG/TikTok/FB/Snap DM automation is out.** Account-ban risk on IG is existential because IG is the OF funnel.
5. **Adjustable nag default tight, user can dial back.** Default leans toward frequent touchpoints because research shows that's what keeps creators on task.

---

## 2. Required reading in order

1. **`docs/strategy/coomander-direction.md`** — the canonical direction doc. Everything Coomander-related points at it.
2. **`docs/strategy/communication-policy.md`** — the channel-by-channel posture. Every comms feature touches this.
3. **`docs/strategy/features-brainstorm.md`** — the OG strategy memo. Useful for understanding *why* the insight epics exist, even though we're not building them yet.
4. **`AGENTS.md`** — Coomander's own operational guide.
5. **`~/Code/geology/web/node/lib/geology/`** — the agent infrastructure we're porting. Specifically the files listed in `#151`'s acceptance criteria. Don't reinvent; literal-port.
6. **`~/Code/geology/AGENTS.md`** § "Agent ping loop (Geo, #13)" and § "Inbound Telegram reply -> carve (#33)" — operational lore for the agent pattern. Specifically the TOML gotcha at the bottom of that section.

---

## 3. Operator-only steps (Mark must do these — no agent can)

These are the human gates that block implementation. None of them are technical, all of them are quick.

### 3.1 Set the wrangler secrets

The Telegram bot token (`8641207048:AAGMERWKRZ...`) was provided 2026-06-04. It's kept out of git for obvious reasons; it lives in Mark's password manager.

```bash
cd /Users/marknutter/Code/coomander/node
npx wrangler secret put MADDIE_TELEGRAM_BOT_TOKEN
# paste the token when prompted

openssl rand -hex 32 | npx wrangler secret put COOMANDER_RUN_SECRET
# generates and sets the cron auth secret in one shot
```

These are the production secrets. For dev, the same names go in `node/.env.local` (gitignored).

### 3.2 Set up the Telegram bot webhook

Once we have a deployed URL (after the first PR ships and deploys), point the bot's webhook at the inbound endpoint:

```bash
curl -X POST "https://api.telegram.org/bot${MADDIE_TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://coomander.com/api/coomander/webhook"}'
```

For dev testing, you can point it at the tailnet URL instead (e.g. `https://coomander.<tailnet>.ts.net/api/coomander/webhook`) — works fine because the tailnet has real HTTPS.

### 3.3 Confirm Mark's Telegram chat_id is on the user row

The user row in the dev DB needs `telegram_chat_id = "5393209237"` and `coomander_enabled = true` to receive pings. The first PR can do this via a manual SQL exec or a dev-only seed script.

---

## 4. Promote the project to Gitflow (Step 1)

Per Mark's global rules: substantial new vertical, work shouldn't ship to `main` until it's been gated on real config. This is the time.

The procedure is documented in `~/.claude/rules/git-workflow.md` § "Creating a `develop` branch". Concretely:

```bash
cd /Users/marknutter/Code/coomander
git checkout main
git pull
git checkout -b develop
git push -u origin develop

# Try to apply branch protection on main. This may fail with 403 on free private repos.
gh api -X PUT "repos/marknutter/coomander/branches/main/protection" \
  -f required_status_checks=null \
  -f enforce_admins=false \
  -f required_pull_request_reviews=null \
  -f restrictions=null \
  -F required_linear_history=true \
  -F allow_force_pushes=false \
  -F allow_deletions=false \
  2>&1 || echo "Branch protection skipped (likely free private repo)"
```

If protection is rejected: log a one-line note, move on. The workflow is Gitflow-by-convention not Gitflow-enforced.

**After this**: every feature branch for Coomander work targets `develop`, not `main`. Releases happen via `develop → main` PR cut by Mark when a milestone is ready.

---

## 5. Verify the dev environment (Step 2)

Coomander already has the Docker + Caddy+Tailscale sidecar pattern from `~/Code/geology`. The compose file is at `docker-compose.yml` at the repo root. **Do not rewrite this — it works.** The sidecar joins the tailnet as `coomander` and provisions a real HTTPS cert via Tailscale ACME, which is required because iOS Safari refuses plain HTTP on `*.ts.net`.

### 5.1 Verify it starts

```bash
cd /Users/marknutter/Code/coomander
docker compose up -d
docker compose logs -f caddy-dev | head -40
docker compose logs -f app-dev | head -40
```

You should see:
- `caddy-dev` join the tailnet and provision a TLS cert (look for "got new ALPN cert")
- `app-dev` start Next.js on port 3000 (inside the caddy-dev netns)

**Reachable at:**
- `http://localhost:3005` (host port mapped by the sidecar)
- `https://coomander.<tailnet>.ts.net` (real HTTPS, works from Mark's phone)

### 5.2 If the sidecar doesn't start

The most likely culprit is missing `TS_AUTHKEY`. Mark needs an auth key from https://login.tailscale.com/admin/settings/keys and it goes in `node/.env.local`:

```
TS_AUTHKEY=tskey-auth-...
TS_HOSTNAME=coomander
DEV_PORT=3005
```

The compose file already handles the OrbStack proxy bypass (env vars are set in the caddy-dev service block) — that fix landed via #120 after a duplicate-device-registration issue with OrbStack's HTTP proxy. Don't strip those env settings.

### 5.3 If the app doesn't load

Check the Next.js dev server's `allowedDevOrigins` in `node/next.config.ts` — must include `*.ts.net` for the tailnet URL to render properly. Without it, HMR silently fails and React hydration breaks with `ERR_INVALID_HTTP_RESPONSE`.

Check Better Auth's `trustedOrigins` — must include the tailnet URL AND keep `localhost:3005` trusted in dev so localhost login still works.

### 5.4 Smoke test

Sign in at `https://coomander.<tailnet>.ts.net` with the dev seed credentials (admin@example.com / password if that's still the seeded admin; check `node/scripts/seed.ts`). Navigate to `/app`. The dashboard should render with the Insights card. If it does, the environment is good.

---

## 6. First milestone — "Coomander says hello" (Step 3)

This is the implementation work. Scope deliberately tight: prove the architecture, defer everything else.

### 6.1 Definition of done

When this milestone is complete:

1. A new branch `151-coomander-says-hello` is opened against `develop`, scoped to a deliberate subset of #151's acceptance criteria (NOT all of it).
2. Database has a `coomander_settings` row and a `coomander_message_log` row populated for Mark's user (via migration + seed update).
3. The `/api/coomander/run` endpoint exists, is gated by `x-agent-secret`, and when hit fires a single placeholder message to `MADDIE_TELEGRAM_CHAT_ID` ("Coomander online — this is a test ping. The infra works.").
4. The `custom-worker.ts` `scheduled()` handler exists and is wired to a single test cron trigger.
5. `wrangler.toml` is updated with the test cron trigger and the TOML structure is validated by `wrangler deploy --dry-run`.
6. A draft PR is open against `develop` with the changes.
7. Mark verifies a manual run via `curl POST /api/coomander/run -H 'x-agent-secret: ...'` lands on his Telegram from the dev environment.

### 6.2 What's NOT in this milestone (and why)

- **Inbound webhook** — defer to milestone 2. We can hand-test the outbound first.
- **Tool-use classifier** — needs the domain model from #152. Defer.
- **Dedup table** — only matters for inbound. Defer.
- **planPing decision logic** — for this milestone, ping is unconditional (good for testing). Logic lands once we have day_state data to read.
- **Persona prompt content** — placeholder string is fine. Real persona lands in #153.
- **Indefinite chat-log retention** — the table schema is part of milestone 1, but only writes happen. Real consumption lands in later milestones.

### 6.3 Concrete file plan

| Path | Action |
|---|---|
| `node/lib/coomander/telegram.ts` | New. Wrap `https://api.telegram.org/bot$TOKEN/sendMessage`. |
| `node/lib/coomander/usage.ts` | New. Skeleton — just an insert helper for `coomander_usage`. |
| `node/lib/schema.ts` | Edit. Add `coomanderSettings`, `coomanderMessageLog`, `coomanderUsage`, `coomanderDayState`, `coomanderDedup`; extend `user` with `telegramChatId`, `coomanderEnabled`. |
| `node/migrations/0XX_coomander_infra.sql` | New. Drizzle-generated migration. |
| `node/app/api/coomander/run/route.ts` | New. Secret-gated POST. Iterates users with `coomanderEnabled = true`, calls Telegram outbound, logs to message_log. |
| `node/custom-worker.ts` | Edit (or create — check if it exists). Wrap `.open-next/worker.js` with a `scheduled()` handler. |
| `node/wrangler.toml` | Edit. Add `[triggers] crons = ["*/10 * * * *"]` for testing (rapid iteration) — will lower to real cadence later. |
| `node/.env.example` | Edit. Document `MADDIE_TELEGRAM_BOT_TOKEN`, `COOMANDER_RUN_SECRET`, and the new TS_* vars if not already there. |
| `node/scripts/seed.ts` | Edit. Add `telegramChatId = "5393209237"` and `coomanderEnabled = true` to the dev admin user. |

### 6.4 Acceptance criteria checklist (the contract)

Open #151 in the issue tracker and start checking these off via `gh issue edit` as the work progresses. The stop-hook in Claude Code will block session-end if any remain unchecked when the branch name matches the issue number.

For milestone 1 specifically, **only these subset items count**:

- [ ] `node/lib/coomander/telegram.ts` ported (outbound only — `sendMessage`)
- [ ] Schema additions for `coomander_settings`, `coomander_message_log`, `coomander_usage`, `coomander_day_state`, `coomander_dedup`, user-table extensions
- [ ] Migration applies cleanly
- [ ] `coomander_message_log` has no-TTL comment in schema
- [ ] `POST /api/coomander/run` exists, secret-gated, fires Telegram outbound, logs both to `coomander_message_log`
- [ ] `custom-worker.ts` extended with `scheduled()` handler (single test cron)
- [ ] `wrangler.toml` validated by `wrangler deploy --dry-run`
- [ ] `.env.example` documents the new vars
- [ ] Mark verifies end-to-end via curl from dev

The rest of #151's checklist (inbound webhook, full tool-use classifier, dedup write-path, planPing logic, nag presets, ping_times overrides) is **explicitly deferred to milestone 2**.

---

## 7. The post-MVP roadmap (after milestone 1)

For reference. Don't try to compress these into one session.

| Milestone | Scope | Epics involved | What you can do at the end |
|---|---|---|---|
| 1. Hello | Outbound only | partial #151 | Coomander pings Mark on cron |
| 2. Two-way | Inbound webhook + dedup + placeholder classifier | rest of #151 | Mark can reply "hi"; it's classified + logged |
| 3. Domain | Pillars, beats, drops, content states, procurement, today model | #152 | There's a real ops state for Coomander to read |
| 4. Real playbook | Seeded defaults, OF prohibitions, real persona prompts | #153 | First *useful* daily ping with real OF content |
| 5. Per-shot review | Reuse vision pipeline for clip checks | #155 (Ops E) | Mark sends a clip in TG, gets a quick read back |
| 6. Weekly review | Sunday recap + drift questions | #154 | Coomander acts like a real weekly check-in manager |
| 7. Hot requests | VIP interrupt queue + nag-gating | #156 (Ops G) | Time-sensitive requests cut through cadence |
| 8. Fan-chat assist | Script generation + response drafts | #157 (Ops H) | Manager Brief surfaces creator state for human chatters |

Then the insight epics (#146–#149) start filling the analysis side. Then Manager Brief (#145) starts orchestrating across both sides.

**Each milestone is its own session.** Per Mark's session-discipline rules, don't chain. Land the milestone, end the session, start fresh.

---

## 8. Issue reference table (the contract surfaces)

| # | Title | Status | Notes |
|---|---|---|---|
| #150 | Umbrella: Coomander | OPEN | Read first |
| #151 | [Ops A] Agent infra port | OPEN | Milestone 1 + 2 |
| #152 | [Ops B] Domain model | OPEN | Milestone 3 |
| #153 | [Ops C] V1 playbook | OPEN | Milestone 4 |
| #154 | [Ops D] Weekly review | OPEN | Milestone 6 |
| #155 | [Ops E] Per-shot review | OPEN | Milestone 5 |
| #156 | [Ops G] Hot-request queue | OPEN | Milestone 7 |
| #157 | [Ops H] Fan-chat assist | OPEN | Milestone 8 |
| #146 | Next-Post Predictor | OPEN | Post-Coomander MVP |
| #147 | Top-Performer Cloner | OPEN | Post-Coomander MVP |
| #148 | Audience-to-Content Fit | OPEN | Post-Coomander MVP |
| #149 | Caption + Spoken-Hook Co-writer | OPEN | Post-Coomander MVP. Blocks #157. |
| #145 | Manager Brief | OPEN | Cross-cutting orchestrator. Lands once Coomander has signal to consume. |
| #91, #92, #93, #94 | Rewritten analytics epics | OPEN | Separate insight track. Not blocking Coomander. |

---

## 9. Known gotchas (read before debugging)

### 9.1 `build:cf` does not re-run `next build`

Per geology's hard-learned lesson: if you change Next.js code, run `npm run build:cf` first, then `npm run deploy:cf`. Skipping the build step ships a stale `.open-next` bundle.

### 9.2 The `prebuild` step (next-openapi-gen) OOMs

It's disabled in `package.json` by default (look at the script — there's a `prebuild` key but it might be commented or rewritten). If you re-enable it, expect SIGABRT on large SDK type trees (Anthropic SDK, Drizzle). Run `npm run generate:openapi` manually when you need `/api-docs` to refresh.

### 9.3 Don't build inside the Docker container

The dev container's `node_modules` has React deduplicated in a way that breaks the `/_global-error` prerender ("useContext null"). Always run `npm run build:cf` on the **host**, not in the container.

### 9.4 wrangler.toml top-level scalars

Per geology's AGENTS.md and #151's spec: keep all top-level scalars (`name`, `main`, `compatibility_*`, `assets`, `routes`) ABOVE any `[table]` header. A `[triggers]` or `[vars]` block placed too early silently absorbs the scalars that follow, and the deploy loses `compatibility_flags` etc. Validate with `npx wrangler deploy --dry-run` after every wrangler.toml edit.

### 9.5 `.env.local` bakes into the prod bundle

Per geology gotcha #7: `next build` reads `.env.local` and OpenNext writes the resolved values into `.open-next/cloudflare/next-env.mjs`. Dev-only flags left in `.env.local` ship to prod. Specifically watch for `GEOLOGY_TELEGRAM_DISABLED`-style toggles — if you add one for Coomander (e.g., `COOMANDER_DISABLED`), key it off `NODE_ENV` in code instead, OR put dev overrides in `.env.development` (not loaded by production build).

Sanity check after a build: `grep -o '"COOMANDER_[^,}]*' .open-next/cloudflare/next-env.mjs`.

### 9.6 `docker compose down` then `npm run build:cf` then `docker compose up` cycle

If you run `build:cf` on the host while the dev container is up, the host build writes a production `.next` into the bind-mounted dir. The dev container then reads prod manifests and 404s every dynamic route. Always `rm -rf node/.next` after a host build and before restarting the dev container.

### 9.7 OrbStack proxy hang

If `docker pull` hangs silently under OrbStack, suspect `proxyproxy.orb.internal:8305` returning 502. `orbctl update` is the fast fix. (Documented in MEMORY.md.)

---

## 10. Where to find help

- **Coomander project guide**: `/Users/marknutter/Code/coomander/AGENTS.md`
- **Geology reference**: `/Users/marknutter/Code/geology/AGENTS.md` and `/Users/marknutter/Code/geology/web/AGENTS.md`
- **Strategy memos**: `/Users/marknutter/Code/coomander/docs/strategy/*.md`
- **Mark's global rules**: `/Users/marknutter/.claude/rules/*.md` (router at `~/.claude/CLAUDE.md`)
- **Per-project memory**: `/Users/marknutter/.claude/projects/-Users-marknutter-Code-coomander/memory/MEMORY.md`

---

## 11. Reminder on session discipline

Per Mark's standing rules: **one session, one task.** This brief covers the full Coomander arc, but each milestone is its own session. Don't try to land milestones 1 and 2 in the same conversation. Compaction risk is real and will degrade later work.

When you finish milestone 1:
1. Open the PR against `develop` with a clear description.
2. Push the branch and let Mark review.
3. **Do not auto-merge.** Wait for Mark's explicit go.
4. End the session.
5. Start a fresh session for milestone 2.

---

## 12. First moves for the next agent (or Mark)

In order:

1. Read `coomander-direction.md` and `communication-policy.md`.
2. Glance at this brief's gotchas section.
3. Mark does the operator steps (§3) — set secrets, point Telegram webhook (the webhook URL can wait until after milestone 1 deploys).
4. Promote to Gitflow (§4).
5. Verify dev environment (§5).
6. Start milestone 1 (§6). Create branch `151-coomander-says-hello`. Open draft PR early so the work is visible.
7. Land milestone 1. End session.

Good luck.
