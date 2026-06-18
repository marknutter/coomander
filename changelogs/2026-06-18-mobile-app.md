---
date: 2026-06-18
scope: [mobile]
category: feature
files_changed:
  - apps/mobile/**
  - apps/web/lib/auth.ts
  - package.json
requires_migration: false
requires_env_vars: [EXPO_PUBLIC_API_URL]
breaking: false
---

## Add `apps/mobile` — Expo / React Native app

New native mobile workspace (Expo SDK 54, React Native 0.81.5, expo-router 6)
that authenticates against the web API via Better Auth.

### Highlights

- `@better-auth/expo` client with session persisted in `expo-secure-store`,
  scheme `coomander://`, plus the `Origin` header CSRF shim (web has no `expo()`
  server plugin).
- `metro.config.js` single-React resolver (mobile pins React 19.1.0 vs web/root
  19.2.4 — deliberate, RN 0.81 renderer baseline) and the `index.js`
  require.context entry (monorepo workaround).
- Depends on `@coomander/core`. Minimal expo-router tree: root layout,
  `(auth)/sign-in`, protected `(app)` home.
- `apps/web/lib/auth.ts` `trustedOrigins` extended for the mobile scheme +
  tailnet/prod origins.

### Operator follow-ups

- `eas init` in `apps/mobile/` and replace the placeholder `extra.eas.projectId`.
- Replace placeholder `assets/` with real branding; set `eas.json` submit IDs.
- `EXPO_PUBLIC_API_URL` selects the backend (localhost:3005 / tailnet HTTPS / prod).
