# Coomander

Coomander — a Next.js app deployed on Cloudflare Workers + D1 + R2.

Production: <https://coomander.com>
Dev (tailnet): <https://coomander.gate-cardassian.ts.net>
Dev (local):   <http://localhost:3005>

## Quick start

```bash
cd node
cp .env.example .env.local      # fill in BETTER_AUTH_SECRET, etc.
npm install
npm run db:migrate              # local SQLite at node/data/coomander.db
npm run dev                     # http://localhost:3005
```

## Docker (local dev)

Single dev mode — Caddy + Tailscale sidecar fronts Next dev on the tailnet so the iPhone can hit a real HTTPS URL.

```bash
docker compose build
docker compose up -d
docker compose logs -f
docker compose down
```

The sidecar joins the tailnet as `${TS_HOSTNAME}` (default `coomander`) and serves HTTPS at `https://coomander.<your-tailnet>.ts.net`. Same `next dev` process is reachable via `localhost:3005` on the Mac.

### Refreshing dev container dependencies

After a `package.json` change:

```bash
docker compose run --rm app-dev npm install
```

If `node_modules` gets fully wedged:

```bash
docker compose down
docker volume rm coomander_node_modules
docker compose up
```

### Resetting a dev password

Better Auth stores password hashes — there's no default admin account. To set a known password on any user:

```bash
docker compose exec app-dev \
  node scripts/reset-password.mjs <email> <new-password>
```

The script uses Better Auth's own `hashPassword` so the stored hash is compatible. Dev only — never run against production.

## Remote dev (phone QA via Tailscale)

Access the dev container from your phone (or any tailnet device) over real HTTPS. No public exposure, no port forwarding, no ngrok. Apple HSTS-preloads `*.ts.net`, so plain HTTP is rejected by iOS Safari — the Tailscale ACME cert is the only path that works.

### One-time setup

1. Install [Tailscale](https://tailscale.com) on the Mac and on your phone; sign in to the same account.
2. Get a reusable auth key at <https://login.tailscale.com/admin/settings/keys>.
3. Create `.env` at the project root:
   ```
   TS_AUTHKEY=tskey-auth-...
   TS_HOSTNAME=coomander
   DEV_PORT=3005
   APP_URL=https://coomander.gate-cardassian.ts.net
   ```
4. `docker compose up -d`

The sidecar registers as an ephemeral tailnet node, provisions a real TLS cert, and reverse-proxies `:443` → Next dev on `127.0.0.1:3000`.

### iOS DNS gotcha

If the tailnet hostname doesn't resolve on iPhone: open the Tailscale iOS app → profile avatar → Settings → toggle **Use Tailscale DNS Settings** on. Also disable iCloud Private Relay (Settings → Apple ID → iCloud → Private Relay) — it routes DNS through Apple's proxy and breaks tailnet resolution. Quit Safari fully (swipe away in app switcher) after toggling to drop stale cached failures.

### OAuth callback URLs

OAuth providers (Google, GitHub, etc.) need both URLs allow-listed:

- `https://coomander.com/api/auth/callback/<provider>` — production
- `https://coomander.gate-cardassian.ts.net/api/auth/callback/<provider>` — tailnet dev

Set up via `/configure-sso` — it knows about both.

## Local Telegram dev (per-developer bot + Cloudflare Tunnel)

Coomander's Telegram inbound is **webhook-based** (`POST /api/coomander/webhook`), and **Telegram allows exactly one webhook URL per bot.** Production's `@coomander_bot` already owns it (→ `https://coomander.com/api/coomander/webhook`). So to use Telegram against *your* local dev server — the bot replying, and the **Connect Telegram** link flow — you run **your own dev bot** plus a **persistent Cloudflare Tunnel** to your machine.

> Optional. Skip this entirely for normal dev — `docker compose up` works without it; only outbound features that *send* Telegram need a token, and inbound needs this tunnel.

### One-time setup

1. **Create a dev bot.** In Telegram, message [@BotFather](https://t.me/BotFather) → `/newbot` → name it (e.g. `Coomander Dev (you)`), username e.g. `coomander_dev_you_bot`. Save the **bot token** and the **@username**.

2. **Create a Cloudflare named tunnel** (free; uses the existing `coomander.com` zone). In the [Zero Trust dashboard](https://one.dash.cloudflare.com) → **Networks → Tunnels → Create a tunnel** → *Cloudflared*:
   - Name it `coomander-dev-<you>`; copy the **tunnel token**.
   - Add a **Public Hostname**: subdomain `dev-<you>`, domain `coomander.com`, **Path** `api/coomander/webhook`, Service `HTTP` → `localhost:3000`. (Path-scoping keeps the rest of your dev server private; the catch-all stays a 404.)

3. **Set env vars.**
   - Repo-root `.env` (compose interpolation): `CLOUDFLARE_TUNNEL_TOKEN=<tunnel token>`
   - `apps/web/.env.local`:
     ```bash
     MADDIE_TELEGRAM_BOT_TOKEN=<your dev bot token>
     MADDIE_TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 24)
     COOMANDER_BOT_USERNAME=coomander_dev_you_bot         # so the Connect link points at YOUR dev bot
     TELEGRAM_WEBHOOK_URL=https://dev-you.coomander.com/api/coomander/webhook
     ```

### Each session

```bash
# from apps/web — starts the normal stack PLUS the cloudflared sidecar
npm run docker:dev:telegram          # = docker compose --profile dev --profile telegram up --build

# register your dev bot's webhook at your tunnel (one-time per bot, or after changing the URL)
npm run telegram:webhook -- set --yes
npm run telegram:webhook -- info     # verify: url + 0 pending + no last_error
```

The `set` command prints the resolved bot `@username` first and **requires `--yes`** — a guard so you can't accidentally repoint prod's `@coomander_bot` (verify the username is your dev bot before confirming).

Then open the app (localhost:3005 or the tailnet URL), go to the home/onboarding **Connect Telegram** card → tap the deep link (or send the code) to **your dev bot** → it links your local user. Now pings and replies flow through your machine.

### Notes

- **One webhook per bot** is why each developer needs their own bot — two people can't point the same bot at two tunnels.
- `npm run telegram:webhook -- delete` clears your dev bot's webhook (e.g. before stepping away).
- Never put `COOMANDER_TELEGRAM_DISABLED` in `.env.local` — it bakes into the prod bundle.

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `BETTER_AUTH_SECRET` | Yes | ≥32 chars; `openssl rand -base64 32`. Set on CF via `wrangler secret put`. |
| `BETTER_AUTH_URL` | Yes | Public URL of the app (Better Auth uses for callbacks). |
| `APP_URL` | Yes | Same as above; used in emails and Stripe redirects. |
| `APP_NAME` | No | Display name; defaults to `Coomander`. |
| `DATABASE_PATH` | Local dev only | SQLite file path; defaults to `./data/coomander.db`. Ignored on CF (D1 binding takes over). |
| `RESEND_API_KEY` | If using email | Transactional email via Resend. |
| `STRIPE_SECRET_KEY` | If using payments | Stripe API key. |
| `STRIPE_PRICE_ID` | If using payments | Subscription price ID. |
| `STRIPE_WEBHOOK_SECRET` | If using payments | Webhook signature verification. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | If using Google SSO | OAuth credentials. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | If using GitHub SSO | OAuth credentials. |
| `ANTHROPIC_API_KEY` | If using AI chat | Claude API for the chat surface. |
| `ELEVENLABS_API_KEY` | If using voice | ElevenLabs TTS (optional — chat falls back to text). |
| `MADDIE_TELEGRAM_BOT_TOKEN` | If using Telegram | Bot token from @BotFather. Prod = `@coomander_bot`; local dev = your own dev bot (see "Local Telegram dev"). |
| `MADDIE_TELEGRAM_WEBHOOK_SECRET` | If using Telegram inbound | Secret echoed on the inbound webhook; `openssl rand -hex 24`. |
| `COOMANDER_BOT_USERNAME` | No | @username (no @) for the Connect-Telegram deep link; defaults to `coomander_bot`. Set to your dev bot's username in local dev. |
| `TELEGRAM_WEBHOOK_URL` | Local Telegram dev | Public webhook URL used by `npm run telegram:webhook -- set` (your Cloudflare Tunnel host + `/api/coomander/webhook`). |
| `CLOUDFLARE_TUNNEL_TOKEN` | Local Telegram dev | Token for the `cloudflared` sidecar; goes in the repo-root `.env`. See "Local Telegram dev". |
| `CAMPAIGN_BATCH_SIZE` | No | Recipients per email-campaign send batch (queue message / job); defaults to `50`. See [Email Marketing (Campaigns)](/docs/dev/email-marketing). |
| `STUCK_CAMPAIGN_MINUTES` | No | Minutes a campaign can sit in `sending` with no progress before the reconciler marks it `failed`; defaults to `60`. |

Local: put these in `node/.env.local` (gitignored). Production: `npx wrangler secret put VAR_NAME`.

## Project structure

```
coomander/
├── node/                  # Next.js app (the only stack)
│   ├── app/               # App Router pages + API routes
│   ├── components/        # React components
│   ├── lib/               # Auth, DB, email, Stripe, errors
│   ├── content/           # Blog/docs (MDX)
│   ├── migrations/        # SQLite/D1 schema migrations
│   └── wrangler.toml      # Cloudflare Workers config
├── tailscale/Caddyfile    # Caddy + tsnet config for the dev sidecar
├── docker-compose.yml     # Local dev (single profile-less stack)
├── legacy/                # Pre-AppSeed coomander, archived
├── CLAUDE.md              # AI assistant instructions
└── AGENTS.md              # → points to this README (feature docs live here)
```

## Cloudflare Workers deploy

The Node app deploys to Cloudflare Workers + D1 + R2 via `@opennextjs/cloudflare`.

### Routine deploy

```bash
cd node
npm run build:cf
npm run deploy:cf
```

~20s end-to-end. Bindings (`DB`, `STORAGE`, `ASSETS`) wire automatically via `getCloudflareContext()` — no `instrumentation.ts` needed.

### When to do what

| Change | Run |
|---|---|
| Code only | `npm run build:cf && npm run deploy:cf` |
| New SQL migration | `npx wrangler d1 migrations apply coomander-db --remote`, then deploy |
| New secret | `npx wrangler secret put VAR_NAME` (no redeploy needed; secrets hot-reload) |
| New non-secret env var | Edit `wrangler.toml [vars]`, then deploy |
| New D1/R2/KV binding | Edit `wrangler.toml`, deploy |
| Promote a user to admin | `npx wrangler d1 execute coomander-db --remote --command "UPDATE user SET isAdmin = 1 WHERE email = 'you@example.com'"` |
| First deploy after this doc — campaign send queue | `wrangler queues create coomander-campaign-send` (see [Email Marketing (Campaigns)](/docs/dev/email-marketing)) |

### Sanity checks

```bash
curl -sS https://coomander.com/api/health
# Expected: {"ok":true,"db":true,"auth":true,"timestamp":"..."}

npx wrangler tail --format=pretty
```

### Local Workers preview

To repro Workers-specific bugs that don't surface in `next dev`:

```bash
npm run build:cf
npm run preview:cf      # local D1 emulator on 127.0.0.1:8787
npx wrangler d1 migrations apply coomander-db --local   # one-time
```

## Where each piece lives

- `node/wrangler.toml` — bindings, vars, compatibility flags
- `node/open-next.config.ts` — OpenNext adapter config
- `node/lib/db.ts` — D1 / SQLite driver resolver
- `node/lib/storage.ts` — R2 / S3 / local-fs storage resolver
- `node/migrations/*.sql` — schema migrations (lexical order; `000_better_auth_init.sql` creates auth tables)
- `node/content/docs/dev/cloudflare-workers-compat.mdx` — Workers compatibility audit

---

## What's already built (feature reference)

**Coomander is a production-ready Next.js SaaS starter.** Its entire purpose is to eliminate the infrastructure boilerplate that every web app needs. **Do not reimplement anything listed here — it is already done.**

### ⚡ Quick reference: don't build these, they're already here

| You need… | Use this instead |
|---|---|
| User sign up / sign in / sign out | `authClient` from `@/lib/auth-client` |
| OAuth (Google, GitHub) | Already configured in `lib/auth.ts` |
| Two-factor authentication (TOTP) | `authClient.twoFactor.*` — fully wired |
| Email verification | Automatic on signup via Better Auth hook |
| Password reset flow | `authClient.requestPasswordReset()` + `/forgot-password` page |
| Session check in API route | `auth.api.getSession({ headers: request.headers })` |
| Session check in middleware | `getSessionCookie()` from `better-auth/cookies` |
| SQLite database | `getDb()` from `@/lib/db` |
| Sending email | `sendWelcomeEmail`, `sendVerificationEmail`, etc. in `@/lib/email` |
| Stripe checkout | `POST /api/stripe/create-checkout` |
| Stripe billing portal | `GET /api/stripe/portal` |
| User subscription status | `GET /api/stripe/status` |
| Button, Input, Modal, Card… | `@/components/ui` — full component library |
| Toast notifications | `useToast()` from `@/lib/use-toast` |
| Dark mode | `useTheme()` from `@/lib/theme` — already in layout |
| Command palette | Already mounted in layout via `CommandPaletteProvider` |
| Blog / MDX content | `getAllPosts()`, `getPostBySlug()` from `@/lib/mdx` |
| Error responses | `BadRequestError`, `UnauthorizedError`, etc. from `@/lib/errors` |
| Structured logging | `logger` from `@/lib/logger` |
| Rate limiting | `rateLimit()` from `@/lib/rate-limit` |
| Route protection | Middleware already guards `/app/*` and `/settings/*` |
| Database backups | Litestream sidecar in docker-compose (prod) |
| Customer-facing docs | `/docs` — Fumadocs-powered, content in `content/docs/guide/` |
| API reference | `/api-docs` — Scalar, auto-generated from route JSDoc |
| Dev wiki (admin) | `/admin/docs` — fumadocs-core headless, content in `content/docs/dev/` |
| Create a new project from Coomander | `/coomander-create` skill (Claude Code or OpenClaw) |
| Sync Coomander updates into a project | `/coomander-sync` skill (Claude Code or OpenClaw) |
| Configure OAuth providers | `/configure-sso` skill (Claude Code or OpenClaw) |

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS v4 (PostCSS) |
| Database | SQLite via `better-sqlite3` |
| Auth | Better Auth (email/password + OAuth + 2FA) |
| Email | Resend |
| Payments | Stripe (hosted checkout + webhooks) |
| Icons | `lucide-react` |
| DB Replication | Litestream (continuous SQLite backup to S3/R2) |
| Testing | Vitest (unit) + Playwright (E2E) |

## Authentication

### What's already implemented
- Email/password signup + login
- Google OAuth + GitHub OAuth with account linking
- Two-factor authentication (TOTP — Google Authenticator, Authy, 1Password)
- Email verification (sent automatically on signup)
- Password reset (forgot-password → email link → reset form)
- Session cookies (httpOnly, secure, managed by Better Auth)
- Route protection via middleware for `/app/*` and `/settings/*`

### Session check in API routes
```ts
import { auth } from "@/lib/auth";

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response("Unauthorized", { status: 401 });

  const userId = session.user.id;
  const userEmail = session.user.email;
  const plan = session.user.plan; // "free" | "pro"
  // ...
}
```

### Client-side auth
```ts
import { authClient } from "@/lib/auth-client";

// Sign up
await authClient.signUp.email({ email, password, name });

// Sign in
await authClient.signIn.email({ email, password });

// OAuth
await authClient.signIn.social({ provider: "google", callbackURL: "/app" });

// Sign out
await authClient.signOut();

// Get session
const { data: session } = await authClient.getSession();

// 2FA
await authClient.twoFactor.enable({ password });
await authClient.twoFactor.verifyTotp({ code });
```

### User object shape (from session)
```ts
{
  id: string;          // UUID
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  plan: "free" | "pro";
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: "inactive" | "active" | "past_due" | null;
}
```

## Database

### Adding a new table
Add migration SQL files to `migrations/` — numbered and prefixed:
```sql
-- migrations/002_create_widgets.sql
-- UP
CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_widgets_user_id ON widgets(user_id);

-- DOWN
DROP TABLE IF EXISTS widgets;
```

Run migrations: `npm run db:migrate`

### Using the database
```ts
import { getDb } from "@/lib/db";

const db = getDb();

// Prepared statements (preferred)
const stmt = db.prepare("SELECT * FROM widgets WHERE user_id = ?");
const widgets = stmt.all(userId);

// One-off
const widget = db.prepare("SELECT * FROM widgets WHERE id = ?").get(id);
```

### Schema — Better Auth tables (auto-created, do not modify)
```
user         — accounts with custom fields: plan, stripeCustomerId, stripeSubscriptionId, subscriptionStatus
session      — active sessions
account      — OAuth provider links
verification — email verification tokens
twoFactor    — TOTP secrets and backup codes
```

### Schema — App tables
```
items        — example CRUD table (rename/replace for your use case)
_migrations  — migration tracker (do not touch)
```

> **Important:** Foreign keys to users must reference `user(id)` (singular), not `users(id)`. Better Auth uses the singular `user` table name.

> **Backups:** In production, Litestream runs as a Docker Compose sidecar and continuously replicates the SQLite database to S3-compatible storage. See `litestream.yml` and `docs/DEPLOYMENT.md` for setup. Restore with `bash scripts/litestream-restore.sh`.

## Email

### What's already implemented
```ts
// All in lib/email.ts
sendWelcomeEmail(email: string)
sendVerificationEmail(email: string, url: string)
sendPasswordResetEmail(email: string, url: string)
sendSubscriptionConfirmationEmail(email: string, plan: string)
```

### Adding a new email
Add a new function to `lib/email.ts` using the existing pattern:
```ts
export async function sendYourEmail(email: string, data: YourData) {
  const resend = getResend();
  if (!resend) return; // Resend not configured — skip gracefully

  await resend.emails.send({
    from: `${APP_NAME} <noreply@${YOUR_DOMAIN}>`,
    to: email,
    subject: "Your subject",
    html: wrapEmail(`<p>Your content here</p>`),
  });
}
```

## Payments (Stripe)

### What's already implemented
- Subscription checkout (`POST /api/stripe/create-checkout`)
- Stripe billing portal (`GET /api/stripe/portal`)
- Subscription status (`GET /api/stripe/status`)
- Webhook handler (`POST /api/stripe/webhook`) — handles:
  - `checkout.session.completed` → sets user plan to `"pro"`
  - `customer.subscription.updated` → updates subscription status
  - `customer.subscription.deleted` → reverts to `"free"`
  - `invoice.payment_failed` → sets status to `"past_due"`

### Triggering checkout from the frontend
```ts
const res = await fetch("/api/stripe/create-checkout", { method: "POST" });
const { url } = await res.json();
window.location.href = url; // Stripe hosted checkout
```

### Checking user plan
```ts
// In API route
const session = await auth.api.getSession({ headers: request.headers });
if (session?.user.plan !== "pro") {
  return new Response("Upgrade required", { status: 403 });
}

// In client component
const res = await fetch("/api/stripe/status");
const { plan, subscriptionStatus } = await res.json();
```

## UI component library

The UI layer is **shadcn/ui-based**: Radix primitives + Tailwind v4, with components copied into `components/ui/` (no runtime dep on a component package). Styled with semantic tokens (`bg-primary`, `text-muted-foreground`, etc.) — never hardcode color classes like `bg-emerald-600`. See `content/docs/dev/theming.mdx` for the full token reference.

### Legacy controlled APIs (preserved for backward compat)

These are wrappers around the new Radix primitives. Existing code keeps working:

```ts
import {
  Button,        // variant: "primary" | "secondary" | "danger" | "ghost", size: "sm" | "md" | "lg"
  Input,         // styled text input
  Modal,         // dialog with open/close — wraps shadcn Dialog
  Card,          // container card
  Badge,         // status badge with variants
  Avatar,        // user avatar with sizes
  Alert,         // feedback alert with variants
  Tabs,          // tab navigation with TabPanel — wraps Radix Tabs
  TabPanel,
  DropdownMenu,  // dropdown with items array — wraps Radix DropdownMenu
  Table,         // data table with Column definitions
  Skeleton,
  SkeletonText,
  SkeletonCard,
  SkeletonTableRow,
  SkeletonFormField,
} from "@/components/ui";
```

### Shadcn-style compound primitives (preferred for new code)

```ts
import {
  // Dialog (focus trap, scroll lock, inert background, Esc to close)
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,

  // Tabs (roving tabindex, arrow key nav)
  TabsRoot, TabsList, TabsTrigger, TabsContent,

  // DropdownMenu (keyboard nav, collision-aware positioning, submenus)
  DropdownMenuRoot, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuShortcut,

  // Toast (Sonner-backed)
  Toaster,

  // Command palette (cmdk-backed, used by CommandPaletteProvider)
  Command, CommandDialog, CommandInput, CommandList, CommandGroup, CommandItem, CommandEmpty,
} from "@/components/ui";
```

### New primitive capabilities (added via #238)

```ts
import {
  // Click-triggered overlay
  Popover, PopoverTrigger, PopoverContent,

  // Delayed-open hint (wrap your app in TooltipProvider once)
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,

  // Native-feel select with typeahead
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,

  // Destructive confirmation with `alertdialog` ARIA role
  AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogHeader,
  AlertDialogTitle, AlertDialogDescription, AlertDialogFooter,
  AlertDialogAction, AlertDialogCancel,
} from "@/components/ui";
```

Live examples of the new primitives: `app/admin/ui-showcase/page.tsx`.

### Class composition

Use `cn()` from `@/lib/utils` (clsx + tailwind-merge) when composing className strings — it resolves Tailwind utility conflicts correctly:

```ts
import { cn } from "@/lib/utils";

<button className={cn("px-4 py-2 bg-primary", isActive && "ring-2 ring-ring", className)}>
```

The legacy `@/lib/cn` import path also works (it re-exports from `@/lib/utils`).

### Toast notifications

```ts
import { toast } from "@/lib/use-toast";

toast.success("Saved!");
toast.error("Something went wrong.");
toast.info("Check your email.");
toast.warning("Action required.");
toast.success("Persistent", { duration: 0 });
toast.success("With action", {
  action: { label: "Undo", onClick: handleUndo },
});
```

Toasts render via Sonner — make sure `<ToastContainer />` (or `<Toaster />`) is mounted once in `app/layout.tsx`.

### Theme / dark mode
```ts
import { useTheme } from "@/lib/theme";

const { theme, resolvedTheme, setTheme } = useTheme();
// resolvedTheme is always "light" or "dark"
// setTheme accepts "light" | "dark" | "system"
```

### Command palette
Register commands from anywhere using `lib/commands.ts`:
```ts
import { registerCommand, unregisterCommand } from "@/lib/commands";

useEffect(() => {
  registerCommand({
    id: "my-command",
    label: "Do Something",
    shortcut: "⌘S",
    action: () => doSomething(),
  });
  return () => unregisterCommand("my-command");
}, []);
```

## Blog / MDX

Content lives in `content/blog/*.mdx` and `content/changelog/changelog.mdx`.

### Frontmatter schema for blog posts
```yaml
---
title: "Post Title"
date: "2026-02-22"
excerpt: "One sentence description."
author: "Your Name"
tags: ["tag1", "tag2"]
published: true
---
```

### Available utilities
```ts
import { getAllPosts, getPostBySlug, getAllTags, getChangelog } from "@/lib/mdx";
```

### Available MDX components
- `<Callout type="info|warning|tip">` — styled callout box
- All HTML elements are styled by default (headings, code blocks, tables, etc.)

## API route pattern

Every API route that uses the database or any service must include:
```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

Standard API route structure:
```ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { UnauthorizedError, BadRequestError, errorResponse } from "@/lib/errors";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new UnauthorizedError();

    const db = getDb();
    const data = db.prepare("SELECT * FROM items WHERE user_id = ?").all(session.user.id);

    return NextResponse.json({ data });
  } catch (error) {
    logger.error("GET /api/your-route failed", { error });
    return errorResponse(error);
  }
}
```

## Documentation

Coomander has a built-in three-tier documentation system:

### Customer-facing docs (`/docs`)

Powered by Fumadocs. Content lives in `content/docs/guide/` as `.mdx` files with frontmatter.

```ts
// Source loader
import { docsSource } from "@/lib/docs-source";
```

- Sidebar navigation auto-generated from `meta.json` files
- Built-in search via Orama at `/api/docs-search`
- Dark mode synced with Coomander theme
- To add a page: create `content/docs/guide/your-page.mdx` and add it to `meta.json`

### API reference (`/api-docs`)

Interactive Scalar UI auto-generated from an OpenAPI spec.

- `next-openapi-gen` scans route handlers for `@openapi` JSDoc annotations
- Spec generated at `public/openapi.json` during prebuild
- Only routes with explicit `@openapi` annotations appear (internal routes excluded via `ignoreRoutes` in `openapi-gen.config.json`)
- To document a new public endpoint: add a `@openapi` JSDoc block above the handler
- Regenerate: `npm run generate:openapi`

### Dev wiki (`/admin/docs`)

Admin-only wiki using fumadocs-core headless with custom UI. Content lives in `content/docs/dev/`.

```ts
// Source loader
import { devDocsSource } from "@/lib/dev-docs-source";
```

- Custom sidebar matching admin panel zinc/emerald styling
- `[[wiki-links]]` syntax for cross-referencing between pages (backlinks displayed at bottom)
- Auth-protected search at `/api/wiki-search`
- **Agents should read the dev wiki before reading source code** — it provides structured context more efficiently

### Documentation as a requirement

Documentation is a deliverable alongside code and tests. When adding or changing features:

1. Update the relevant dev wiki page in `content/docs/dev/`
2. If the feature is user-facing, update or create a customer docs page in `content/docs/guide/`
3. If adding a public API endpoint, add `@openapi` JSDoc to the route handler
4. If a wiki page doesn't exist for the area you're working in, create one

### Documentation key files

| File | Purpose |
|------|---------|
| `source.config.ts` | Fumadocs content collection definitions |
| `lib/docs-source.ts` | Customer docs page tree loader |
| `lib/dev-docs-source.ts` | Dev wiki page tree loader |
| `lib/wiki-backlinks.ts` | `[[wiki-link]]` parser and reverse index |
| `app/docs/layout.tsx` | Customer docs layout (Fumadocs UI + RootProvider) |
| `app/docs/[[...slug]]/page.tsx` | Customer docs page renderer |
| `app/admin/docs/layout.tsx` | Dev wiki layout (custom UI) |
| `app/admin/docs/[[...slug]]/page.tsx` | Dev wiki page renderer |
| `app/api/docs-search/route.ts` | Customer docs search endpoint |
| `app/api/wiki-search/route.ts` | Dev wiki search endpoint (admin-only) |
| `app/api-docs/page.tsx` | Scalar API reference UI |
| `openapi-gen.config.json` | OpenAPI generator config |

## File structure

```
app/
  page.tsx                    — landing page (all 8 sections)
  layout.tsx                  — root layout: ThemeProvider, CommandPalette, Toast, CookieConsent
  globals.css                 — Tailwind v4 import + custom animations
  (auth)/
    auth/page.tsx             — login/signup/2FA (uses authClient)
    forgot-password/page.tsx
    reset-password/page.tsx
    verify-email/page.tsx
  (protected)/
    app/page.tsx              — dashboard (requires auth via middleware)
    settings/page.tsx         — profile, security, billing, data export
  docs/
    layout.tsx                — Fumadocs docs layout (RootProvider)
    [[...slug]]/page.tsx      — customer docs page renderer
  api-docs/
    page.tsx                  — Scalar API reference UI
  blog/
    page.tsx                  — blog index
    [slug]/page.tsx           — individual post with MDX rendering
  changelog/page.tsx
  privacy-policy/page.tsx
  terms/page.tsx
  sitemap.ts                  — auto-generated sitemap.xml
  robots.ts                   — robots.txt
  opengraph-image.tsx         — auto-generated OG image (Satori)
  feed.xml/route.ts           — RSS feed
  api/
    auth/[...all]/route.ts    — Better Auth catch-all (DO NOT MODIFY)
    health/route.ts           — GET /api/health → { ok, db, timestamp }
    items/route.ts            — GET list, POST create
    items/[id]/route.ts       — GET, PUT, DELETE
    settings/account/         — GET user account info
    settings/delete-account/  — POST delete account
    settings/export/          — POST export user data
    stripe/create-checkout/   — POST create checkout session
    stripe/webhook/           — POST webhook handler
    stripe/portal/            — GET billing portal link
    stripe/status/            — GET subscription status

lib/
  auth.ts                     — Better Auth server config (DO NOT IMPORT IN CLIENT CODE)
  auth-client.ts              — Better Auth client (safe for React components)
  db.ts                       — SQLite getDb() lazy init
  email.ts                    — Resend email functions
  stripe.ts                   — Stripe getStripe() lazy init
  theme.tsx                   — ThemeProvider + useTheme hook
  use-toast.ts                — toast() global API + useToast hook
  commands.ts                 — command palette registry
  mdx.ts                      — blog post loader
  errors.ts                   — AppError subclasses + errorResponse()
  logger.ts                   — structured logger
  rate-limit.ts               — sliding-window rate limiter
  cn.ts                       — clsx/twMerge utility

components/
  ui/                         — full component library (see above)
  landing/
    header.tsx                — sticky landing page header
    faq.tsx                   — accordion FAQ
  onboarding.tsx              — first-visit wizard
  cookie-consent.tsx          — GDPR cookie consent banner
  mdx-components.tsx          — styled MDX components

content/
  blog/                       — .mdx blog posts
  changelog/changelog.mdx     — versioned changelog
  docs/
    guide/                    — customer-facing docs (.mdx)
    dev/                      — dev wiki (.mdx, [[wiki-links]])

migrations/
  001_create_items.sql        — example migration (UP + DOWN sections)

middleware.ts                  — protects /app/* and /settings/* via session cookie
```

## Critical rules

### 1. Lazy-init all service clients
```ts
// ✅ CORRECT
let _openai: OpenAI | null = null;
export function getOpenAI() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _openai;
}

// ❌ WRONG — breaks Next.js static build
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
```
Applies to every service client: OpenAI, Anthropic, Plaid, etc.
Exception: `betterAuth()` in `lib/auth.ts` is module-level by design.

### 2. `force-dynamic` + `nodejs` on all API routes
```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
```

### 3. Foreign keys reference `user(id)` not `users(id)`
Better Auth uses the singular `user` table.

### 4. Input text color
Always add `text-gray-900 dark:text-gray-100` to `<input>` elements — Tailwind has no default text color and inputs can appear invisible.

### 5. `useSearchParams()` needs a Suspense boundary
```tsx
export default function Page() {
  return (
    <Suspense fallback={<Spinner />}>
      <PageContent />  {/* useSearchParams() is here */}
    </Suspense>
  );
}
```

### 6. Docker build — disable BuildKit
```bash
DOCKER_BUILDKIT=0 docker build -t myapp .
```
BuildKit hangs on Alpine metadata fetch.

### 7. Dockerfile file permissions
```dockerfile
COPY --from=builder --chown=nextjs:nodejs /app/.next ./.next
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
```
Without `--chown`, static assets return 500.

### 8. Stripe API version
Must match between `lib/stripe.ts` (`2025-02-24.acacia`) and your Stripe dashboard webhook settings.

### 9. Trim and lowercase emails
```ts
const normalized = email.trim().toLowerCase();
```

### 10. camelCase for custom user fields in SQL
Better Auth stores custom user fields as camelCase:
```ts
// ✅ stripeCustomerId, subscriptionStatus
// ❌ stripe_customer_id, subscription_status
```

## Common mistakes

1. Reimplementing auth — use `authClient` / `auth.api.getSession()`
2. Building a custom toast — use `useToast()` from `@/lib/use-toast`
3. Building a custom theme toggle — use `useTheme()` from `@/lib/theme`
4. Module-level `new ServiceClient()` — always lazy init
5. Missing `force-dynamic` + `runtime` on API routes
6. Querying `users` table — Better Auth uses `user` (singular)
7. Forgetting `text-gray-900` on input fields
8. Using `useSearchParams()` without Suspense
9. Using BuildKit for Docker builds
10. Missing `--chown` in Dockerfile COPY commands
11. Not trimming/lowercasing email inputs
12. Committing `.env` — always keep in `.gitignore`
13. Missing `STRIPE_WEBHOOK_SECRET` — the webhook route will 500

## Creating a new project from Coomander

### Claude Code skill (recommended)

If using Claude Code, an `/coomander-create` skill is included that automates the entire bootstrapping workflow:

1. Interviews you for project name, one-line description, target directory, and ports
2. Copies the template (excluding .git, node_modules, build artifacts)
3. Customizes all core config (package.json, env vars, database paths, theme storage keys, Docker)
4. Generates product-specific landing page copy (hero, features, pricing, FAQ, testimonials, OG image, metadata)
5. Cleans up template content (removes example CRUD, resets changelog/blog)
6. Runs npm install, database migrations, and verifies the build
7. Initializes a fresh git repo with an initial commit

**Install once:**
```bash
cp -r /path/to/coomander/.claude/skills/coomander-create ~/.claude/skills/
```

Then from any directory:
```
/coomander-create
```

The skill file lives at `.claude/skills/coomander-create/SKILL.md` in this repo.

### OpenClaw skill (alternative)

If using OpenClaw instead of Claude Code, an equivalent `/coomander-create` skill is included:

**Install once:**
```bash
bash scripts/install-openclaw-skills.sh
```

Then from any OpenClaw session:
```
/coomander-create
```

The skill file lives at `.openclaw/skills/coomander-create/SKILL.md` in this repo.

### Manual setup

If not using Claude Code:

```bash
# 1. Copy the template
rsync -a --exclude='.git' --exclude='node_modules' --exclude='.next' --exclude='data/' \
  ~/Kode/coomander/ ~/Kode/my-new-app/
cd ~/Kode/my-new-app

# 2. Update package.json name
# 3. Create .env.local (generate BETTER_AUTH_SECRET with: openssl rand -base64 32)
# 4. Find-and-replace "Coomander"/"coomander" in all files
# 5. Update ports in Dockerfile, docker-compose.yml
# 6. Customize landing page copy
# 7. npm install && npm run db:migrate && npm run build
# 8. git init && git add -A && git commit -m "Initial project"
```

### What needs customization

| Category | Files | What to change |
|---|---|---|
| **Core config** | `package.json` | `name` field |
| | `.env.local` (create) | Auth secret, URLs, ports, app name |
| | `.env.example` | Default URLs and paths |
| **Database paths** | `lib/db.ts`, `lib/auth.ts`, `scripts/migrate.ts`, `scripts/seed.ts`, `scripts/rollback.ts` | Default DATABASE_PATH (`coomander.db` → `slug.db`) |
| **App name defaults** | `lib/auth.ts`, `lib/email.ts`, `lib/mdx.ts` | APP_NAME fallback strings |
| **Theme storage keys** | `lib/theme.tsx`, `app/layout.tsx`, `app/(protected)/app/page.tsx` | `"coomander-theme"` → `"slug-theme"` (4 locations) |
| **Other storage keys** | `components/cookie-consent.tsx`, `components/onboarding.tsx` | `"coomander-cookie-consent"`, `"coomander-onboarding-completed"` |
| **Fallback URLs** | `app/page.tsx`, `app/layout.tsx`, `app/sitemap.ts`, `app/robots.ts`, `app/feed.xml/route.ts` | `"coomander.dev"` → your domain |
| **Export filenames** | `app/settings/page.tsx`, `app/api/settings/export/route.ts` | `"coomander-export-"` prefix |
| **Landing page** | `app/page.tsx` | All copy: hero, features, pricing, FAQ, testimonials, footer, JSON-LD |
| | `components/landing/header.tsx` | Logo text |
| | `components/landing/faq.tsx` | FAQ content |
| | `app/opengraph-image.tsx` | Brand name, headline, subtitle |
| **Auth pages** | `app/(auth)/auth/page.tsx`, `forgot-password/`, `reset-password/`, `verify-email/` | Brand text and metadata descriptions |
| **Protected pages** | `app/(protected)/app/page.tsx`, `app/layout.tsx`, `settings/page.tsx`, `settings/layout.tsx` | Brand text and metadata descriptions |
| **Blog/changelog** | `app/blog/page.tsx`, `app/blog/[slug]/page.tsx`, `app/changelog/page.tsx` | Brand text, metadata, subtitles |
| **Legal pages** | `app/privacy-policy/page.tsx`, `app/terms/page.tsx` | Header brand, metadata |
| **Docker** | `docker-compose.yml`, `Dockerfile` | Container names, ports, volume names, DATABASE_PATH |
| **Content** | `content/changelog/`, `content/blog/` | Reset changelog, remove example posts |
| **Docs** | `PROJECT.md`, `AGENTS.md`, `CLAUDE.md`, `docs/DEPLOYMENT.md` | Coomander → your app name |
| **Tests** | `e2e/auth.spec.ts` | Title assertions |

## Extending the template

### Adding a new data model
1. Create `migrations/NNN_create_yourmodel.sql` with UP/DOWN sections
2. Run `npm run db:migrate`
3. Create API routes in `app/api/yourmodel/`
4. Add UI components if needed

### Adding a new OAuth provider
Add to `lib/auth.ts` in the `socialProviders` section:
```ts
discord: {
  clientId: process.env.DISCORD_CLIENT_ID || "",
  clientSecret: process.env.DISCORD_CLIENT_SECRET || "",
},
```

Also add it to `account.accountLinking.trustedProviders` and add a button in `app/auth/page.tsx`'s `SOCIAL_PROVIDERS` array (providers already included: Google, GitHub, Apple, Facebook).

### Configuring OAuth providers (getting the actual credentials)

The four built-in SSO providers each require different steps to obtain credentials:

| Provider  | Automation level | Method |
|-----------|-----------------|--------|
| Google    | Semi-automated | Browser-guided (3-minute walkthrough) |
| GitHub    | Semi-automated | Browser-guided (2-minute walkthrough) |
| Facebook  | Semi-automated | Browser-guided (~5 minutes) |
| Apple     | Mostly guided  | Browser for setup, automated JWT generation |

**If using Claude Code** — use the `/configure-sso` skill. It handles detection, automation, and guided walkthroughs for all four providers, writing credentials to `.env.local` automatically.

Install once:
```bash
cp -r /path/to/coomander/.claude/skills/configure-sso ~/.claude/skills/
```

Then from any downstream project:
```
/configure-sso
```

**If using OpenClaw** — the same skill is available. Install with `bash scripts/install-openclaw-skills.sh`, then use `/configure-sso` from any OpenClaw session. Uses OpenClaw's `browser` tool for automation instead of Chrome DevTools MCP.

**Apple-specific note:** `APPLE_CLIENT_SECRET` is a JWT that expires every 180 days. Set a calendar reminder to regenerate it — run `/configure-sso` and select Apple, or re-run the JWT generation step manually.

### Adding a new email
Add a function to `lib/email.ts` using `getResend()` and the `wrapEmail()` helper.

### Adding commands to the command palette
Use `registerCommand()` from `@/lib/commands` inside a `useEffect` in any component.

### Adding a blog post
Create `content/blog/your-slug.mdx` with the required frontmatter fields.

## Syncing updates from Coomander into a downstream project

Coomander is a **template, not a library** — there's no `npm update` to pull in new features. When Coomander ships improvements (new components, security fixes, better patterns), downstream projects need to port them manually. Here's the recommended agent workflow.

### When to sync

Check Coomander for updates when:
- Starting a significant new feature (make sure you're not about to reinvent something)
- Coomander has shipped a new phase of work (check `/changelog` or `content/changelog/changelog.mdx`)
- You notice a pattern in your project that feels like solved infrastructure

### Claude Code skill (recommended)

If using Claude Code, an `/coomander-sync` skill is included in this repo that automates the entire workflow below — parallel exploration, diff, interactive checklist, GH issue creation, and branch setup.

**Install once:**
```bash
cp -r /path/to/coomander/.claude/skills/coomander-sync ~/.claude/skills/
```

Then from any downstream project:
```
/coomander-sync
```

The skill file lives at `.claude/skills/coomander-sync/SKILL.md` in this repo.

**OpenClaw alternative:** Run `bash scripts/install-openclaw-skills.sh` once, then use `/coomander-sync` from any OpenClaw session. The skill lives at `.openclaw/skills/coomander-sync/SKILL.md`.

### Manual agent workflow

If not using Claude Code, run two exploration agents in parallel — one on Coomander, one on your project — then diff and port:

```
Step 1: Explore both repos simultaneously
  Agent A: Map everything in Coomander (lib/, components/, app/, migrations/)
  Agent B: Map the current state of the downstream project (same directories)

Step 2: Diff the two inventories
  - What exists in Coomander that doesn't exist in the project?
  - What exists in both but Coomander's version is meaningfully better?
  - What Coomander features are irrelevant to this project? (skip those)

Step 3: Create a GH issue outlining the sync work
  - List each item to port with a brief rationale
  - Note any items that need adaptation (different DB schema, different naming, etc.)

Step 4: Create a branch + PR, implement the ports one at a time
  - Commit after each ported feature
  - Run `npm run build` before opening the PR
```

### What's usually worth porting

| Category | Port it? | Notes |
|---|---|---|
| `lib/errors.ts` | ✅ Always | Standardized error classes save a lot of boilerplate |
| `lib/logger.ts` | ✅ Always | Structured logging is immediately useful |
| `lib/rate-limit.ts` | ✅ Usually | Critical for any public-facing auth routes |
| `components/ui/*` | ✅ Usually | Port the components you'll actually use |
| Toast / theme system | ✅ Usually | Already wired up, trivial to add |
| Cookie consent | ✅ If public-facing | Required for GDPR compliance |
| Command palette | ⚠️ Optional | Useful for power users, skip if not needed |
| Blog / MDX system | ⚠️ Optional | Only if the project needs a blog |
| Onboarding flow | ⚠️ Optional | Good for complex apps, overkill for simple ones |
| SEO infrastructure | ✅ If public-facing | sitemap, robots, OG images, metadata |
| Auth system | ⚠️ Careful | If already custom auth, migration is a significant undertaking |
| DB migrations | ⚠️ Adapt | Port the pattern, not the schema — your tables will differ |

### What to check in Coomander

- **`README.md`** (this file) — authoritative list of what's been built
- **`content/changelog/changelog.mdx`** — versioned history of changes
- **`/changelog`** — rendered changelog page
- **GitHub commits/PRs** — `git log --oneline` on the Coomander repo for recent work

### Adapting rather than copy-pasting

Most Coomander code ports cleanly, but watch for:
- **Table/column names** — Coomander uses `user(id)` and camelCase custom fields. If your project predates Better Auth, schema mapping may be needed.
- **Environment variable names** — Coomander uses `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`. Older projects may use `JWT_SECRET`, `APP_URL`, etc.
- **Import paths** — Coomander uses `@/lib/...` and `@/components/...`. Verify your `tsconfig.json` `paths` match.
- **Tailwind version** — Coomander uses Tailwind v4. Projects on v3 will need to adapt class names and the config format.
