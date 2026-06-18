# Recon: migrating Coomander agent functionality to Cloudflare Agents (`apps/agents`)

Status: READ-ONLY recon. Nothing in the repo was changed by this document except
this file. Written for **Phase 2b**, which runs **after** the monorepo migration
(Phase 2a) where `node/` becomes `apps/web` and shared logic moves to
`packages/core`. All paths below assume that layout.

Reference implementation: `~/Code/geology/apps/agents` (the AppSeed "agents" epic
ported into Geology, issue #203 / template epic #388). Read in full for this doc.

---

## 0. TL;DR — the single most important finding

**Geology and Coomander have opposite agent shapes.** Geology's `apps/agents`
exists to host a **live, per-user, hibernating WebSocket chat** (`AppAgent`
Durable Object): streaming tokens, tool-use loop, scheduled wakes, proactive
delivery. Coomander has **no live chat socket** — its "agent" is:

1. **Cron-driven outbound pings** (`runAgentPing` per slot, fired by the
   OpenNext `custom-worker.ts scheduled()` handler), and
2. **Telegram inbound tool-use classification** (`handleInbound` → Anthropic
   tool-use → DB writes), and
3. **In-app chat** that is plain **request/response JSON** (`POST
   /api/coomander/chat` → `handleChatTurn`), NOT a WebSocket.

Crucially, **in Geology the cron stays in `apps/web`** (custom-worker
`scheduled()` → `*/15 * * * *`), exactly like Coomander does today. The agents
Worker in Geology uses **only DO alarms** (`schedule_followup`), never Cloudflare
cron triggers. So a faithful port does **not** move Coomander's cron into
`apps/agents`.

**Therefore the honest recommendation is: Phase 2b is mostly NOT a like-for-like
geology port.** The geology `AppAgent` DO earns its keep because of the
streaming WebSocket. Coomander has no such surface today. Two viable scopes:

- **Scope A (minimal / recommended first):** Do NOT create a DO/WebSocket agent
  yet. Keep cron in `apps/web` and Telegram inbound + in-app chat in `apps/web`.
  Only carve out a thin `apps/agents` Worker if/when Coomander wants (a)
  **streaming** in-app chat over WebSocket, or (b) **self-scheduled follow-ups**
  ("remind me in 2h") that a fixed cadence cron can't express.
- **Scope B (full geology parity):** Stand up `apps/agents` with an `AppAgent`
  Durable Object, convert the in-app chat (`/api/coomander/chat`) to the
  WebSocket transport, and add `schedule_followup`/proactive delivery. The
  fixed-cadence cron still stays in `apps/web`.

The rest of this doc specifies **Scope B** (so the work is fully scoped if the
user wants parity), and flags at each step what Scope A omits.

---

## 1. What `apps/agents` should contain (Scope B)

Mirror geology's structure 1:1; the only product-specific files are the chat
loop's web-API contract and the tool wiring.

```
apps/agents/
  package.json            # @coomander/agents — deps: agents, @anthropic-ai/sdk
  wrangler.toml           # AppAgent DO binding + migration; prod env w/ WEB svc binding
  tsconfig.json           # extends ../../tsconfig.base.json
  vitest.config.mts       # cloudflareTest() pool → workerd/miniflare
  Dockerfile.dev          # node:22-slim + ca-certificates; build context = repo root
  .dev.vars.example       # ANTHROPIC_API_KEY, AGENTS_INTERNAL_SECRET, optional CHAT_*
  scripts/dev.sh          # wrangler dev --port 8788, --env-file from web/.env(.local)+.dev.vars
  src/
    index.ts              # AppAgent DO class + worker fetch gate (auth → routeAgentRequest)
    chat.ts               # per-turn loop: context fetch → Anthropic stream → tool loop → persist
    chat-config.ts        # fetchAgentContext() + fallbacks + stripTags
    auth.ts               # validateSessionCookie → GET /api/auth/get-session (cookie fwd)
    persistence.ts        # appendMessage / appendMessageInternal / hydrateMessages via web API
    tools.ts              # makeCoomanderTool (web-proxied) + makeScheduleFollowupTool (DO-side)
    types.ts              # AgentTool / ToolContext
    web-api.ts            # callAsUser (cookie) + callInternal (x-agents-internal-secret)
  test/                   # vitest-pool-workers tests (see §6)
```

### The Agent class (`AppAgent`)

Identical pattern to geology (`apps/agents/src/index.ts`):

- `export class AppAgent extends Agent<Env, AppAgentState>` from the `agents`
  package.
- **One DO instance per user; the instance name IS the validated Better Auth
  user id.** The worker-level `fetch` handler validates the session cookie, then
  `rewriteAgentPath()` forces the instance name to `user.id` (client-supplied
  names are ignored). Reaching DO code therefore means "authenticated".
- Per-connection auth `{cookie, validatedAt}` is stored in the **hibernation-safe
  WebSocket attachment** via `connection.setState()` — NOT an in-memory field
  (onConnect does not re-run on hibernation wake). Re-validate at most every 60s
  on `onMessage`.
- `onMessage` stays thin: revalidate → `parseClientFrame` → delegate to
  `handleChatTurn` in `chat.ts`.
- Extension surface to keep product logic OUT of the core file:
  `registerTool(tool)`, override `onScheduledWakeHook`, override
  `onUndeliverable`. Coomander's `onUndeliverable` should deliver over **Telegram**
  (Coomander's native channel) rather than the in-app NotificationBell — this is
  the one substantive product divergence from geology's default.
- Built-in worker-side tool: `schedule_followup` (manipulates the DO's own
  `this.schedule(...)` alarm). Domain tools (`log_drop`, `advance_content_state`,
  etc.) are **NOT** defined in the Worker — they come from the web app per turn
  (see §5) and proxy back through `POST /api/coomander/agent-tool`.

**Scope A omits all of `src/` except possibly a future thin file.**

---

## 2. Exact wrangler config (`apps/agents/wrangler.toml`)

Based on `~/Code/geology/apps/agents/wrangler.toml`. Coomander adaptations:
worker name, prod route host, the `WEB` service binding's `service` value (= the
app worker's name, `coomander`), and prod origin.

```toml
name = "coomander-agents"
main = "src/index.ts"
compatibility_date = "2026-05-01"          # NOTE: newer than apps/web's 2024-09-23 (see §6 risk)
compatibility_flags = ["nodejs_compat"]

[vars]
WEB_ORIGIN = "http://127.0.0.1:3000"        # dev: next dev on the shared netns

# Each Agent class is a Durable Object: one binding + one SQLite migration entry.
[[durable_objects.bindings]]
name = "AppAgent"
class_name = "AppAgent"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["AppAgent"]

# ── Production (operator-gated; route stays COMMENTED until go-live) ─────────
[env.production]
name = "coomander-agents"

# Uncomment to go live (more-specific than the app worker's custom_domain route):
# routes = [
#   { pattern = "coomander.com/agents/*", zone_name = "coomander.com" },
# ]

[env.production.vars]
WEB_ORIGIN = "https://coomander.com"

# Service binding agents → app worker (internal, no public hop). `service` is the
# app worker's `name` from apps/web/wrangler.toml (= "coomander").
[[env.production.services]]
binding = "WEB"
service = "coomander"

# Named envs do NOT inherit bindings/migrations — redeclare for production.
[[env.production.durable_objects.bindings]]
name = "AppAgent"
class_name = "AppAgent"

[[env.production.migrations]]
tag = "v1"
new_sqlite_classes = ["AppAgent"]
```

Notes:
- **No `[triggers]` / crons here.** Coomander's fixed-cadence cron stays in
  `apps/web/custom-worker.ts` (unchanged). The agents Worker only schedules via
  DO alarms.
- **No D1/R2/KV bindings on the agents Worker.** It never touches the DB
  directly — all reads/writes go through the web API (§5). This is the AppSeed
  data-boundary decision and it sidesteps the D1-from-DO problems (§6).

---

## 3. Dependencies + exact versions

From `~/Code/geology/apps/agents/package.json` (match exactly to stay on a
known-good combo):

`apps/agents/package.json`:
```jsonc
{
  "name": "@coomander/agents",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "sh scripts/dev.sh",
    "deploy": "wrangler deploy --env production",
    "deploy:dry-run": "wrangler deploy --env production --dry-run --outdir dist",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@anthropic-ai/sdk": "0.100.1",          // ⚠ apps/web is on ^0.80.0 — see §6
    "agents": "0.14.5"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "0.16.13",
    "@cloudflare/workers-types": "4.20260608.1",
    "typescript": "^5",
    "vitest": "4.1.8",                        // ⚠ apps/web is on ^4.0.18 — close, fine
    "wrangler": "4.98.0"
  }
}
```

Per dependency-management rules: pin exact versions, check release age, run
`npm audit` before committing. `agents@0.14.5` and `@anthropic-ai/sdk@0.100.1`
are the geology-proven versions and are well past the 48-hour window.

**Anthropic SDK version skew is the one to watch:** apps/web uses
`@anthropic-ai/sdk@^0.80.0`; geology's agents Worker uses `0.100.1`. The two
workspaces bundle independently so they can differ, but if `packages/core` ever
exports Anthropic types, align them. Recommend bumping apps/web to `0.100.1` in a
separate, isolated dependency PR (changelog review + audit) so both match.

---

## 4. What moves `apps/web/` → `apps/agents` vs stays — file by file

Coomander's domain logic is large (`lib/coomander/*` is ~26 files) and is **pure
product logic that must NOT move into the Worker.** The Worker cannot import from
apps/web; the data boundary is the web API. So the rule is:

> **Almost nothing moves. The Worker is a thin transport that calls back into
> apps/web routes.** New web-side routes are ADDED so the Worker has a contract
> to call.

### STAYS in `apps/web` (unchanged or lightly touched)

| File | Why it stays |
|---|---|
| `lib/coomander/agent.ts` (`runAgentPing`, `planPing`, `renderContext`) | Cron-driven outbound. Stays; cron stays in custom-worker. |
| `lib/coomander/agentPrompts.ts` | Prompt source of truth. Stays; Worker fetches rendered prompt via agent-context (§5). |
| `lib/coomander/inbound.ts` (`tools`, `resolveToolUse`, `executeAction`, `loadContext`) | Domain tool vocabulary + executors. Stays; Worker proxies to it. |
| `lib/coomander/coomanderChat.ts` (`handleChatTurn`, `recentTurns`) | The in-app chat brain. **In Scope B the transport changes** (WS), but the *logic* stays in web and is invoked via agent-context + agent-tool. |
| `lib/coomander/scheduling.ts`, `weeklyReview.ts`, `todayModel.ts`, `homeBrief.ts`, `beats.ts`, `drops.ts`, `procurement.ts`, `contentStates.ts`, `consistency.ts`, `ramp.ts`, `pillars.ts`, `settings.ts`, `seed-defaults.ts`, `usage.ts`, `wallProhibitions.ts`, `autoDrop.ts`, `linkCodes.ts`, `telegramDedup.ts`, `coomanderMessages.ts` | All pure product/domain/DB logic. Never moves. |
| `lib/coomander/telegram.ts` (`sendTelegram`) | Outbound channel. Stays in web (cron + inbound use it). The Worker's `onUndeliverable` calls a web route that uses this. |
| `custom-worker.ts` (cron `scheduled()`) | **Stays. Cron does not move to agents.** |
| `app/api/coomander/run`, `weekly-review`, `webhook`, `home`, `today`, `chat` (GET), etc. | Existing surface. `webhook` (Telegram inbound) + `run` (cron) stay entirely. |
| `lib/chat-engine.ts`, `lib/chat-config.ts`, `lib/chat-tags.ts` | The generic template SSE chat (`/api/chat`). Keep as the flag-off fallback (geology kept its SSE path). Not coomander-specific. |

### MOVES to / is CREATED in `apps/agents`

| File | Origin |
|---|---|
| `apps/agents/src/*` (8 files) | New, ported from geology, renamed Geo→Coomander; the chat loop's web routes point at `/api/coomander/*`. |
| Worker config/test/docker (§1) | New, from geology. |

### NEW web-side glue ADDED in `apps/web` (the contract the Worker calls)

| New file | Mirrors geology |
|---|---|
| `app/api/coomander/agent-context/route.ts` | `agent-context` — returns `{entitled, model, maxTokens, systemPrompt, tools}` built from `coomanderSystem()` + `getTodayModel()` + `inbound.tools()`. Source of truth stays in web. |
| `app/api/coomander/agent-tool/route.ts` | `agent-tool` — executes one tool via `resolveToolUse`+`executeAction` (the exact path `handleChatTurn` uses), returns `{action, note}`. |
| `app/api/internal/conversation-message/route.ts` | internal append (no cookie; `x-agents-internal-secret`) → `appendMessage(userId, "outbound", …)` into `coomander_message_log`. |
| `app/api/internal/notifications/route.ts` OR a Telegram variant | scheduled-wake fallback. **Coomander variant: deliver over Telegram** (`sendTelegram`) since that's its channel, not in-app notifications. |
| `lib/use-agent-chat.ts` + `components/agent-chat-bridge.tsx` | Client WS hook (`useAgent` from `agents/react`) + lazy `next/dynamic({ssr:false})` bridge, mounted only when a feature flag is on. |

**Scope A:** none of the agents `src/`, none of the new web routes except none
needed — Scope A is "do nothing structural, keep flat web." Add `apps/agents`
only when a streaming/self-scheduling need is real.

---

## 5. Integration pattern — how web + Telegram + cron reach the agent

This is the exact geology contract (see `apps/agents/src/{auth,web-api,
persistence,chat-config,tools}.ts` and `apps/web/{lib/use-agent-chat.ts,
components/agent-chat-bridge.tsx, app/api/geology/agent-context, agent-tool,
app/api/internal/*}`).

### 5a. In-app chat (browser → agent, Scope B only)

1. Browser holds a same-origin WebSocket to `/agents/app-agent/<name>` via
   `useAgent({ agent: "AppAgent", name: "me", enabled: flagOn })`. **Caddy
   routes `/agents/*` → the agents Worker** in dev, so the Better Auth cookie
   flows automatically. The literal `name` is cosmetic — the Worker re-routes by
   validated session user id.
2. The bridge component is loaded only when the `coomander-agents-chat` flag is
   ON, so flag-off users never bundle `agents/react`/`partysocket`. The existing
   JSON `POST /api/coomander/chat` is the flag-off fallback.
3. Per user turn the Worker `chat.ts`:
   - `GET /api/coomander/agent-context` (cookie) → rendered system prompt + model
     + tools + entitlement.
   - streams the Anthropic call, runs the tool-use loop; each domain tool call →
     `POST /api/coomander/agent-tool` (cookie) → returns `{action, note}`.
   - persists user + assistant turns via `POST /api/coomander/messages` (cookie)
     into the SAME `coomander_message_log` thread, so web + Telegram + agent are
     one continuous conversation.
4. Frames: `conversation` / `token` / `done` / `error` / `proactive`.

### 5b. Telegram inbound (webhook → stays in apps/web)

**No change.** `app/api/coomander/webhook/route.ts` → `handleInbound` continues
to run inside apps/web. There is no reason to route Telegram through the DO: the
webhook is request/response with no streaming and no session. (Geology kept its
Telegram inbound web-side too.) If self-scheduled follow-ups from Telegram are
later desired, the webhook handler could call the DO's `/schedule` control route
over the `WEB`→agents direction — but that's a future enhancement, not Phase 2b.

### 5c. Cron (Cloudflare trigger → stays in apps/web)

**No change.** `custom-worker.ts scheduled()` → `POST /api/coomander/run` and
`/weekly-review` with `x-agent-secret`. This is geology's exact pattern (its cron
also lives in apps/web's custom-worker). The DO's `schedule_followup` is for
*ad-hoc, user-requested* reminders only, not the fixed cadence.

### 5d. Scheduled wake (DO alarm → web, Scope B only)

DO alarm fires `onScheduledWake` → persist the reminder via `POST
/api/internal/conversation-message` (`x-agents-internal-secret`) → deliver: push
over a live WS if connected, else fall back to **Telegram** via an internal
route. Two auth modes on the web side: cookie (`callAsUser`) for live turns,
shared secret (`callInternal`) for wakes.

---

## 6. Migration risks

1. **D1 access from a Durable Object — AVOIDED by design.** The agents Worker
   has **no D1 binding**; it reads/writes only through apps/web routes. This is
   the single biggest reason the geology pattern is safe and should be preserved
   verbatim. Do NOT give `apps/agents` a `[[d1_databases]]` binding "for
   convenience" — it reintroduces the dual-write hazard and the
   `getRawDb()`-is-sync / D1-is-async mismatch that `lib/db.ts` already warns
   about.

2. **Durable Object migration classes.** `[[migrations]] tag="v1"
   new_sqlite_classes=["AppAgent"]` must be declared in BOTH the top-level env
   and `[env.production]` (named envs don't inherit). **Never edit an existing
   migration tag** — add a new tag when introducing another agent class. Getting
   this wrong bricks the DO on deploy.

3. **Cron placement.** Resist moving cron into `apps/agents`. Coomander's cadence
   is fixed-UTC slots fanned out to all users — a stateless cron, not a per-user
   alarm. It belongs in the OpenNext custom-worker (where it is). DO alarms are
   per-instance and would require N instances awake on a schedule — wrong tool.

4. **The large existing `lib/coomander/*` codebase.** ~26 files of product logic.
   The temptation is to "move the agent into apps/agents." Don't. The Worker
   cannot import apps/web, and duplicating prompts/tools/executors would create a
   two-copy sync burden. The contract is: prompts + tools rendered/executed in
   web via `agent-context` / `agent-tool`; the Worker owns only transport + the
   tool-use loop + `schedule_followup`. Only `agentPrompts.ts`/`inbound.ts`
   *output* crosses the boundary, never the modules.

5. **Compatibility-date skew.** agents Worker uses `2026-05-01`; apps/web uses
   `2024-09-23`. Two separate workers, so this is allowed, but document it — a
   future reader will wonder. Don't blindly bump apps/web's date (it was pinned
   deliberately per the #287 audit).

6. **Anthropic SDK skew (0.80 vs 0.100).** See §3. Independent bundles tolerate
   it; align in a dedicated dep PR if `packages/core` ever shares Anthropic
   types. The chat loop's `messages.stream` + tool-use shapes are stable across
   this range, so functionally fine.

7. **Dual sqlite/pg/D1 setup.** `lib/db.ts` is dialect-aware (`isPg`/`isD1`).
   The agent's persistence routes (`/messages`, `/internal/*`,
   `agent-context`/`agent-tool`) must be **Drizzle-based**, not raw
   `getRawDb()`, or they 500 on D1 (this is geology's
   `2026-06-10-d1-raw-sql-conversion` lesson). Coomander's coomander routes
   already use `getDb()` (Drizzle) throughout — verified in `agent.ts`,
   `scheduling.ts`, `coomanderMessages` usage — so this is largely already
   satisfied; audit the new routes specifically.

8. **Tests run in a different harness.** apps/web uses plain vitest; apps/agents
   needs `@cloudflare/vitest-pool-workers` (`cloudflareTest()` plugin, NOT the
   removed `defineWorkersConfig`) so the DO + SQLite run in workerd/miniflare.
   Tests are written against the SPEC, not the implementation (per the
   testing-requirements rule and geology's test headers). Coverage to mirror:
   pure functions (`parseClientFrame`, `mergeAlternating`, `stripTags`), the auth
   gate (instance routed by session, not client name), hibernation-attachment
   auth, the chat loop control flow (entitlement gate, tool loop, persistence),
   and proactive-persist-then-deliver. Stub `fetch` (agent-context / messages /
   agent-tool / internal) and the Anthropic SDK; the account has no credits.

9. **Telegram-as-fallback divergence.** Geology's `onUndeliverable` writes an
   in-app notification; Coomander should deliver over Telegram. This is a
   deliberate product change, not a port bug — implement an internal Telegram
   route or reuse the existing send path behind the secret.

10. **Docker dev wiring.** The `agents-dev` compose service shares the Caddy
    sidecar netns (`network_mode: service:caddy-node-dev`), needs `tty:
    true`/`stdin_open: true` (wrangler dev hotkeys), `ca-certificates` in the
    image (workerd TLS to api.anthropic.com), and two named node_modules volumes
    so the bind mount doesn't shadow workspace-local wrangler. Caddy must route
    `/agents/*` → agents-dev:8788 and everything else → next dev:3000, or
    `/agents/*` is unreachable on localhost. Memory note: restart ONLY app-dev
    when Turbopack wedges, never the caddy/tailscale sidecar.

---

## 7. Can `appseed-sync` do part of this?

The skill explicitly covers it — the **"Agents worker boundary (June 2026)"**
note in `~/.claude/skills/appseed-sync/SKILL.md`. It correctly classifies
Coomander as **case (2): "Customized chat — adapt, don't drop in."** It says to
keep the project's chat config as the source of truth, mirror it into the
Worker, re-register domain tools through `registerTool(...)` (handlers call the
project's own API routes via `callAsUser`), and re-point persistence at the
agent's web-API path. It also flags the `2026-06-10-d1-raw-sql-conversion`
prerequisite.

**What appseed-sync CAN do:**
- Detect the agents epic via changelog entries and tell you which files exist
  upstream (`apps/agents/*`, the web glue, the internal routes, the compose
  service).
- Create the GH issue + branch and walk the file list.
- Apply the **mechanical, drop-in** parts: the Worker scaffolding
  (config/test/docker), `lib/use-agent-chat.ts` + `components/agent-chat-bridge`,
  the internal route skeletons, the compose `agents-dev` service, env additions.

**What MUST be hand-done (the skill itself says to adapt these):**
- Renaming Geo→Coomander throughout and pointing the chat loop at
  `/api/coomander/*` instead of `/api/geology/*`.
- Writing `agent-context` / `agent-tool` to render `coomanderSystem()` +
  `inbound.tools()` + `executeAction()` (Coomander's specific prompt/tools).
- The Telegram-as-fallback `onUndeliverable` divergence.
- The decision itself — Scope A vs Scope B (the skill assumes you want the WS
  chat; for Coomander that's a genuine product call, not a mechanical sync).
- A blocking PREREQUISITE the skill can't satisfy: **the monorepo migration
  (Phase 2a)**. appseed-sync's agents path assumes `apps/web` + workspaces
  already exist. Coomander is still flat (`node/`). `appseed-mobilize` /
  `appseed-create`'s monorepo layout must land first. **Do not run the agents
  sync against the flat `node/` tree.**

Net: appseed-sync is a useful accelerator for the scaffolding (~40%), but the
product-specific contract (prompt/tools rendering, Telegram fallback,
Geo→Coomander rename) and the scope decision are hand work.

---

## 8. Ordered task list — Phase 2b

> Hard gate: **Phase 2a (monorepo migration: `node/`→`apps/web`, `packages/core`,
> root workspace, single `docker-compose.yml`) MUST be complete first.** Every
> step below assumes `apps/web` exists.

1. **Decide scope (A vs B) with the user.** Scope B (WebSocket chat + DO) only if
   Coomander actually wants streaming in-app chat and/or user-requested
   ad-hoc reminders. If not, stop after step 2 — there is no agents Worker to
   build. (Pressure-test: today's in-app chat is short JSON replies; is
   streaming worth a second Worker?)
2. **Confirm cron + Telegram inbound STAY in `apps/web`.** No change to
   `custom-worker.ts`, `/api/coomander/run`, `/weekly-review`, `/webhook`. Record
   this explicitly so no one "ports the cron."
3. **(D1 audit, prerequisite for the new web routes)** Verify every Coomander
   route the agent will call uses Drizzle `getDb()`, never `getRawDb()`. Convert
   any raw-SQL stragglers BEFORE wiring the agent (the geology D1 lesson).
4. **Scaffold `apps/agents`** from geology: copy `package.json` (rename
   `@coomander/agents`, exact dep versions §3), `tsconfig.json`,
   `vitest.config.mts`, `wrangler.toml` (§2 values), `Dockerfile.dev`,
   `.dev.vars.example`, `scripts/dev.sh`. Add the workspace to the root
   `package.json` workspaces + delegating scripts. `npm install`; `npm audit`.
5. **Port `src/`** (8 files) from geology, renaming Geo→Coomander and pointing
   the web-API paths at `/api/coomander/agent-context`, `/api/coomander/agent-tool`,
   `/api/coomander/messages`, `/api/internal/*`. Keep auth/persistence/web-api
   verbatim (they're product-agnostic).
6. **Add the web-side contract routes in `apps/web`:**
   `app/api/coomander/agent-context/route.ts` (render `coomanderSystem` +
   `getTodayModel` + `inbound.tools()` + entitlement),
   `app/api/coomander/agent-tool/route.ts` (`resolveToolUse`+`executeAction` →
   `{action, note}`), `app/api/coomander/messages/route.ts` (cookie append into
   `coomander_message_log`), `app/api/internal/conversation-message/route.ts`,
   and the **Telegram** scheduled-wake fallback route.
7. **Customize `onUndeliverable`** in `AppAgent` to deliver over Telegram via the
   internal route (Coomander divergence from geology's in-app notification).
8. **Add the client glue in `apps/web`:** `lib/use-agent-chat.ts`,
   `components/agent-chat-bridge.tsx`, and a `coomander-agents-chat` feature flag.
   Wire a flag-gated branch in the in-app chat page; keep `POST
   /api/coomander/chat` (JSON) as the flag-off fallback.
9. **Env + secrets:** add `AGENTS_INTERNAL_SECRET` to BOTH `apps/web/.env.local`
   and `apps/agents/.dev.vars` (must match); document `ANTHROPIC_API_KEY` reuse;
   add all three to `.env.example` and the README env table. Prod:
   `wrangler secret put` on the agents Worker.
10. **Docker dev:** add the `agents-dev` service to the root `docker-compose.yml`
    (netns share, tty, two node_modules volumes); update Caddy to route
    `/agents/*` → agents-dev:8788.
11. **Tests (separate test subagent, vitest-pool-workers):** pure functions,
    auth-gate routing, hibernation-attachment auth, chat-loop control flow,
    proactive-persist-then-deliver. Stub fetch + Anthropic SDK. All green before
    PR.
12. **Local verify on iPhone Safari over the tailnet** (HTTPS) that the WS chat
    streams and reconnects, and that a `schedule_followup` reminder fires
    (miniflare alarm) and falls back to Telegram when no socket is open.
13. **Docs:** add `apps/web/content/docs/dev/agents.mdx` (architecture +
    subclassing + Coomander divergences) and a "Agents Worker" section in the
    Cloudflare deploy doc (two-Worker, operator-gated route, secrets). Update
    AGENTS.md/README.
14. **PR (do not auto-merge)** into `develop` if it exists else default branch;
    one PR + one QA issue per the per-epic memory note. Operator-gated prod route
    stays commented until go-live.
```
