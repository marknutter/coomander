# Dogfooding log — operating Coomander as Maddie's manager

Running the existing app as Maddie's manager (no new code) to validate the managed-service model and surface product friction. Newest findings on top.

## Setup state (2026-06-11)

Account `admin@example.com` on the **dev** app (`coomander.gate-cardassian.ts.net`):
- Coomander **enabled**; v1 playbook seeded (6 pillars / 11 beats); nag=tight, persona=light_companion.
- **No Telegram linked** (`telegramChatId` is null). **No Instagram connected.** Zero activity (0 drops / messages / content / day-state).

Seeded cadence: Reels 3 normal + 3 trial/day · OF Wall 5 captures/day (3d buffer) + themed batch · 1 IG Live/wk · 1 mass + 1 welcome PPV · procurement (invoices, gear, makeup, costumes).

## Session 2 (2026-06-16) — tried to run the first morning ping

**Set up:** created Maddie on **prod** (`coomander.com`) — user `QHH2PUeO2xuzufrUEecx7SJQiXnidzZy` (maddie@coomander.com), Coomander enabled, v1 playbook seeded (6 pillars / 11 beats) via the real signup → enable code path. Set `telegramChatId=5393209237` on the **dev** user.

**Result: the loop can't run yet — 3 hard blockers (all credential/setup, not code):**

1. **Anthropic API key is REVOKED.** The morning ping reaches generation then dies on `401 invalid x-api-key`; a bare `GET /v1/models` with the key in `.env.local` also 401s. Same key is in dev, the container, and prod. **This blocks the entire agent** (pings, in-app chat, weekly review all call Anthropic). → needs a fresh `ANTHROPIC_API_KEY` from the owner.
2. **Cloudflare OAuth token expired** (was valid only through 2026-06-11). Blocks all D1 writes (e.g. setting Maddie's `telegramChatId` on prod) and deploys — both wrangler CLI and the REST API return auth errors. → needs `npx wrangler login`.
3. **No in-app Telegram linking** (confirmed blocking). Setting `telegramChatId` requires direct DB access; on prod that needs Cloudflare creds. The managed model can't onboard a creator's comms channel through the product at all.

**What works:** prod signup + enable + cadence seed (app-level auth, no CF/Anthropic needed); dev DB writes (container); the run route correctly finds the recipient once `telegramChatId` is set; the Telegram webhook is healthy on prod.

**To go live (owner actions):** (a) provide a valid `ANTHROPIC_API_KEY`; (b) `npx wrangler login`. Then I set Maddie's prod `telegramChatId`, update the prod Anthropic secret, and the daily cron + reply loop run on their own.

## Session 2b (2026-06-16) — credentials fixed, loop one step from live

Owner supplied a fresh `ANTHROPIC_API_KEY` (validated, updated in `.env.local` + the prod secret) and re-ran `wrangler login`. Then on prod: set Maddie's `telegramChatId=5393209237`.

**Morning ping now GENERATES correctly** (Anthropic working) — real grounded message: *"Good morning, here's the board: a normal reel needs to go out today, your wall buffer is at zero so daily-vlog capture is urgent, and your welcome PPV window closes in 2 days with nothing sent yet…"* — good voice, grounded in the seeded cadence.

**But the Telegram SEND fails: `400 chat not found`.** @coomander_bot has never had a chat with the owner's Telegram, and a bot cannot message a user who hasn't initiated contact. → **Resolution: the creator must send `/start` (or any message) to @coomander_bot once.** That single action (a) lets the bot send to them, and (b) hits the prod webhook → `resolveUserByChatId(5393209237)` → Maddie → Coomander responds — i.e. it links both directions.

**This is the no-in-app-Telegram-linking gap in practice:** onboarding a creator's comms requires them to manually find + /start the bot, with nothing in the product guiding it or capturing the chat_id. A real link flow (deep-link to the bot with a one-time code, webhook captures + binds the chat_id) is the fix.

## Session 2c (2026-06-16) — LOOP IS LIVE ✅

Owner sent `/start` to @coomander_bot → prod webhook recognized the chat as Maddie → Coomander replied (inbound works). Re-fired the morning ping: **`recipients:1, sent:true`** — Coomander's grounded daily board landed on Telegram. Full two-way loop operational on prod (outbound generate→send + inbound classify→log→respond). The tight-preset cron will now ping Maddie automatically (morning/midday/check/evening + Sunday weekly review).

**Still open for "real" management:** Instagram not connected (no auto-drops/insights); cadence is still generic v1 defaults (tune to Maddie's reality); and the no-in-app-Telegram-linking gap remains the top build item.

## Session 2d (2026-06-16) — 🔴 CORE LOOP BUG: replies don't get logged

Played Maddie over Telegram: *"posted 2 gym reels, shot 4 wall clips, sent the welcome PPV"* → Coomander asked "Normal or Trial?" → *"normal reels"* → asked again. **Net: `drops = 0`.** Every inbound classified as `need_clarification`; nothing was ever recorded. The conversation/persona works; the actual domain logging does not.

Root cause (`lib/coomander/inbound.ts:314`): the inbound classifier calls Anthropic with `messages: [{role:"user", content: text}]` — **only the current message, no conversation history.** Two bugs fall out:
1. **Stateless → clarification loops never resolve.** The answer "normal reels" is classified with no memory of "posted 2 gym reels," so it can't become a `log_drop`. (The *in-app* chat path `handleChatTurn` DOES inject recent-thread context — the two paths diverged.)
2. **One tool call per message** (`tool_choice: any`) → compound reports ("posted X, shot Y, sent Z") can't log multiple drops; they punt to `need_clarification`.

**Impact:** the headline value prop ("tell Coomander in plain language what you shipped and it logs it") is non-functional over Telegram for realistic messages. Highest-priority fix.

**Proposed fix:** (A) inject recent thread into the inbound classifier (parity with `handleChatTurn` via `recentTurns`) so clarification answers resolve — small, high-impact. (B) support multiple actions per message (loop over tool_use blocks) — larger, separate.

## Session 2e (2026-06-16) — ✅ Fix A verified working

Deployed Fix A to prod (worker `30aff6c3`). Owner re-tested as Maddie:
- *"posted a normal reel"* → `log_drop` → "Logged. Counted toward Normal reel." ✅
- *"trial reels"* (a clarification answer) → `log_drop` → "Logged. Counted toward Trial reel." ✅ — the exact path that produced 0 drops before now resolves.
- **2 drops logged** on prod. The core "tell Coomander what you shipped → it logs it" loop works over Telegram.

Remaining nuance for **Fix B**: *"posted 2 gym reels"* still asks Normal/Trial (fine), and quantity isn't honored (logs 1 drop, not 2); compound multi-item messages still need the multi-action change.

**Viewing surface:** the manager logs in at `coomander.com` as the seeded creator account (`maddie@coomander.com`) → `/app/cadence` shows beats with drops counted; `/app` shows the TodayModel brief. (No in-app Telegram linking still the top product gap.)

## Findings / friction

1. **No in-app way to link a creator's Telegram.** The onboarding "link Telegram" step is informational only — there's no link-code flow, so a manager onboarding a creator has to set `telegramChatId` directly in the DB. This is the #1 gap for the managed model: the manager can't connect the creator's comms channel through the product. (Surfaced when building #173; confirmed now in practice.)
2. **The bot webhook is single-target.** `@coomander_bot` can point at exactly one URL (currently prod `coomander.com`). To dogfood the full two-way loop on dev, the webhook has to be repointed to the dev tailnet — you can't run the live agent loop on dev and prod at once with one bot.
3. **Instagram not connected** → auto-drops + insights are inert until the creator's real IG is OAuth'd. The cadence/agent/chat loop still works fully via manual drop logging.
4. **Cadence is generic defaults.** Real management requires tuning the seeded playbook to Maddie's actual operation (her real weekly targets, which platforms, current content situation).
5. (Carryover) `/changelog` 500s in prod; video reel analysis is deployed but unverified end-to-end.

## Session 2f (2026-06-16) — Fix B shipped (quantity + multi-action)

Owner re-tested earlier: "posted 2 gym reels" → "trial reels" logged only 1 (quantity dropped). Implemented Fix B (#181, deployed worker 11baf94b): `log_drop` gains `count` (default 1, clamped 1-20); the inbound classifier processes ALL tool_use blocks and `handleInbound` runs each. So same-beat quantities use one `log_drop` with count=N, and compound messages ("a reel and 3 wall clips") log multiple items. Typecheck + 460 tests green. Awaiting owner re-test.

## Session 2g (2026-06-16) — ✅ Fix B verified

Owner re-tested as Maddie: "posted two reels" → "trial reels" → **"Logged 2. Counted toward Trial reel."** Drops now: Trial reel 3 (was 1, +2 from the count=2 log), Normal reel 1, total 4. Quantity honored end-to-end. (Compound "a reel + 3 wall clips" not yet exercised; one "posted 2 gym reels" clarification left unanswered — harmless.)

**State of the manager loop:** outbound pings, inbound classify→log (incl. quantity + multi-action), and the shared web/Telegram thread all work on prod. Remaining build item: the in-app Telegram link flow (still #1 gap). Optional for real management: connect Maddie's IG; tune cadence to her real numbers.

## Session 3 (2026-06-17) — 🔴 TIMEZONE BUG: "today" is UTC, not the creator's local day

Evening ping said *"Nothing shipped today, zero across the board"* at 8:00 PM CT — but 2 trial reels + a normal reel were logged at 3:13–3:43 PM CT the same day. Cause: drops were stamped **2026-06-16 ~20:xx UTC**; by 8 PM CT it was already **2026-06-17 UTC**, and `getTodayModel`/"shipped today" use `todayUTC()`. So the **day boundary is UTC midnight = ~6–7 PM US Central** — a creator's afternoon/evening work counts toward the next day, "shipped today" resets mid-evening, and the evening cron (`0 1 * * *` = 01:00 UTC = 8 PM CDT) fires into a fresh empty day.

Scope: everything keys off `todayUTC()` — TodayModel drop attribution, "shipped today", `daysSinceStart` (ramp), weekly-review windows. Affects every non-UTC creator (Maddie is US Central).

**Fix (proposed):** add a per-user timezone (default `America/Chicago`); compute "today"/day-boundaries/week-start in the creator's local tz instead of UTC. That fixes the day attribution + "nothing shipped today" + makes the 8 PM CT evening ping see the correct local day. **Separate/larger:** firing the cron pings at the creator's *local* times (currently fixed UTC, drifts with DST) — the direction doc's "per-user local scheduling" TODO; defer.

## Session 3b (2026-06-17) — ✅ Phase 1 (timezone day boundary) shipped

Ported geology's pattern (#183 Phase 1, PR #184, worker 8e844eed): per-user `coomander_settings.timezone` (migration 020 applied to prod; NULL → `America/Chicago`), `todayLocal(tz)`/`toDateLocal(ts,tz)`, and `getTimezone`/`userToday`. "today", drop bucketing, the ramp, and all daily entry points (ping, chat, home, inbound, seed) now use the creator's local day. 472 tests green (incl. new tz boundary + local-bucketing tests).

Data-level proof at 02:26 UTC (= 21:26 CDT): `today` = 2026-06-16 (Chicago) vs 2026-06-17 (UTC); Maddie's afternoon reel counts as today under Chicago, would not under UTC. Maddie defaults to America/Chicago (no config). **Deferred:** weekly-review internal bucketing + Phase 2 (local ping *times*).

## Session 4 (2026-06-17) — ✅ In-app Telegram link flow shipped (#185, the #1 gap)

Ported geology's link-code flow (PR #186, worker 896660cf, migration 021 applied to prod). A creator now connects Telegram with **no DB access**: mint a one-time code → tap a `t.me/coomander_bot?start=<code>` deep link (or send the code) → webhook `consumeLinkCode` binds `user.telegramChatId`. Surfaces: functional onboarding Telegram step + a `TelegramConnect` home banner (shown when unlinked). 8 link-code unit tests; typecheck + 480 tests + build:cf green. Maddie unlinked on prod to re-test the flow clean.

This closes the recurring #1 dogfooding gap — onboarding a creator's comms no longer needs an engineer.

## Session 5 (2026-06-17) — weekly review + full-review page dogfooded

Fired a manual weekly review for Maddie (weekEnding 2026-06-21) → delivered to Telegram + persisted; grounded recap (Reels 5/42, cushion 0, wins/drift) + 3 drift questions, good voice. Eyeballed the full-review web page (`/app/cadence/review/2026-06-21`) via agent-browser logged in as Maddie: renders cleanly — persistent nav, cushion trend, pillars w/ platform breakdown (none:1 ig:4) + status flags, consistency (longest streak 2d · 5 zero-drop · 0 bad), Coomander's read, drift questions.

**Finding:** `next_week_focus` renders as a raw JSON array literal — `Next week: ["..."]` — in BOTH the Telegram message and the web page; should be joined to prose. Minor polish bug.
