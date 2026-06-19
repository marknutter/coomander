---
date: 2026-06-18
scope: [mobile]
category: feature
files_changed:
  - apps/mobile/src/lib/agent-socket-protocol.ts
  - apps/mobile/src/lib/use-agent-socket.ts
  - apps/mobile/src/lib/__tests__/agent-socket-protocol.test.ts
  - apps/mobile/src/app/(app)/index.tsx
requires_migration: false
requires_env_vars: []
breaking: false
---

## Mobile: stream chat over the agents-worker WebSocket (POST/SSE fallback)

The Expo chat screen now streams the assistant reply **token-by-token over the
agents Worker WebSocket** when the `coomander-agents-chat` flag is on — the same
transport the web app uses (#192) — while the existing POST/SSE path
(`lib/api.ts` `streamMessage`) stays the universal fallback. Flag-gated, no
regressions.

### Why a raw RN WebSocket (not `agents/react` / partysocket)

The agents Worker authenticates the WS **upgrade** with the Better Auth session
cookie. Browsers send it automatically (so web uses partysocket), but the
browser WebSocket API can't set request headers. React Native's
`new WebSocket(url, protocols, { headers })` CAN, so the hook injects
`Cookie: authClient.getCookie()` on the upgrade — **cookie only, no Origin**
(the Worker validates via a GET to `/api/auth/get-session`, which isn't
CSRF-checked). No `partysocket`/`agents` dependency added to the app.

### New files

- `lib/agent-socket-protocol.ts` — pure, framework-free protocol + state core
  (the unit-tested heart): `parseServerFrame` (defensive, never throws),
  `encodeChatFrame`, `buildWsUrl` (http→ws / https→wss + `/agents/app-agent/me`),
  `shouldUseSocket`, and the immutable stream `reduce` /`resetTurn`
  (token→append, done→finalize, error→surface, proactive→insert,
  conversation→track).
- `lib/use-agent-socket.ts` — raw RN WebSocket hook (`{ ready, send }`): opens
  only when enabled, capped-backoff reconnect, stops on a `1008` (auth) close,
  forwards parsed frames via `onFrame`. Plus `fetchAgentChatFlag()` reading
  `GET /api/flags` (defaults false on failure).
- `lib/__tests__/agent-socket-protocol.test.ts` — 78 spec-driven unit tests for
  the pure module (frame parse/validation, URL build, fallback selection, every
  reducer transition + immutability).

### Screen integration (`app/(app)/index.tsx`)

Resolves the flag on mount; opens the socket only when flag-on **and** ops is
enabled; streams tokens into a live assistant bubble; on `done` reloads the
canonical thread then drops the live bubble (shows final text until the reload
replaces it → no flicker); surfaces `error` frames and proactive messages;
keeps the optimistic user bubble on error; and falls back to POST/SSE whenever
the socket isn't open.
