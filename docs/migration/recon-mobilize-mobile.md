# Recon: Mobilize Coomander + Add Mobile App

**Status:** Read-only recon. No code changed. Reference = `~/Code/geology` (already migrated, working). Target = `~/Code/maddiehq` (flat, app lives in `node/`).

This documents (Phase 1) converting the flat Next.js app at `maddiehq/node` into an `apps/web` + `packages/core` npm-workspace monorepo, and (Phase 2a) adding an `apps/mobile` Expo app, both modeled on what geology actually has on disk.

> **Important divergence from the layout the `appseed-mobilize` skill assumes:** that skill assumes the flat app lives at the **repo root** (`app/`, `lib/`, `package.json` all at top level) and uses `git mv app/ apps/web/app/`. Coomander is **already one level down** in `node/`. The right move is `git mv node apps/web` (one rename, history preserved) rather than dozens of per-file moves. See §2.

---

## 1. Target directory tree (post-migration)

```
maddiehq/
├── package.json                 # NEW — root workspace manifest (workspaces + delegating scripts + overrides)
├── package-lock.json            # NEW — single root lockfile (npm workspaces); delete node/package-lock.json
├── tsconfig.base.json           # NEW — shared compiler options
├── docker-compose.yml           # STAYS at root — repoint build context + bind mounts (§6)
├── .gitignore / .dockerignore   # STAY at root (.dockerignore: make workspace-aware)
├── AGENTS.md / CLAUDE.md / PROJECT.md / README.md   # STAY at root
├── .github/                     # STAYS at root — repoint CI working-directory (§6)
├── .env / .env.example          # repo-root compose-level vars (TS_AUTHKEY, DEV_PORT) STAY; app env moves
├── tailscale/
│   └── Caddyfile                # STAYS at root (sidecar is not part of apps/web). Optionally rename → Caddyfile.node
├── scripts/
│   └── check-wiki-coverage.sh   # STAYS (root-level helper; repoint its internal paths if it greps node/)
├── legacy/  research/           # STAY at root (not part of the app)
├── docs/
│   └── migration/recon-mobilize-mobile.md   # this file
├── apps/
│   ├── web/                     # ← everything currently in node/ moves here verbatim
│   │   ├── app/ components/ lib/ (incl. lib/coomander/*) emails/ jobs/ workers/
│   │   ├── content/ docs/ public/ migrations/ migrations-pg/ drizzle/ data/ e2e/ tests/
│   │   ├── package.json tsconfig.json next.config.ts wrangler.toml
│   │   ├── custom-worker.ts open-next.config.ts open-next.config.ts
│   │   ├── drizzle.config.ts playwright.config.ts vitest.config.ts source.config.ts
│   │   ├── middleware.ts components.json eslint.config.mjs postcss.config.mjs
│   │   ├── openapi-gen.config.json sentry.*.config.ts .node-version .dockerignore
│   │   ├── Dockerfile.dev scripts/ (node/scripts/*)
│   │   └── .env.local .env.example   (app env, moved with the tree)
│   └── mobile/                  # NEW — Expo app (Phase 2a)
└── packages/
    └── core/                    # NEW — @coomander/core (schemas + types + api-client skeleton)
```

---

## 2. What moves `node/*` → `apps/web/*`, what stays at root

### The move (single rename)

```bash
git mv node apps/web
```

That relocates the **entire** Next.js app — `app/`, `components/`, `lib/` (including the large `lib/coomander/*` ops-agent codebase), `emails/`, `jobs/`, `workers/` (video-processor), `migrations/`, `migrations-pg/`, `drizzle/`, `data/`, `content/`, `docs/`, `e2e/`, `tests/`, and every config file listed in the tree above — into `apps/web/` in one step, preserving git history.

Then clean up build artifacts and the stale lockfile inside the moved tree (they regenerate at root):

```bash
rm -rf apps/web/node_modules apps/web/.next apps/web/.open-next \
       apps/web/.source apps/web/.openapi-gen apps/web/.wrangler \
       apps/web/tsconfig.tsbuildinfo apps/web/test-results
rm -f apps/web/package-lock.json
```

### Stays at repo root (do NOT move)

- `docker-compose.yml`, `tailscale/` (the Caddy/Tailscale sidecar is not part of `apps/web`)
- `.github/`, `.gitignore`, `.dockerignore`
- `AGENTS.md`, `CLAUDE.md`, `PROJECT.md`, `README.md`
- `scripts/check-wiki-coverage.sh` (root helper — geology keeps the same file at root)
- `legacy/`, `research/`, `docs/`
- Root `.env` / `.env.example` carry **compose-level** vars only (`TS_AUTHKEY`, `TS_HOSTNAME`, `DEV_PORT`, `BETTER_AUTH_URL`, `APP_URL` overrides). The app's own env (`node/.env.local`, `node/.env.example`) rides along inside the `git mv node apps/web` and becomes `apps/web/.env.local` / `apps/web/.env.example`.

> Note: maddiehq has root-level `.env`/`.env.example` **and** `node/.env*`. Geology's pattern: compose reads `apps/web/.env.local` via `env_file`, and a small repo-root `.env` supplies `TS_AUTHKEY`/`DEV_PORT` to the compose interpolation. Keep that split.

---

## 3. Root config files to CREATE (based on geology's actual files)

### 3a. `package.json` (repo root) — modeled on geology, trimmed to scripts coomander's web actually has

Coomander's `node/package.json` has **no `overrides`** today. Geology pins React at the root because it has a mobile workspace forcing a second React copy — coomander will need the same overrides **once mobile is added** (Phase 2a). Add them now so the workspace is mobile-ready.

```json
{
  "name": "coomander-monorepo",
  "version": "0.1.0",
  "private": true,
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "dev": "npm run dev -w apps/web",
    "build": "npm run build -w apps/web",
    "build:cf": "npm run build:cf -w apps/web",
    "preview:cf": "npm run preview:cf -w apps/web",
    "deploy:cf": "npm run deploy:cf -w apps/web",
    "start": "npm run start -w apps/web",
    "lint": "npm run lint -w apps/web",
    "typecheck": "npm run typecheck --workspaces --if-present",
    "test": "npm run test -w apps/web",
    "test:mobile": "npm run test -w apps/mobile",
    "test:e2e": "npm run test:e2e -w apps/web",
    "db:migrate": "npm run db:migrate -w apps/web",
    "db:rollback": "npm run db:rollback -w apps/web",
    "db:generate": "npm run db:generate -w apps/web",
    "db:studio": "npm run db:studio -w apps/web",
    "db:seed": "npm run db:seed -w apps/web",
    "docker:dev": "DOCKER_BUILDKIT=0 docker compose --profile dev up --build"
  },
  "overrides": {
    "react": "19.2.4",
    "react-dom": "19.2.4",
    "@types/react": "^19",
    "@types/react-dom": "^19"
  }
}
```

> Drop the `docker:prod` script — maddiehq's compose has no prod profile worth keeping for Workers deploy, and geology dropped it too. Keep coomander's web-local `docker:dev` script but repoint it (see §6e).

### 3b. `tsconfig.base.json` (repo root) — copy geology's verbatim

```json
{
  "$comment": "Shared TypeScript compiler options for all workspaces. Each workspace extends this and adds its own lib/paths.",
  "compilerOptions": {
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "allowJs": true,
    "noEmit": true,
    "target": "ES2017"
  }
}
```

### 3c. `apps/web/tsconfig.json` — rewrite to extend the base

Coomander's current `node/tsconfig.json` inlines all compiler options and has `"exclude": ["node_modules", "workers"]`. After the move, replace with geology's shape **but preserve coomander's `workers` exclude**:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["dom", "dom.iterable", "esnext"],
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": {
      "@/*": ["./*"],
      "@/.source/*": ["./.source/*"]
    }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules", "workers"]
}
```

---

## 4. `packages/core` — name and initial contents

- **Name it `@coomander/core`** (geology used `@appseed/core`; the skill template also says `@appseed/core`). Match the project, not the template — coomander's CLAUDE.md import paths use the `@/` alias and there is no existing `@appseed/*` import to preserve. Use `@coomander/core`.
- **Initial scope = skeleton only.** Geology's core is moderately populated (schemas/auth/items/notifications/chat, an `api-client.ts`, `geology-math.ts`, `http.ts`, `auth-types.ts`). For coomander Phase 1, create the **minimal** skeleton the skill describes (`http.ts`, `auth-types.ts`, empty `schemas/index.ts`, barrel `index.ts`). Do **not** try to extract coomander schemas yet — that's later work driven by what mobile actually needs.

### `packages/core/package.json`

```json
{
  "name": "@coomander/core",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Platform-agnostic core: Zod schemas, shared types, and a typed API client. No next/*, drizzle, better-sqlite3, react-dom, Node built-ins, or DOM globals (must run in React Native).",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": { "types": "./src/index.ts", "default": "./src/index.ts" } },
  "scripts": { "typecheck": "tsc --noEmit" },
  "dependencies": { "better-auth": "^1.4.18", "zod": "^4.3.6" },
  "devDependencies": { "typescript": "^5" }
}
```

(`better-auth` / `zod` versions match `apps/web/package.json`.)

### `packages/core/tsconfig.json` (copy geology verbatim)

```json
{
  "$comment": "@coomander/core must compile without DOM or Node types to stay platform-agnostic.",
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "lib": ["ES2021"], "types": [] },
  "include": ["src/**/*.ts"]
}
```

### Source skeleton

- `packages/core/src/index.ts` — barrel: re-export `ApiError` + http types, `Session`/`User` type-only, `export * from "./schemas"`.
- `packages/core/src/http.ts` — `ResponseLike` / `RequestInitLike` / `FetchLike` interfaces + `ApiError` class (verbatim from skill §7c).
- `packages/core/src/auth-types.ts` — infer `Session`/`User` from `createAuthClient` (verbatim from skill §7c).
- `packages/core/src/schemas/index.ts` — empty placeholder comment.
- Optionally copy geology's `api-client.ts` shape later, but its body imports geology-specific schemas, so **don't copy it verbatim** — start without it.

### Wire into web

Add `"@coomander/core": "*"` to `apps/web/package.json` dependencies.

---

## 5. `apps/mobile` scaffold plan (Phase 2a) — exact versions copied from geology

Geology's mobile app is **Expo SDK 54**, React Native 0.81.5, expo-router 6, Better Auth via `@better-auth/expo`, session persisted in `expo-secure-store`. Copy the version set exactly — these are tested-together pins.

### `apps/mobile/package.json` (copy geology's deps verbatim; rename only `name`/branding)

```jsonc
{
  "name": "mobile",
  "main": "index.js",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "start": "expo start", "android": "expo start --android", "ios": "expo start --ios",
    "web": "expo start --web", "typecheck": "tsc --noEmit", "lint": "expo lint", "test": "jest"
  },
  "dependencies": {
    "@coomander/core": "*",
    "@better-auth/core": "1.6.15",
    "@better-auth/expo": "1.6.15",
    "@expo-google-fonts/geist": "^0.4.2",
    "@expo-google-fonts/geist-mono": "^0.4.2",
    "@expo-google-fonts/newsreader": "^0.4.1",
    "@react-native-community/datetimepicker": "8.4.4",
    "@react-navigation/drawer": "^7.12.2",
    "better-auth": "1.6.15",
    "expo": "^54.0.0",
    "expo-av": "~16.0.8",
    "expo-constants": "~18.0.13",
    "expo-device": "~8.0.10",
    "expo-font": "~14.0.12",
    "expo-linking": "~8.0.12",
    "expo-network": "~8.0.8",
    "expo-notifications": "~0.32.17",
    "expo-router": "~6.0.24",
    "expo-secure-store": "~15.0.8",
    "expo-speech": "~14.0.8",
    "expo-splash-screen": "~31.0.13",
    "expo-status-bar": "~3.0.9",
    "expo-system-ui": "~6.0.9",
    "expo-web-browser": "~15.0.11",
    "react": "19.1.0",
    "react-dom": "19.1.0",
    "react-native": "0.81.5",
    "react-native-gesture-handler": "~2.28.0",
    "react-native-reanimated": "~4.1.1",
    "react-native-safe-area-context": "~5.6.0",
    "react-native-screens": "~4.16.0",
    "react-native-svg": "15.12.1",
    "react-native-web": "~0.21.0",
    "react-native-worklets": "0.5.1"
  },
  "devDependencies": {
    "@testing-library/react-native": "13.3.3",
    "@types/jest": "29.5.14",
    "@types/react": "^19",
    "eslint-config-expo": "~10.0.0",
    "jest": "29.7.0",
    "jest-expo": "54.0.17",
    "react-test-renderer": "19.1.0",
    "typescript": "~5.9.2"
  }
}
```

> **CRITICAL version note:** mobile pins `react`/`react-dom` to **19.1.0** (RN 0.81's renderer baseline) while web/root pin **19.2.4**. The repo deliberately carries two React copies. `metro.config.js` (§5, file list) force-resolves all `react` imports to mobile's local 19.1.0 to avoid the "Invalid hook call" crash. Do not "fix" this mismatch.

### File list to create under `apps/mobile/` (copy geology's structure, swap branding)

- `app.json` — set `name: "Coomander"`, `slug: "coomander-mobile"`, `scheme: "coomander"`, bundle IDs `com.oqodo.coomander` (or chosen org), splash/icon assets, plugins list (expo-router, expo-splash-screen, expo-secure-store, expo-web-browser, expo-font, datetimepicker, expo-notifications), `experiments.reactCompiler: true`, `extra.eas.projectId` (**generate a new one** via `eas init` — geology's `2f920b7f-…` is geology's own).
- `eas.json` — copy geology's; set `preview`/`production` `env.EXPO_PUBLIC_API_URL` to coomander's prod URL `https://coomander.com`; set new `ascAppId`/owner.
- `metro.config.js` — copy **verbatim** (workspace root watch + nodeModulesPaths + the single-React `resolveRequest` shim). Critical for the monorepo.
- `babel.config.js` — copy verbatim (`babel-preset-expo` + `react-native-worklets/plugin`).
- `index.js` — copy verbatim (custom `require.context("./src/app")` entry; monorepo workaround for expo/expo#27299 — do NOT use `expo-router/entry`).
- `tsconfig.json` — copy verbatim (`extends: expo/tsconfig.base`, `@/*` → `./src/*`).
- `jest.config.js`, `eslint.config.js`, `.gitignore`, `.env` / `.env.example`.
- `assets/` (icon/splash/favicon) — replace with coomander branding.
- `src/app/` — expo-router tree: `_layout.tsx` (root), `(auth)/` (sign-in/sign-up/forgot-password/two-factor), `(app)/` (protected group with its own session guard), plus coomander-specific screens. Start minimal: root layout + auth group + one protected home screen.
- `src/lib/auth-client.ts` — copy geology's pattern (below), swap `scheme`/`storagePrefix` to `"coomander"`.
- `src/lib/api.ts` — copy verbatim (uses `createApiClient` from `@coomander/core`).
- `src/lib/theme.tsx`, `src/components/error-boundary.tsx`, `screen.tsx`, etc. as needed.

### Auth approach (from geology, proven)

`createAuthClient` from `better-auth/react` + `twoFactorClient()` + `expoClient({ scheme: "coomander", storagePrefix: "coomander", storage: SecureStore })`. Session cookie persists in `expo-secure-store` and replays on every request. **Gotcha already solved in geology (#232):** the web server has no `expo()` server plugin, so Better Auth's CSRF origin check 403s mobile auth POSTs that lack an `Origin` header. Fix: `fetchOptions.headers = { Origin: API_URL }` on the client (API_URL is always a trusted origin). Copy this.

### Env approach

`EXPO_PUBLIC_API_URL` selects the backend:
- iOS simulator on same Mac → `http://localhost:<DEV_PORT>` (coomander dev port is **3005**)
- Physical phone via Tailscale → `https://coomander.gate-cardassian.ts.net` (HTTPS required on iOS)
- Production → `https://coomander.com`

`.env` sets dev default; `eas.json` `env` blocks set preview/prod.

### Backend prerequisites for mobile auth (web side)

- Add the mobile `scheme://` and the tailnet/prod origins to Better Auth `trustedOrigins` in `apps/web/lib/auth.ts`.
- Geology added an `expo()` server plugin? **No** — it relies on the `Origin` header shim instead. Match that (simpler). If push notifications are wanted, that's separate (expo-notifications + a device-token table) — out of scope for the initial scaffold.

---

## 6. Config rewrites needed in `apps/web` after the move

### 6a. `apps/web/next.config.ts`

Add the three monorepo settings (geology has all three):

```ts
import path from "path";
// inside nextConfig:
transpilePackages: ["@coomander/core"],
outputFileTracingRoot: path.join(__dirname, "../../"),
```

And **change the existing** `outputFileTracingIncludes` from coomander's single-level path to the root-relative two-path form geology uses:

```ts
// current (flat):  "*": ["./node_modules/pg-cloudflare/**"]
// change to:
outputFileTracingIncludes: {
  "*": [
    "../../node_modules/pg-cloudflare/**",
    "../../node_modules/pg/node_modules/pg-cloudflare/**",
  ],
},
```

`allowedDevOrigins` already lists `coomander.gate-cardassian.ts.net` / `*.gate-cardassian.ts.net` — keep as is (no change needed for mobile, but mobile hits the API not the dev server).

### 6b. `apps/web/wrangler.toml`

`name = "coomander"` and all bindings stay — wrangler resolves relative to its own file, so `migrations_dir = "migrations"`, `main = "custom-worker.ts"`, `assets.directory = ".open-next/assets"` all remain correct once the file sits in `apps/web/`. **No path edits needed** as long as `build:cf`/`deploy:cf` run with cwd = `apps/web` (they do, via `-w apps/web`). Verify with `wrangler deploy --dry-run` from `apps/web`.

### 6c. `docker-compose.yml` (root)

Current `app-dev` uses `context: ./node`, `dockerfile: Dockerfile.dev`, `./node:/app` bind mounts, `env_file: ./node/.env.local`, `DATABASE_PATH: /app/data/coomander.db`. Rewrite to geology's monorepo shape:

```yaml
app-dev:
  build:
    context: .                              # repo root (was ./node)
    dockerfile: apps/web/Dockerfile.dev     # was Dockerfile.dev
  container_name: coomander-dev
  network_mode: service:caddy-dev
  depends_on: [caddy-dev]
  volumes:
    - ./apps/web:/app/apps/web              # was ./node:/app
    - ./packages/core:/app/packages/core    # NEW
    - ./tsconfig.base.json:/app/tsconfig.base.json:ro   # NEW (Turbopack 500s without it)
    - root_node_modules:/app/node_modules               # was node_modules:/app/node_modules
    - web_node_modules:/app/apps/web/node_modules        # NEW
    - ./apps/web/data:/app/apps/web/data    # was ./node/data:/app/data
  env_file: ./apps/web/.env.local           # was ./node/.env.local
  environment:
    NODE_ENV: development
    DATABASE_PATH: /app/apps/web/data/coomander.db   # was /app/data/coomander.db
    BETTER_AUTH_URL: ${BETTER_AUTH_URL:-http://localhost:3005}
    APP_URL: ${APP_URL:-http://localhost:3005}
    WATCHPACK_POLLING: "true"
# volumes: add root_node_modules + web_node_modules (keep caddy_state)
```

The `caddy-dev` sidecar and its `./tailscale/Caddyfile` mount stay unchanged (port `${DEV_PORT:-3005}:3000`).

> The compose runs the app via the Dockerfile's CMD. `apps/web/Dockerfile.dev` must be updated to the monorepo pattern (skill §9b): copy root `package.json`+`package-lock.json`+`apps/web/package.json`+`packages/core/package.json`, `npm ci` at `/app`, then `WORKDIR /app/apps/web`, `CMD npm run dev`. Read the current `node/Dockerfile.dev` (it's tiny, 227 bytes) and adapt — preserve any `data/` and fumadocs content steps.

### 6d. `tailscale/Caddyfile`

No path changes (it proxies `127.0.0.1:3000` inside the shared netns). Optionally rename to `Caddyfile.node` to match geology and update the compose mount — cosmetic, skip unless aligning.

### 6e. `apps/web/package.json` docker:dev script

Change `-f ../docker-compose.yml` → `-f ../../docker-compose.yml` (one more level up after the move). Drop `docker:prod`.

### 6f. `.github/` CI

maddiehq's CI currently `cd`s into `node/` (or sets working-directory). Repoint: `npm ci` at repo root, `working-directory: apps/web` for lint/test/build/e2e, `cache-dependency-path: package-lock.json` (root), artifact paths `apps/web/.next` etc. (Inspect `.github/workflows/` — only one workflow dir exists.)

### 6g. root `scripts/check-wiki-coverage.sh`

If it greps `node/content/docs/dev`, repoint to `apps/web/content/docs/dev`. (Geology keeps the same script at root pointed at `apps/web`.)

### 6h. `.dockerignore` (root)

Make workspace-aware: `**/node_modules`, `**/.next`, `**/.open-next`, `apps/mobile/`.

---

## 7. Coomander-specific gotchas + risks

1. **`git mv node apps/web`, not per-file moves.** The skill's Step 4 assumes a root-level flat app and lists `git mv app/ apps/web/app/` etc. Coomander is already in `node/`, so one directory rename is correct and far cleaner. Don't follow the skill literally here.
2. **Large `lib/coomander/*` ops-agent codebase (24 files: agent, scheduling, telegram, drops, beats, weeklyReview, etc.)** rides along inside `node/` → `apps/web/lib/coomander/`. It uses the `@/` alias which still resolves (`@/*` → `./*` relative to `apps/web`). No import rewrites needed as long as everything moves together. **Risk:** any absolute path strings or `process.cwd()`-relative file reads inside these modules. Grep for `process.cwd`, `__dirname`, and hardcoded `"node/"` after the move.
3. **`custom-worker.ts` + cron triggers (#151).** wrangler `main = "custom-worker.ts"` wraps `.open-next/worker.js` and adds the `scheduled()` cron handler. It moves with the app; the `[triggers]` crons and `CRON_SLOT` mapping in `custom-worker.ts` are path-independent. Verify `build:cf` still emits `.open-next/` under `apps/web` and that `outputFileTracingRoot` doesn't break the custom worker bundling — test `npm run build:cf -w apps/web` end to end.
4. **D1 + better-sqlite3 dual setup.** `DATABASE_DRIVER` toggles D1 (prod/Workers) vs better-sqlite3 (local dev). `migrations_dir = "migrations"` (D1) and `node/migrations/*.sql` both move under `apps/web`. `drizzle.config.ts` and `migrations-pg/` move too. The `outputFileTracingRoot` + `pg-cloudflare` includes (§6a) are exactly the Workers fix that keeps the pg path resolvable from the hoisted root `node_modules`. **Risk:** `data/coomander.db` path — already handled in §6c (DATABASE_PATH → `/app/apps/web/data/...`).
5. **Video-processor Worker (`node/workers/video-processor`, service binding `VIDEO_PROCESSOR`).** It's excluded from web tsconfig (`"exclude": [..., "workers"]` — preserve that). It deploys independently; the service binding in wrangler.toml is name-based, path-independent. Moves with the app under `apps/web/workers/`.
6. **Telegram webhook + Stripe webhook routes** (`app/api/webhooks/*`, `app/api/stripe/webhook`) move with `app/`. Route paths are unchanged. **Risk:** any registered webhook URL is absolute (`https://coomander.com/...`) — unaffected by the dir move.
7. **Fumadocs / docs wiki** (`content/docs/{dev,guide}`, `source.config.ts`, `postinstall: fumadocs-mdx`). The `@/.source/*` alias and `.source` build dir move with the app. `postinstall` runs per-workspace; npm workspaces run it in `apps/web` correctly. **Risk:** the Dockerfile.dev must keep the `content/` + `source.config.ts` available before `fumadocs-mdx` postinstall (skill §9b note).
8. **changelogs/ + `.coomander-sync-cursor`.** maddiehq has NO root `changelogs/` or sync cursor on disk currently (only the upstream AppSeed template does). Nothing to move; if added later they live at root.
9. **Two React copies once mobile lands** (web 19.2.4 vs mobile 19.1.0) — handled by `metro.config.js` resolveRequest + root `overrides`. Documented in §5; don't unify.
10. **`apps/agents` exists in geology but NOT planned for coomander here.** Geology's compose/Caddyfile route `/agents/*` to a separate Cloudflare Agents Worker (`apps/agents`, package name `agents`-based). Coomander's ops-agent lives in-process under `lib/coomander/*` + cron, **not** a separate Workers Agent. Do not copy geology's `apps/agents`, its compose service, or the `/agents/*` Caddy route. (Noted per brief: agents exists in geology, another team's concern.)
11. **Single root lockfile.** Delete `node/package-lock.json` before `npm install` at root, or npm workspaces will fight over two lockfiles.

---

## 8. Ordered task list

### Phase 1 — Mobilize (flat `node/` → monorepo)

1. `git checkout -b feature/monorepo-migration` and tag `pre-monorepo-migration` for rollback.
2. `git mv node apps/web` (single rename; preserves history).
3. Delete moved build artifacts + stale lockfile: `apps/web/{node_modules,.next,.open-next,.source,.openapi-gen,.wrangler,tsconfig.tsbuildinfo,test-results}`, `apps/web/package-lock.json`.
4. Create `packages/core/` skeleton: `package.json` (`@coomander/core`), `tsconfig.json`, `src/{index,http,auth-types}.ts`, `src/schemas/index.ts`.
5. Create root `package.json` (workspaces + delegating scripts + React overrides) and `tsconfig.base.json`.
6. Rewrite `apps/web/tsconfig.json` to extend `../../tsconfig.base.json` (keep `exclude: ["node_modules","workers"]`).
7. Add `"@coomander/core": "*"` to `apps/web/package.json`; fix its `docker:dev` script path (`../../`); drop `docker:prod`.
8. Edit `apps/web/next.config.ts`: add `transpilePackages`, `outputFileTracingRoot`, and switch `outputFileTracingIncludes` to root-relative pg-cloudflare paths.
9. Update `apps/web/Dockerfile.dev` to the monorepo pattern (root manifests → `npm ci` at `/app` → `WORKDIR /app/apps/web`).
10. Rewrite `docker-compose.yml` `app-dev` service (context `.`, dockerfile `apps/web/Dockerfile.dev`, bind mounts for `apps/web` + `packages/core` + `tsconfig.base.json`, two node_modules volumes, env_file + DATABASE_PATH repointed).
11. Repoint `.github/workflows/*` (root `npm ci`, `working-directory: apps/web`, cache path, artifact paths) and `.dockerignore`; repoint `scripts/check-wiki-coverage.sh` if needed.
12. `rm -f node_modules` at root if any; `npm install` from repo root (creates single root lockfile).
13. Verify: `npm run typecheck`, `npm run build -w apps/web`, `npm run build:cf -w apps/web` (Workers bundling + custom-worker + cron), `wrangler deploy --dry-run` from `apps/web`.
14. Verify dev container: `docker compose --profile dev up --build`; hit `localhost:3005` and the tailnet HTTPS URL; confirm Telegram/Stripe webhook routes and D1/sqlite both resolve.
15. Commit; open PR; create QA issue (per workflow rules). Do not merge without confirmation.

### Phase 2a — Add `apps/mobile` (Expo)

16. Scaffold `apps/mobile/` files: `package.json` (geology version set, `@coomander/core` dep), `app.json` (coomander branding/scheme), `eas.json`, `metro.config.js` (verbatim), `babel.config.js` (verbatim), `index.js` (verbatim require.context), `tsconfig.json`, `jest.config.js`, `eslint.config.js`, `.env`/`.env.example`, `assets/`.
17. `eas init` to generate a **new** `extra.eas.projectId`; set owner/bundle IDs.
18. Create `src/lib/auth-client.ts` (better-auth/react + twoFactorClient + expoClient scheme `coomander` + `Origin` header shim) and `src/lib/api.ts` (`createApiClient` from `@coomander/core`).
19. Create minimal `src/app/` tree: `_layout.tsx`, `(auth)/sign-in.tsx` + `(auth)/_layout.tsx`, `(app)/_layout.tsx` (session guard) + `(app)/index.tsx` home.
20. Add mobile `scheme` + tailnet/prod origins to `apps/web/lib/auth.ts` `trustedOrigins`.
21. `npm install` at root (links `@coomander/core` into mobile; pulls Expo deps).
22. Run `npm run typecheck -w apps/mobile`; `npx expo start` against `EXPO_PUBLIC_API_URL=http://localhost:3005` (simulator) and the tailnet URL (phone); verify sign-in flows against the running web API.
23. Commit; PR; QA issue. Do not merge without confirmation.
