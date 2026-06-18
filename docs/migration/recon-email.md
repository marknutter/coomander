# Phase 2c Recon — Migrate transactional email from Resend to Cloudflare Email Service

Read-only recon. Reference repo: `~/Code/geology` (already migrated). Target: this
repo's `node/` tree, which becomes `apps/web/` *before* Phase 2c runs — so all paths
below are written as `apps/web/...`.

---

## 1. Exact target mechanism

**Cloudflare Email Service — Email Sending REST API.**

NOT the `send_email` Workers binding, NOT MailChannels, NOT Email Workers.

Geology sends transactional email by `fetch`-ing the Cloudflare REST endpoint:

```
POST https://api.cloudflare.com/client/v4/accounts/{CF_ACCOUNT_ID}/email/sending/send
Authorization: Bearer {CF_EMAIL_API_TOKEN}      # token w/ "Email Sending" permission
Content-Type: application/json
body: { to, from, subject, html, text?, headers? }
```

This matches the canonical endpoint in the `cloudflare-email-service` skill
(`SKILL.md` line 72). The REST path was deliberately chosen over the `send_email`
worker binding so the **same code works in local dev and in the deployed Worker**
(a binding only exists inside the Worker runtime; REST works everywhere).

### Resend is NOT fully removed in geology — it is RETAINED for marketing/bulk

This is the key nuance. Geology split email into two lanes:

| Lane | Mechanism | Functions |
|------|-----------|-----------|
| **Transactional** (verify, reset, welcome, lifetime, subscription confirm/cancel, payment failed, **waitlist invite**) | Cloudflare REST `deliver()` | all `send*Email()` in `lib/email.ts` |
| **Marketing / bulk campaigns** | **Resend** (kept) | `lib/broadcasts.ts` — `sendBroadcast`, `syncSubscribersToAudience`, `sendCampaignDirect`; plus the admin campaign preview route that uses `getResend().emails.send()` |

`resend` (`^4.0.0`), `react-email` (`^5.2.10`), `@react-email/components`
(`^1.0.11`) all **remain in geology's `package.json`**. `getResend()` and `FROM`
are still exported from `lib/email.ts`. Resend webhook analytics
(`RESEND_WEBHOOK_SECRET`, `/api/webhooks/resend`) also remain.

**Recommendation for this repo:** mirror geology — migrate the transactional
`send*Email()` functions to Cloudflare `deliver()`, but keep `resend` installed and
`getResend()`/`FROM` exported because `apps/web/lib/broadcasts.ts` and the admin
campaign/admin-user-email routes still call the Resend client directly. Do NOT rip
`resend` out wholesale; that would break broadcasts and admin tooling.

---

## 2. New `apps/web/lib/email.ts` API

Keep **every exported name identical** so no call site changes:
`getResend`, `APP_NAME`, `FROM`, `APP_URL`, `unsubscribeUrl`, and the eight
`send*Email()` functions. Add a private `deliver()` helper and route the eight
senders through it.

Differences from this repo's current `lib/email.ts`:
- Current code calls `getResend().emails.send(...)` directly inside each sender,
  wrapped in `try/catch`.
- New code calls `deliver({...})` instead. `deliver()` itself swallows errors and
  no-ops when unconfigured, so the per-function `try/catch` can be dropped (geology
  has none) — but keeping them is harmless.
- `getResend()` / `FROM` stay exported (broadcasts + admin routes need them).

### Implementation sketch (from geology, lines 35–66)

```ts
interface DeliverArgs {
  to: string;
  subject: string;
  html: string;
  text?: string;
  headers?: Record<string, string>;
}

async function deliver({ to, subject, html, text, headers }: DeliverArgs): Promise<void> {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_EMAIL_API_TOKEN;
  if (!accountId || !token) {
    console.log(`[email] not configured (CF_ACCOUNT_ID / CF_EMAIL_API_TOKEN); skipped send to ${to}: ${subject}`);
    return; // local dev + unconfigured envs no-op, never throw
  }
  try {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, from: FROM, subject, html, ...(text ? { text } : {}), ...(headers ? { headers } : {}) }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error(`[email] Cloudflare send failed (${res.status}) to ${to}: ${body.slice(0, 240)}`);
    } else {
      console.log(`[email] Cloudflare send ok (${res.status}) to ${to}: ${subject}`);
    }
  } catch (err) {
    console.error('[email] Cloudflare send error:', err);
  }
}
```

Each sender then mirrors geology, e.g.:

```ts
export async function sendVerificationEmail(email: string, url: string): Promise<void> {
  const html = await render(VerificationEmail({ appName: APP_NAME, appUrl: APP_URL, verificationUrl: url }));
  await deliver({ to: email, subject: `Verify your email — ${APP_NAME}`, html });
}
```

Waitlist/subscription/payment senders pass `headers: unsubscribeHeaders(token)`
when an unsubscribe token is supplied — `deliver()` forwards `headers` through to the
REST `body`, so `List-Unsubscribe` is preserved.

`getResend()` / `FROM` / `APP_NAME` / `APP_URL` / `unsubscribeUrl()` /
`unsubscribeHeaders()` stay exactly as-is.

---

## 3. wrangler config changes

This repo currently has `node/wrangler.toml` (TOML, like geology — not jsonc).

Because the migration uses the **REST API, not a binding**, NO `send_email` binding
is required. Geology's `wrangler.toml` has no `[[send_email]]` block. Changes:

- Add under `[vars]` (geology lines 46–47):
  ```toml
  CF_ACCOUNT_ID = "<your-cloudflare-account-id>"
  EMAIL_FROM = "Maddie <noreply@yourdomain>"
  ```
- `CF_EMAIL_API_TOKEN` is a **secret**, set via `wrangler secret put CF_EMAIL_API_TOKEN` — NOT in `wrangler.toml`.

### Compatibility flags
**No change needed.** Geology runs `compatibility_date = "2024-09-23"` +
`compatibility_flags = ["nodejs_compat"]`. The REST `fetch()` path needs nothing
beyond what's already present. (A `send_email` *binding* would have needed config,
but we're not using it.)

---

## 4. Env var changes + `.env.example`

This repo's `node/.env.example` currently has (lines 48–57):
```
# RESEND_API_KEY=re_...
# EMAIL_FROM=AppSeed <hello@yourdomain.com>
# RESEND_AUDIENCE_ID=aud_...
# RESEND_WEBHOOK_SECRET=whsec_...
```

**Add** (Cloudflare transactional — mirror geology .env.example lines 48–55):
```
# Transactional email — Cloudflare Email Service
# Onboard the sending domain first: dash -> Email Sending -> Onboard Domain
# (adds SPF/DKIM/DMARC/MX). EMAIL_FROM must be on that verified domain.
# CF_ACCOUNT_ID + EMAIL_FROM are set as wrangler [vars]; the token is a secret:
#   wrangler secret put CF_EMAIL_API_TOKEN   (API token with Email Sending perm)
# Leave CF_EMAIL_API_TOKEN unset in dev -> sends are logged/skipped, never error.
# CF_ACCOUNT_ID=
# CF_EMAIL_API_TOKEN=
# EMAIL_FROM=Maddie <noreply@yourdomain>
```

**Keep (do NOT remove)** — broadcasts/campaigns/analytics still use Resend:
```
# Marketing / bulk campaigns still use Resend (broadcasts, waitlist) — optional.
# RESEND_API_KEY=re_...
# RESEND_AUDIENCE_ID=aud_...
# RESEND_WEBHOOK_SECRET=whsec_...
```

**Remove:** nothing. (If a future decision drops Resend entirely, remove the three
`RESEND_*` lines and the broadcasts code — out of scope for Phase 2c.)

Net: `EMAIL_FROM` stays but its domain must move to the Cloudflare-onboarded domain;
`CF_ACCOUNT_ID` + `CF_EMAIL_API_TOKEN` are new.

---

## 5. Dependency changes

**Remove:** nothing (geology kept all three). `resend` (`^4.0.0`) stays — broadcasts
+ admin routes import it.

**Add:** nothing. Geology adds **no new npm dep** for Cloudflare email — it's a plain
`fetch()`. `@react-email/components` + `react-email` are already present for template
rendering.

> If the team later decides to fully retire Resend, that's a separate task:
> remove `resend` from package.json, rewrite `lib/broadcasts.ts`, and delete the
> `/api/webhooks/resend` route + admin campaign Resend paths. NOT part of Phase 2c.

---

## 6. Call sites to verify (all keep working unchanged)

Transactional senders — import from `@/lib/email`, names unchanged after migration:

1. `apps/web/lib/auth.ts:8,118,123,192` — Better Auth wiring:
   `sendPasswordResetEmail` (`sendResetPassword`), `sendVerificationEmail`
   (`sendVerificationEmail` hook), `sendWelcomeEmail` (after sign-up).
2. `apps/web/app/api/stripe/webhook/route.ts:6,54,73,119,142` —
   `sendLifetimePurchaseEmail`, `sendSubscriptionConfirmationEmail`,
   `sendSubscriptionCancelledEmail`, `sendPaymentFailedEmail`.
3. `apps/web/app/api/admin/waitlist/invite/route.ts:9` — `sendWaitlistInviteEmail`.
4. `apps/web/app/api/admin/users/[id]/reset-pw/route.ts:10` — `sendPasswordResetEmail`.

Resend-direct call sites — these MUST keep `getResend()` / `FROM` exported:

5. `apps/web/app/api/admin/users/[id]/email/route.ts:8,25` —
   `getResend().emails.send(...)` (admin sends a custom one-off email).
6. `apps/web/app/api/admin/campaigns/[id]/preview/route.ts:8,31` —
   `getResend().emails.send(...)` (campaign preview test send).
7. `apps/web/lib/broadcasts.ts` — `getResend()` + `FROM` for broadcasts,
   audience sync, batch campaign send.

Tests to update (assert new behavior, written by separate subagent per rules):

8. `apps/web/tests/email.test.ts` and `apps/web/tests/email-foundation.test.ts` —
   currently mock `Resend` and assert `getResend` is a function. After migration
   they should also cover `deliver()` no-op-when-unconfigured + REST fetch shape.
   Geology has analogous `tests/email-foundation.test.ts` to model against.

(Ignore `.next/standalone/**` and `.open-next/**` matches in grep output — build
artifacts, regenerated on build.)

---

## 7. Manual Cloudflare-side / DNS setup the USER must do

These cannot be automated from code — the user must do them in the Cloudflare dash
before any real transactional email sends (until done, `deliver()` no-ops and logs):

1. **Onboard the sending domain for Email Sending.**
   Dashboard → **Compute & AI → Email Service → Email Sending → Onboard Domain**
   (or `wrangler email sending enable <domain>`). Choose the domain that
   `EMAIL_FROM` will send from (e.g. `noreply@<yourdomain>`). The domain must be on
   Cloudflare (managed zone) so CF can add records automatically.
2. **Add the DNS records CF generates** — SPF (TXT), DKIM (CNAME/TXT), DMARC (TXT),
   and MX. If the zone is on Cloudflare these are added for you on onboarding;
   verify they're present and "verified" before sending. Sending from an
   un-onboarded/unverified domain is rejected.
3. **Create an API token with the "Email Sending" permission.**
   Dashboard → My Profile → API Tokens (account-scoped token, Email Sending: Edit).
   Then `wrangler secret put CF_EMAIL_API_TOKEN` for production, and put the same
   value in `.env.local` for any dev send testing (optional — unset = no-op).
4. **Set `CF_ACCOUNT_ID`** (account ID from the dash URL / `wrangler whoami`) and
   **`EMAIL_FROM`** (must be `something@<onboarded-domain>`) in `wrangler.toml`
   `[vars]`.
5. **Destination-address verification (sandbox caveat):** until the domain is fully
   out of sandbox, Cloudflare Email Sending may only deliver to **verified
   destination addresses**. The user must verify their own test recipient
   address(es) in the dash, or confirm the domain is production-approved, before
   broad sends work. (This is the most common "it silently didn't send" gotcha —
   call it out in the PR/QA.)
6. **(If keeping Resend for broadcasts)** no new action — existing `RESEND_*`
   secrets stay as-is.

---

## 8. Ordered task list for Phase 2c

> Prereq: this runs AFTER `node/` → `apps/web/`. All paths are `apps/web/...`.

1. Rewrite `apps/web/lib/email.ts`: add the private `deliver()` helper (REST
   `fetch` to `…/email/sending/send`, Bearer `CF_EMAIL_API_TOKEN`, no-op when
   unconfigured). Keep all exports (`getResend`, `FROM`, `APP_NAME`, `APP_URL`,
   `unsubscribeUrl`, `unsubscribeHeaders`, eight `send*Email`) — names unchanged.
2. Route all eight `send*Email()` functions through `deliver()` instead of
   `getResend().emails.send()`. Preserve `unsubscribeHeaders` passthrough on
   waitlist/subscription/payment senders.
3. Leave `apps/web/lib/broadcasts.ts` and the two admin Resend-direct routes
   (`admin/users/[id]/email`, `admin/campaigns/[id]/preview`) untouched — they keep
   using `getResend()` / `FROM`.
4. Update `apps/web/wrangler.toml` `[vars]`: add `CF_ACCOUNT_ID` and `EMAIL_FROM`
   (Cloudflare-onboarded domain). No `send_email` binding, no compat-flag change.
5. Update `apps/web/.env.example`: add the Cloudflare transactional block
   (`CF_ACCOUNT_ID`, `CF_EMAIL_API_TOKEN`, `EMAIL_FROM`); keep the `RESEND_*` block
   with a comment that it's marketing/bulk only.
6. Update `package.json`: no dep changes (resend + react-email stay). Confirm no
   accidental removal.
7. Update `apps/web/tests/email.test.ts` + `email-foundation.test.ts` (via a
   separate test subagent per repo rules) to cover `deliver()` no-op path + REST
   fetch shape; keep the existing `getResend`/Resend-mock coverage for broadcasts.
8. Run `npm run build` and the test suite; confirm green (no type errors).
9. Document the manual Cloudflare setup (Section 7) in the README / deploy doc
   (`docs/deploy/cloudflare-workers.md`), mirroring geology's `.env.example`
   comments and README "Cloudflare email" line.
10. Open the PR + a QA issue whose scenarios cover: dev no-op logging when token
    unset, real verification/reset/welcome send to a **verified destination
    address**, Stripe-webhook-triggered emails, waitlist invite with
    `List-Unsubscribe` header intact, and that broadcasts/admin campaign preview
    (still Resend) are unaffected.

---

## Notes / gaps

- **`appseed-sync` SKILL.md has NO email-migration coverage.** It documents schema
  splits, auth, etc., but nothing about the Resend→Cloudflare email change. Gap: a
  future sync of this template change into other downstream apps won't be guided by
  the skill. Consider a follow-up to add an email-migration note to the sync skill's
  feature checklist (out of scope for this recon).
- Geology proves the migration is low-risk: pure `fetch`, no new deps, same exports,
  graceful no-op in dev. The only real-world risk is the Cloudflare-side
  domain-onboarding + destination-verification (Section 7), which is manual and
  must be done before production sends actually deliver.
