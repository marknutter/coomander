import { Resend } from 'resend';
import { render } from '@react-email/components';
import WelcomeEmail from '@/emails/welcome';
import VerificationEmail from '@/emails/verification';
import PasswordResetEmail from '@/emails/password-reset';
import LifetimePurchaseEmail from '@/emails/lifetime-purchase';
import WaitlistInviteEmail from '@/emails/waitlist-invite';
import SubscriptionConfirmationEmail from '@/emails/subscription-confirmation';
import SubscriptionCancelledEmail from '@/emails/subscription-cancelled';
import PaymentFailedEmail from '@/emails/payment-failed';

let _resend: Resend | null = null;
export function getResend() {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

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

// ── Welcome Email ─────────────────────────────────────────────────────────────

export async function sendWelcomeEmail(email: string): Promise<void> {
  try {
    const html = await render(WelcomeEmail({ appName: APP_NAME, appUrl: APP_URL }));
    await getResend().emails.send({
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
    await getResend().emails.send({
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
    await getResend().emails.send({
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
    await getResend().emails.send({
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
    await getResend().emails.send({
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
    await getResend().emails.send({
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
    await getResend().emails.send({
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
    await getResend().emails.send({
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
