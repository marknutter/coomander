# CLAUDE.md — Coomander

**Read `AGENTS.md` first.** It describes everything already implemented in this template so you don't rebuild it.

---

## Workflow Rules

- **Always use feature branches + PRs.** Never commit directly to `main`.
  ```bash
  git checkout -b feature/your-feature
  # ... implement ...
  git commit -m "descriptive message"
  gh pr create
  ```
- **Commit after each meaningful feature**, not in batches.
- **Run `npm run build` before creating a PR** to catch type errors and build failures.
- When there's a worktree lock preventing `git checkout main`, use:
  ```bash
  git fetch origin main && git reset --hard origin/main
  ```

## Key Libraries / Import Paths

```ts
// Auth
import { auth } from "@/lib/auth";                    // server only
import { authClient } from "@/lib/auth-client";        // client + server

// Database (Drizzle ORM)
import { getDb } from "@/lib/db";                     // returns Drizzle ORM instance (primary)
import { getRawDb } from "@/lib/db";                  // returns raw better-sqlite3 (FTS5, PRAGMA, etc.)

// Email
import { sendVerificationEmail, ... } from "@/lib/email";

// UI
import { Button, Input, Modal, ... } from "@/components/ui";

// Toast
import { useToast } from "@/lib/use-toast";

// Theme
import { useTheme } from "@/lib/theme";

// Errors
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";

// Logger
import { logger } from "@/lib/logger";

// AI Chat (WebSocket-only via the agents worker — no SSE/POST path)
import { chatSystemPrompt, chatTools, runCoomanderTool } from "@/lib/coomander/coomanderChat"; // Coomander chat brain
import { getModel, listModels, DEFAULT_MODEL_ID } from "@coomander/core";                       // shared model catalog
import { registerTagHandler, stripTags } from "@/lib/chat-tags";
import { useVoice } from "@/lib/use-voice";

// Documentation
import { docsSource } from "@/lib/docs-source";         // customer docs page tree
import { devDocsSource } from "@/lib/dev-docs-source";   // dev wiki page tree
```

## API Route Template

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();
    // ...
    return NextResponse.json({ data });
  } catch (error) {
    return errorResponse(error);
  }
}
```

## Auth — Current System

**Better Auth** (NOT custom JWT, NOT NextAuth). Migrated Feb 2026.

- Server session: `auth.api.getSession({ headers: request.headers })`
- Middleware: `getSessionCookie()` from `better-auth/cookies`
- DB table: `user` (singular) — not `users`
- Custom user fields are camelCase: `stripeCustomerId`, `subscriptionStatus`
- Env vars: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (not `JWT_SECRET`)

## Database

- SQLite via Drizzle ORM + `better-sqlite3` (synchronous API — no `await` needed)
- Schema defined in `lib/schema.ts` — all 16 tables with typed columns
- `getDb()` returns Drizzle instance for typed queries; `getRawDb()` for raw SQL (FTS5, PRAGMA)
- Add new tables via migration files in `migrations/` → run `npm run db:migrate`
- Generate Drizzle migrations: `npm run db:generate`
- Always foreign key to `user(id)`, not `users(id)`

## Skills

Three Claude Code skills live in `.claude/skills/` — install them globally once:

```bash
cp -r .claude/skills/coomander-create  ~/.claude/skills/
cp -r .claude/skills/coomander-sync    ~/.claude/skills/
cp -r .claude/skills/configure-sso   ~/.claude/skills/
```

**`/coomander-create`** — use to bootstrap a brand new project from the Coomander template. Interviews you for project name, description, and ports, then copies the template, customizes all branding and landing page copy, sets up Docker, generates env vars, runs migrations, and verifies the build. Dead simple.

**`/coomander-sync`** — use from any downstream project to pull Coomander improvements in. Runs parallel exploration, diffs both repos, presents a checklist, creates a GH issue and branch.

**`/configure-sso`** — use when setting up OAuth providers on a new deployment. Walks through Google, GitHub, Facebook, and Apple step-by-step, writing all credentials to `.env.local` automatically.

## OpenClaw Skills

Equivalent skills for [OpenClaw](https://github.com/marknutter/openclaw) live in `.openclaw/skills/` — install them globally once:

```bash
bash scripts/install-openclaw-skills.sh
```

Or manually:
```bash
cp -r .openclaw/skills/coomander-create  ~/.openclaw/skills/
cp -r .openclaw/skills/coomander-sync    ~/.openclaw/skills/
cp -r .openclaw/skills/configure-sso   ~/.openclaw/skills/
```

Same three skills, same workflows — adapted for OpenClaw's tool names (`read`/`write`/`edit`/`exec`/`browser`/`sessions_spawn`).

---

## AI Chatbot

Built-in AI chat with multi-provider models (Anthropic Claude + Cloudflare
Workers AI), voice I/O, file attachments, and conversation persistence.

**Chat is WebSocket-only.** It runs entirely on the agents Worker
(`apps/agents`) — the legacy SSE/POST `/api/chat` (and `chat-engine.ts` /
`chat-config.ts`) was removed in epic #203. Both web and mobile send turns over
the WebSocket; `GET /api/coomander/chat` only hydrates the thread on mount.

### Architecture

- **Chat brain (prompt + tools):** `apps/web/lib/coomander/coomanderChat.ts`
  exports `chatSystemPrompt`, `chatTools`, and `runCoomanderTool`. The agents
  Worker can't read the app DB, so it fetches the prompt + tool schemas per turn
  via `GET /api/coomander/agent-context` (and runs tools back over the web API).
- **Model engine:** the multi-provider Vercel AI SDK (`streamText`) path lives in
  `apps/agents/src/chat.ts` (turn loop) + `apps/agents/src/chat-model.ts`
  (provider wiring — `createAnthropic` for Claude/BYOK, `createWorkersAI` for the
  open `@cf/...` models, optional AI Gateway routing).
- **Shared model catalog:** `@coomander/core` (`packages/core/src/chat/`) — the
  single source of truth for catalog entries, lookups (`getModel`, `listModels`,
  `DEFAULT_MODEL_ID`), capability-gated message building, and context trimming.

### Choosing / configuring the model

Do NOT hardcode model ids — drive everything off the catalog + the resolution
chain (per-user preference > admin default > `CHAT_MODEL` env > `DEFAULT_MODEL_ID`):

- **Admins** set the default model and manage encrypted provider keys at
  **`/admin/ai-models`**.
- **Users** pick a per-user model in **`/settings`**.
- **Usage / cost** (per model + per user) is at **`/admin/ai-usage`** (reads AI
  Gateway metrics via the Cloudflare Analytics API).

To change the AI's personality, edit the prompt/tool builders in
`coomanderChat.ts` (served to the agent through `agent-context`) — not a static
config file. To add a model, append an entry to the catalog in `@coomander/core`.
See the dev wiki page `content/docs/dev/ai-models.mdx` for the full catalog,
provider-key, and AI Gateway details.

### Tag Extraction

The AI can include `[TAG:key=value]` tags in responses. Register handlers:

```ts
import { registerTagHandler } from "@/lib/chat-tags";

registerTagHandler("PROFILE", async (key, value, userId) => {
  await db.insert(profiles).values({ userId, key, value });
});
```

Tags are automatically stripped from the displayed response.

### Voice

- **STT**: Web Speech API (free, native browser) — no API key needed
- **TTS**: ElevenLabs (`ELEVENLABS_API_KEY`) — optional, text-only if unset
- Voice features degrade gracefully

### Key Files

- `apps/web/lib/coomander/coomanderChat.ts` — chat brain: `chatSystemPrompt`, `chatTools`, `runCoomanderTool`
- `apps/web/app/api/coomander/agent-context/route.ts` — serves the prompt + tools to the agent per turn
- `apps/agents/src/chat.ts` — WebSocket turn loop (streaming, tool-use, persistence)
- `apps/agents/src/chat-model.ts` — provider wiring (Anthropic + Workers AI via the Vercel AI SDK)
- `packages/core/src/chat/` — shared model catalog + message building (`@coomander/core`)
- `lib/chat-tags.ts` — Tag extraction and handler registry
- `lib/voice.ts` — VoiceService (Web Speech API + ElevenLabs TTS)
- `lib/use-voice.ts` — React hook for voice state
- `lib/document-parser.ts` — DOCX/XLSX/PPTX parsing
- `app/api/voice/speak/route.ts` — TTS proxy
- `app/app/chat/page.tsx` — Chat UI

---

## Changelog System

All significant changes to the template are recorded in `changelogs/` as individual markdown files with structured frontmatter. This enables AI agents in downstream projects to know exactly what's changed since they were created.

**Entry format:**
```markdown
---
date: 2026-03-25
scope: [node]                # stack(s) affected
category: feature            # feature | fix | security | breaking
files_changed: [...]         # key files to diff
requires_migration: false
requires_env_vars: [FOO]
breaking: false
---

## Title

Description of what changed.
```

**Sync cursor:** Each downstream project has a `.coomander-sync-cursor` file recording when it was created and last synced. Agents read this to filter changelog entries.

**When to add an entry:** After merging any functional change to main. One entry per PR/feature.

---

## Things to Never Do

- Import `lib/auth.ts` in client components (server-only)
- Module-level `new ServiceClient()` — use lazy init pattern
- Forget `export const dynamic = "force-dynamic"` on API routes
- Use `docker buildx` — use `DOCKER_BUILDKIT=0 docker build`
- Use Tailwind `<input>` without `text-gray-900 dark:text-gray-100`
- Use `useSearchParams()` without a `<Suspense>` boundary
- Import `fumadocs-ui` components in the admin wiki (use `fumadocs-core` only)
- Put Fumadocs `RootProvider` in the root layout (scoped to `/docs` only)
- Add features without updating the relevant dev wiki page in `content/docs/dev/`
