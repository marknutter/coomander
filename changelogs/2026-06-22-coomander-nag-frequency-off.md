---
date: 2026-06-22
scope: [node]
category: feature
files_changed:
  - apps/web/lib/coomander/settings.ts
  - apps/web/lib/coomander/agent.ts
  - apps/web/app/api/coomander/settings/route.ts
  - apps/web/app/app/cadence/page.tsx
requires_migration: false
requires_env_vars: []
breaking: false
---

## Wire up the cadence-ping frequency control + add an "off" setting

The Coomander nag-frequency preset (`tight` / `moderate` / `light`) gated
proactive Telegram pings server-side (`PRESET_SLOTS` + `planPing`), but had no
user-facing control — `/app/cadence` never read or wrote it — and there was no
way to fully silence pings short of a manual DB edit (the lowest preset,
`light`, still fires morning + evening).

- **New `off` frequency** — `PRESET_SLOTS.off = []` and an explicit `planPing`
  early-return (`"pings are off"`) suppress every slot regardless of day
  quality. `runAgentPing` already short-circuits on `!plan.send` before any
  Anthropic/Telegram call, so `off` costs nothing.
- **Wired the UI** — a "Cadence pings" card on `/app/cadence` (Off / Light /
  Moderate / Tight) reflects the saved value and PATCHes
  `/api/coomander/settings` on change (optimistic update, revert-on-error).
- The settings route's 400 message now lists `off, light, moderate, tight`.

`DEFAULT_NAG_FREQUENCY` stays `tight` (off is opt-in). No migration:
`nag_frequency` is plain `TEXT` with no CHECK constraint. `off` pauses scheduled
pings only — in-app + Telegram chat are unaffected (`coomanderEnabled`
untouched).
