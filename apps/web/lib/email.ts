import { render } from '@react-email/components';
import WelcomeEmail from '@/emails/welcome';
import VerificationEmail from '@/emails/verification';
import PasswordResetEmail from '@/emails/password-reset';
import LifetimePurchaseEmail from '@/emails/lifetime-purchase';
import WaitlistInviteEmail from '@/emails/waitlist-invite';
import SubscriptionConfirmationEmail from '@/emails/subscription-confirmation';
import SubscriptionCancelledEmail from '@/emails/subscription-cancelled';
import PaymentFailedEmail from '@/emails/payment-failed';


export const APP_NAME = process.env.APP_NAME || 'Coomander';
export const FROM = process.env.EMAIL_FROM || `${APP_NAME} <noreply@YOUR_DOMAIN>`;
export const APP_URL = process.env.APP_URL || 'https://YOUR_DOMAIN';

export function unsubscribeUrl(token: string): string {
  return `${APP_URL}/api/unsubscribe?token=${encodeURIComponent(token)}`;
}

/** Build List-Unsubscribe headers for marketing emails (CAN-SPAM/GDPR). */
function unsubscribeHeaders(token: string): Record<string, string> {
  const url = unsubscribeUrl(token);
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

// ── Email Transport Layer ─────────────────────────────────────────────────────
//
// Cloudflare Email Service (migrated off Resend). Three-tier fallback:
//   1. Workers binding (env.EMAIL.send) — production on Cloudflare Workers.
//      Zero config, no API tokens — the binding handles auth automatically.
//   2. REST API — for non-Workers environments (Docker, VPS) where
//      CF_EMAIL_API_TOKEN + CLOUDFLARE_ACCOUNT_ID are set.
//   3. Console fallback — logs the email to stdout so auth links are visible
//      during local dev. No email provider needed.

interface SendEmailParams {
  from: string;
  to: string;
  subject: string;
  html: string;
  headers?: Record<string, string>;
}

/**
 * Resolve the Cloudflare Email Service `send_email` binding from the Workers
 * runtime context, or null if not running on Workers / binding not declared.
 *
 * Same dynamic-require pattern as lib/db.ts and lib/storage.ts.
 */
function resolveEmailBinding(): { send: (msg: SendEmailParams) => Promise<{ messageId: string }> } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getCloudflareContext } = require("@opennextjs/cloudflare");
    const ctx = getCloudflareContext();
    // The binding name matches [[send_email]] name = "EMAIL" in wrangler.toml
    return (ctx?.env?.EMAIL as { send: (msg: SendEmailParams) => Promise<{ messageId: string }> } | undefined) ?? null;
  } catch {
    return null;
  }
}

/**
 * Send an email via the Cloudflare REST API. Used when running outside of
 * Workers (Docker, VPS) with CF_EMAIL_API_TOKEN set.
 */
async function sendViaRestApi(params: SendEmailParams): Promise<{ messageId?: string }> {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const apiToken = process.env.CF_EMAIL_API_TOKEN;

  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CF_EMAIL_API_TOKEN required for REST API email sending");
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/email/sending/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: params.from,
        to: params.to,
        subject: params.subject,
        html: params.html,
        ...(params.headers ? { headers: params.headers } : {}),
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Cloudflare Email REST API error ${res.status}: ${body}`);
  }

  // The message id is used only for delivery correlation (never required). Its
  // exact location in the CF response can vary, so extract it best-effort from
  // the header or the v4 envelope.
  let messageId: string | undefined;
  try {
    const headerId = res.headers.get("x-message-id") ?? undefined;
    const body = (await res.json()) as {
      result?: { id?: string; message_id?: string };
      id?: string;
    };
    messageId = headerId || body?.result?.id || body?.result?.message_id || body?.id;
  } catch {
    // Empty or non-JSON body — leave messageId undefined.
  }
  return { messageId };
}

/**
 * Log the email to console. Used in dev when no email provider is configured.
 * Extracts and highlights URLs so auth links (verification, password reset)
 * are easy to find and click.
 */
function logToConsole(params: SendEmailParams): void {
  // Extract URLs from the HTML for easy copy-paste
  const urlMatches = params.html.match(/https?:\/\/[^\s"<]+/g) || [];
  const urlSection = urlMatches.length > 0
    ? `\n  📎 Links:\n${urlMatches.map(u => `     ${u}`).join('\n')}`
    : '';

  console.info(
    `[email] 📧 DEV MODE — email not sent (no provider configured)\n` +
    `  To:      ${params.to}\n` +
    `  From:    ${params.from}\n` +
    `  Subject: ${params.subject}` +
    urlSection
  );
}

/**
 * Send an email using the best available transport:
 *   1. Workers binding (production on CF Workers)
 *   2. REST API (non-Workers with CF_EMAIL_API_TOKEN)
 *   3. Console fallback (dev mode)
 */
export async function sendEmail(params: SendEmailParams): Promise<{ messageId?: string }> {
  // 1. Try Workers binding
  const binding = resolveEmailBinding();
  if (binding) {
    const result = await binding.send(params);
    return { messageId: result?.messageId };
  }

  // 2. Try REST API
  if (process.env.CF_EMAIL_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID) {
    return await sendViaRestApi(params);
  }

  // 3. Console fallback
  logToConsole(params);
  return {};
}

// ── Welcome Email ─────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(email: string): Promise<void> {
  try {
    const html = await render(WelcomeEmail({ appName: APP_NAME, appUrl: APP_URL }));
    await sendEmail({
      from: FROM,
      to: email,
      subject: `Welcome to ${APP_NAME} 👋`,
      html,
    });
  } catch (err) {
    console.error('[email] sendWelcomeEmail failed:', err);
  }
}

// ── Email Verification ────────────────────────────────────────────────────────

export async function sendVerificationEmail(email: string, url: string): Promise<void> {
  try {
    const html = await render(VerificationEmail({ appName: APP_NAME, appUrl: APP_URL, verificationUrl: url }));
    await sendEmail({
      from: FROM,
      to: email,
      subject: `Verify your email — ${APP_NAME}`,
      html,
    });
  } catch (err) {
    console.error('[email] sendVerificationEmail failed:', err);
  }
}

// ── Password Reset ────────────────────────────────────────────────────────────

export async function sendPasswordResetEmail(email: string, url: string): Promise<void> {
  try {
    const html = await render(PasswordResetEmail({ appName: APP_NAME, appUrl: APP_URL, resetUrl: url }));
    await sendEmail({
      from: FROM,
      to: email,
      subject: `Reset your password — ${APP_NAME}`,
      html,
    });
  } catch (err) {
    console.error('[email] sendPasswordResetEmail failed:', err);
  }
}

// ── Lifetime Purchase ────────────────────────────────────────────────────────

export async function sendLifetimePurchaseEmail(email: string): Promise<void> {
  try {
    const html = await render(LifetimePurchaseEmail({ appName: APP_NAME, appUrl: APP_URL }));
    await sendEmail({
      from: FROM,
      to: email,
      subject: `You're a lifetime member! 🎉 — ${APP_NAME}`,
      html,
    });
  } catch (err) {
    console.error('[email] sendLifetimePurchaseEmail failed:', err);
  }
}

// ── Waitlist Invite ──────────────────────────────────────────────────────────

export async function sendWaitlistInviteEmail(email: string, inviteCode: string, unsubscribeToken?: string): Promise<void> {
  try {
    const unsubUrl = unsubscribeToken ? unsubscribeUrl(unsubscribeToken) : undefined;
    const html = await render(WaitlistInviteEmail({
      appName: APP_NAME,
      appUrl: APP_URL,
      inviteCode,
      unsubscribeUrl: unsubUrl,
    }));
    await sendEmail({
      from: FROM,
      to: email,
      subject: `You're invited to ${APP_NAME}!`,
      html,
      ...(unsubscribeToken ? { headers: unsubscribeHeaders(unsubscribeToken) } : {}),
    });
  } catch (err) {
    console.error('[email] sendWaitlistInviteEmail failed:', err);
  }
}

// ── Subscription Confirmation ─────────────────────────────────────────────────

export async function sendSubscriptionConfirmationEmail(email: string, plan: string, unsubscribeToken?: string): Promise<void> {
  try {
    const unsubUrl = unsubscribeToken ? unsubscribeUrl(unsubscribeToken) : undefined;
    const html = await render(SubscriptionConfirmationEmail({
      appName: APP_NAME,
      appUrl: APP_URL,
      plan,
      unsubscribeUrl: unsubUrl,
    }));
    await sendEmail({
      from: FROM,
      to: email,
      subject: `You're on Pro 🎉 — ${APP_NAME}`,
      html,
      ...(unsubscribeToken ? { headers: unsubscribeHeaders(unsubscribeToken) } : {}),
    });
  } catch (err) {
    console.error('[email] sendSubscriptionConfirmationEmail failed:', err);
  }
}

// ── Subscription Cancelled ──────────────────────────────────────────────────

export async function sendSubscriptionCancelledEmail(email: string, unsubscribeToken?: string): Promise<void> {
  try {
    const unsubUrl = unsubscribeToken ? unsubscribeUrl(unsubscribeToken) : undefined;
    const html = await render(SubscriptionCancelledEmail({
      appName: APP_NAME,
      appUrl: APP_URL,
      unsubscribeUrl: unsubUrl,
    }));
    await sendEmail({
      from: FROM,
      to: email,
      subject: `Subscription cancelled — ${APP_NAME}`,
      html,
      ...(unsubscribeToken ? { headers: unsubscribeHeaders(unsubscribeToken) } : {}),
    });
  } catch (err) {
    console.error('[email] sendSubscriptionCancelledEmail failed:', err);
  }
}

// ── Payment Failed ──────────────────────────────────────────────────────────

export async function sendPaymentFailedEmail(email: string, unsubscribeToken?: string): Promise<void> {
  try {
    const unsubUrl = unsubscribeToken ? unsubscribeUrl(unsubscribeToken) : undefined;
    const html = await render(PaymentFailedEmail({
      appName: APP_NAME,
      appUrl: APP_URL,
      unsubscribeUrl: unsubUrl,
    }));
    await sendEmail({
      from: FROM,
      to: email,
      subject: `Payment failed — ${APP_NAME}`,
      html,
      ...(unsubscribeToken ? { headers: unsubscribeHeaders(unsubscribeToken) } : {}),
    });
  } catch (err) {
    console.error('[email] sendPaymentFailedEmail failed:', err);
  }
}
