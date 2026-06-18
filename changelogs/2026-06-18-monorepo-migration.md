---
date: 2026-06-18
scope: [node, infra]
category: breaking
files_changed:
  - package.json
  - tsconfig.base.json
  - apps/web/**
  - packages/core/**
  - docker-compose.yml
  - .github/workflows/ci.yml
  - .dockerignore
requires_migration: false
requires_env_vars: []
breaking: true
---

## Monorepo migration: flat `node/` → `apps/web` + `packages/core`

Restructured the project from a single flat app (everything under `node/`) into
an npm-workspace monorepo, the foundation for the mobile app, the Cloudflare
Agents worker, and shared cross-platform code.

### What changed

- `node/` → `apps/web/` (whole app, one history-preserving rename).
- New `packages/core` (`@coomander/core`) — platform-agnostic skeleton (http
  primitives, Better Auth `$Infer` types, schema barrel). No `next/*`, drizzle,
  DOM, or Node built-ins (must run in React Native).
- Root `package.json` (workspaces `apps/*` + `packages/*`, delegating scripts,
  React `overrides`) + shared `tsconfig.base.json`.
- `apps/web/next.config.ts`: `transpilePackages: ["@coomander/core"]`,
  `outputFileTracingRoot` → repo root, root-relative `pg-cloudflare` includes.
- Docker (`apps/web/Dockerfile.dev` + root `docker-compose.yml`), CI
  (`working-directory: apps/web`, root `npm ci`), and `.dockerignore` repointed.

### Breaking for downstream/dev

- Run `npm install` from the **repo root** now (single root lockfile).
- App scripts delegate via the root `package.json` (`npm run dev`,
  `npm run build:cf`, etc.) or `-w apps/web`.
- `better-auth` is pinned to `1.4.18` — a fresh lockfile resolve otherwise bumps
  it to 1.6.x and breaks `lib/auth.ts` typing.
