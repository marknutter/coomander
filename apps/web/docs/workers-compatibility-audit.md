# Cloudflare Workers Compatibility Audit

Step 6 of #275. Snapshot taken on `main` after Step 5 landed (commit `8709f72`).

## Verdict

The codebase is **largely Workers-compatible** if Step 7 enables the `nodejs_compat` compatibility flag in `wrangler.toml`. That single flag covers `node:crypto`, `node:path`, `node:buffer`, etc. in the Workers runtime without any code refactor. No `child_process`, `worker_threads`, `cluster`, `dgram`, or other strictly Node-only runtime modules are imported from server-side code.

Five medium-or-higher findings remain. Each is **deferred-until-deploy** — i.e. the natural home for the fix is Step 7 (`@opennextjs/cloudflare` build config) where wiring, runtime, and smoke-test are all in scope. They are listed in [§ Follow-up work](#follow-up-work-deferred-until-deploy) below and the doc is the single source of truth — no separate sub-issues are opened, per #275's "deferred-until-deploy" alternative in the issue criteria.

Severity legend used below:

- **High** — Workers code path will fail at module load or first request without remediation
- **Medium** — Operational misconfiguration risk; deploy passes but feature breaks at runtime
- **Low** — Polyfill-covered; works once `nodejs_compat` is on

## SDKs

Verified each external HTTP SDK uses `fetch` (not `node:http`/`node:https`) and is supported on Cloudflare Workers.

| SDK | Import site(s) | Verdict | Severity |
|---|---|---|---|
| `@anthropic-ai/sdk` | `lib/chat-engine.ts` | ✅ Workers-supported runtime per Anthropic SDK docs; `fetch`-based. No change needed. | — |
| `resend` | `lib/email.ts` | ✅ Workers-supported per Resend docs; `fetch`-based. No change needed. | — |
| `stripe` | `lib/stripe.ts`, `app/api/stripe/webhook/route.ts` | ⚠️ Workers-supported since v12+ **only when constructed with** `httpClient: Stripe.createFetchHttpClient()`. Without the option the SDK reaches for `node:http` agents and fails at first call. | **Medium** — see follow-up #1 |
| ElevenLabs (raw `fetch`) | `app/api/voice/speak/route.ts` | ✅ Already uses `fetch` directly; no SDK in the way. | — |

## Node modules

Reachable usage of Node built-ins in server-side code paths (`lib/`, `app/api/`).

### `node:fs`

| File | Pattern | Workers-reachable? | Verdict | Severity |
|---|---|---|---|---|
| `lib/db.ts` (lines 116-117) | `fs.existsSync(dir)` / `fs.mkdirSync(dir)` to ensure SQLite dir exists | ❌ Only inside `initSqliteDb()` — gated by `!isD1() && !isPg()` | Safe; module-load resolution covered by `nodejs_compat` | Low |
| `lib/auth.ts` (lines 31-32) | Same — `fs.existsSync` / `fs.mkdirSync` for SQLite dir | ✅ **Yes** — the current `else` branch is reached on Workers because there's no `isD1()` case | Better Auth is constructed against better-sqlite3 on Workers, which won't load. Needs a D1 branch. | **High** — see follow-up #2 |
| `lib/migrate.ts` (lines 85, 95) | `fs.existsSync(migrationsDir)` / `fs.readFileSync` to read SQL files | ❌ `runMigrations()` and `runMigrationsPg()` are not invoked when `isD1()` — D1 uses `wrangler d1 migrations` (set up in Step 5) | Safe; `nodejs_compat` covers module-load | Low |
| `lib/storage.ts` (lines 31, 32, 39, 42, 46) | `fs.existsSync` / `fs.mkdirSync` / `fs.writeFileSync` / `fs.readFileSync` / `fs.unlinkSync` in `LocalStorage` | ❌ Only the `LocalStorage` class — `getStorageBackend()` returns `S3Backend` whenever `S3_ENDPOINT/BUCKET/ACCESS_KEY/SECRET_KEY` are set | Operationally safe **iff prod sets the four `S3_*` envs to R2 values** — otherwise the deploy silently falls back to LocalStorage and breaks at first upload | **Medium** — see follow-up #3 |
| `lib/mdx.ts` (lines 29, 31, 36, 62, 64, 96, 100) | `fs.existsSync` / `fs.readdirSync` / `fs.readFileSync` for blog and changelog | ✅ **Yes** — called inside async server-component / API code paths at request time | `fs.readFileSync` does not work on Workers (no real filesystem). Must inline at build time or move corpus to KV. | **High** — see follow-up #4 |

### `node:path`

| File | Notes |
|---|---|
| `lib/db.ts`, `lib/auth.ts`, `lib/migrate.ts`, `lib/storage.ts`, `lib/mdx.ts` | All `path.join` / `path.resolve` / `path.dirname` calls live alongside the `fs` calls above. Polyfilled by `nodejs_compat`; runtime safety inherits from the `fs` analysis. **Severity: Low** for the polyfill itself; severity of the surrounding `fs` call dominates. |

### `node:child_process`

None — confirmed via `grep -rEn child_process node/lib node/app`.

### Native modules

| Module | Import site(s) | Workers-reachable? | Verdict | Severity |
|---|---|---|---|---|
| `better-sqlite3` | `lib/db.ts`, `lib/auth.ts`, `lib/migrate.ts`, `lib/auth-schema.ts` (type-only), `lib/db-helpers.ts` (comment) | ✅ Eagerly imported at top of `lib/auth.ts`, conditionally used elsewhere | Top-level `import Database from "better-sqlite3"` in `lib/auth.ts` will fail to bundle for Workers because the package contains a `.node` binary. Must move under the dialect branch (dynamic import) or guard by `isD1()`. | **High** — folded into follow-up #2 (auth D1 branch) |

## Crypto

Web Crypto (`globalThis.crypto`) is available on Workers. `node:crypto` is polyfilled by `nodejs_compat`.

| Site | API used | Verdict | Severity |
|---|---|---|---|
| `lib/webhooks.ts`, `lib/notifications.ts`, `lib/jobs.ts`, `lib/rbac.ts`, `lib/db.ts`, `lib/storage.ts`, `app/api/waitlist/join/route.ts`, `app/api/admin/waitlist/invite/route.ts`, `app/api/admin/campaigns/route.ts`, `app/api/subscribe/route.ts`, `app/api/conversations/route.ts`, `app/api/conversations/[id]/messages/route.ts`, `app/api/files/route.ts` | `crypto.randomUUID()`, `crypto.randomBytes()`, `crypto.createHash()`, `crypto.createHmac()` | All polyfilled by `nodejs_compat` | Low |
| `lib/db.ts:173` | `crypto.scryptSync` for admin password hashing | Polyfilled. Only runs in local-bootstrap admin seed (not on Workers). | Low |
| `app/api/admin/users/[id]/reset-pw/route.ts` (lines 42, 50) | `randomBytes(n)` for token generation | Polyfilled. Could trivially be ported to `crypto.getRandomValues(new Uint8Array(n))` later for portability, but no functional reason to do it now. | Low |

No usage of `crypto.createCipheriv` or symmetric ciphers found — the surface is hashes, HMACs, randomness, and one scrypt for password hashing.

## Module-load side effects

Code that runs at module load (top-level statements, IIFEs, default-export evaluations) gets executed when the Worker isolate spins up. Anything reachable here that hits `fs`, native modules, or `process.cwd()` is a hard fail on Workers regardless of whether the function is later called.

| File | Side effect at module load | Verdict | Severity |
|---|---|---|---|
| `lib/auth.ts` (top-level `if (isPg()) … else { … }`) | Constructs `new Database(dbPath)` (better-sqlite3 native) and calls `fs.mkdirSync` in the `else` branch | ❌ **Will fail on Workers** — D1 falls into the `else` branch at module load | **High** — follow-up #2 (this is a module-load fail, not a request-time fail; must land before first deploy) |
| `lib/db.ts` | All side-effectful work is inside `getDb()`/`initSqliteDb()`/`initD1Db()` — module-load is just imports | ✅ Module-load is safe; first `getDb()` call routes correctly via `isD1()` | Low |
| `lib/migrate.ts` | No top-level execution; pure function exports | ✅ Safe | — |
| `lib/storage.ts` (line 28) | `const UPLOADS_DIR = path.join(process.cwd(), "data", "uploads")` at module load | ⚠️ Calls `path.join`/`process.cwd()` (both polyfilled by `nodejs_compat`) but no fs operation. Constant is computed and never read on the S3 path. | Low |
| `lib/mdx.ts` (lines 6-7) | `const BLOG_DIR = path.join(process.cwd(), "content/blog")` and similar for `CHANGELOG_PATH` | Same as above — `path.join` is polyfilled; no fs at module load. The fs reads happen lazily inside the exported functions, which then fail. See follow-up #4. | Low (module-load); High (request-time) — covered by #4 |

## Follow-up work (deferred-until-deploy)

These are documented here in lieu of separate sub-issues, per the issue's "deferred-until-deploy" criterion. All five will be addressed in Step 7 of #275 (`@opennextjs/cloudflare` build config), where wrangler.toml, runtime, and smoke-test all converge.

1. **Stripe SDK fetch HTTP client (Medium)** — In `lib/stripe.ts`, pass `httpClient: Stripe.createFetchHttpClient()` to the Stripe constructor when running on Workers. Otherwise the SDK reaches for `node:http` agents.

2. **`lib/auth.ts` D1 branch (High — module-load blocker)** — Add an `isD1()` branch that constructs Better Auth using the Drizzle adapter (`drizzleAdapter(getDb(), { provider: "sqlite" })`) against the D1 binding. Keep PG and SQLite branches intact. Currently the `else` branch (better-sqlite3) executes at module load on Workers and will fail before the first request even arrives.

3. **R2/S3 envs in production (Medium)** — Production deploy must set `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY` to R2 values so `getStorageBackend()` selects the existing S3 backend instead of `LocalStorage`. No code change required; this is a deploy-config item.

4. **`lib/mdx.ts` build-time inlining or KV (High — request-time blocker)** — `fs.readFileSync` of MDX files at request time fails on Workers. Two options: (a) generate a static index at build time and import it directly (preferred — content is small and changes infrequently); (b) move corpus into a Cloudflare KV namespace. Decide before the first deploy attempt.

5. **`wrangler.toml` `nodejs_compat` flag (Medium)** — Step 7's `wrangler.toml` must include `compatibility_flags = ["nodejs_compat"]` and `compatibility_date = "2024-09-23"` (or later). Without the flag, every `node:crypto` / `node:path` / `node:buffer` / `Buffer` import in the Low rows above turns into a build failure.

## Out of scope

- Actual Workers deploy and runtime verification (Step 8).
- Migrating the MDX corpus to KV vs build-time inlining decision (separate follow-up; see item 4).
- Any code refactor to remove `node:crypto`/`node:path`/`Buffer` usage in favor of Web Crypto / portable equivalents — `nodejs_compat` covers everything; refactor would be larger and riskier for the same end result.
