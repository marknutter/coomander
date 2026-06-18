---
date: 2026-06-18
scope: [node, infra]
category: breaking
files_changed:
  - apps/web/lib/email.ts
  - apps/web/lib/broadcasts.ts
  - apps/web/lib/email-tracking.ts
  - apps/web/app/api/email/open/route.ts
  - apps/web/app/api/email/click/route.ts
  - apps/web/app/api/admin/campaigns/[id]/send/route.ts
  - apps/web/app/api/admin/campaigns/[id]/preview/route.ts
  - apps/web/app/api/admin/users/[id]/email/route.ts
  - apps/web/wrangler.toml
  - apps/web/.env.example
  - apps/web/package.json
requires_migration: false
requires_env_vars: [EMAIL_FROM, CLOUDFLARE_ACCOUNT_ID, CF_EMAIL_API_TOKEN, EMAIL_TRACKING_SECRET]
breaking: true
---

## Email: migrate Resend → Cloudflare Email Service

Transactional and campaign email now send via Cloudflare Email Service. The
`resend` package is removed entirely.

### Transport (`lib/email.ts`)

`sendEmail()` three-tier fallback: (1) the `[[send_email]]` Workers binding
(`name = "EMAIL"`) in production — zero config; (2) the Cloudflare REST API
(`CLOUDFLARE_ACCOUNT_ID` + `CF_EMAIL_API_TOKEN`) off-Workers; (3) a console
fallback in dev that prints auth links so flows work with no provider. All
`send*Email()` exports keep identical signatures — zero call-site change.

### Campaigns + tracking

- `broadcasts.ts` `sendCampaignDirect()` sends individual CF emails (CF has no
  audience/contact/batch API). `sendBroadcast`/`syncSubscribersToAudience`
  removed; admin campaign send route uses the 4-arg signature.
- Self-hosted open/click tracking (`lib/email-tracking.ts` +
  `app/api/email/{open,click}`) with HMAC-signed per-recipient tokens — CF tracks
  delivery only. `EMAIL_TRACKING_SECRET` (falls back to `BETTER_AUTH_SECRET`).
- Removed the orphaned `app/api/webhooks/resend/route.ts` + `RESEND_AUDIENCE_ID`
  branch (CF is pull-based, no webhooks).

### Breaking

- `getResend()` is gone — use `sendEmail()` from `@/lib/email`.
- `resend` removed from `package.json`; `RESEND_*` env vars dropped.
- `wrangler.toml` needs `[[send_email]] name = "EMAIL"` + `EMAIL_FROM`.

### Operator setup

Onboard the sending domain at Cloudflare → Email → Email Sending (adds
SPF/DKIM/DMARC/MX), create an "Email Sending" API token
(`wrangler secret put CF_EMAIL_API_TOKEN`), and **verify destination addresses**
— in sandbox CF silently drops mail to unverified recipients.
