/* eslint-disable react/no-children-prop -- React.createElement requires children in props
   here because the component interfaces declare `children` explicitly and TypeScript's
   newer overloads don't accept children as a positional third arg in that case. */
import { describe, it, expect } from "vitest";
import { render } from "@react-email/components";
import React from "react";
import { EmailLayout } from "@/emails/components/layout";
import { CtaButton } from "@/emails/components/cta-button";
import WelcomeEmail from "@/emails/welcome";
import VerificationEmail from "@/emails/verification";
import PasswordResetEmail from "@/emails/password-reset";
import LifetimePurchaseEmail from "@/emails/lifetime-purchase";
import WaitlistInviteEmail from "@/emails/waitlist-invite";
import SubscriptionConfirmationEmail from "@/emails/subscription-confirmation";
import SubscriptionCancelledEmail from "@/emails/subscription-cancelled";
import PaymentFailedEmail from "@/emails/payment-failed";

// ── Shared Layout ──────────────────────────────────────────────────────────────

describe("EmailLayout", () => {
  it("renders with emerald header (#10b981)", async () => {
    const html = await render(
      React.createElement(EmailLayout, { children: null,
        preview: "Test preview",
        appName: "TestApp",
        appUrl: "https://test.com",
      })
    );
    expect(html).toContain("#10b981");
    expect(html).toContain("TestApp");
  });

  it("includes unsubscribe link when unsubscribeUrl is provided", async () => {
    const html = await render(
      React.createElement(EmailLayout, { children: null,
        preview: "Test",
        unsubscribeUrl: "https://test.com/unsubscribe",
      })
    );
    expect(html).toContain("https://test.com/unsubscribe");
    expect(html).toContain("Unsubscribe");
  });

  it("omits unsubscribe link when unsubscribeUrl is not provided", async () => {
    const html = await render(
      React.createElement(EmailLayout, { children: null, preview: "Test" })
    );
    expect(html).not.toContain("Unsubscribe");
  });

  it("renders appUrl in footer", async () => {
    const html = await render(
      React.createElement(EmailLayout, { children: null,
        preview: "Test",
        appUrl: "https://myapp.io",
      })
    );
    expect(html).toContain("https://myapp.io");
  });
});

// ── CTA Button ─────────────────────────────────────────────────────────────────

describe("CtaButton", () => {
  it("renders with correct href", async () => {
    const html = await render(
      React.createElement(CtaButton, { href: "https://example.com/action", children: "Click Me" })
    );
    expect(html).toContain("https://example.com/action");
    expect(html).toContain("Click Me");
  });

  it("uses emerald background color", async () => {
    const html = await render(
      React.createElement(CtaButton, { href: "https://example.com", children: "Go" })
    );
    expect(html).toContain("#10b981");
  });
});

// ── Template: Welcome ──────────────────────────────────────────────────────────

describe("WelcomeEmail", () => {
  it("renders to HTML with app name and CTA", async () => {
    const html = await render(React.createElement(WelcomeEmail, { appName: "MyApp" }));
    expect(typeof html).toBe("string");
    expect(html).toContain("MyApp");
    expect(html).toContain("Welcome");
    expect(html).toContain("Get started");
  });

  it("uses default appName when none provided", async () => {
    const html = await render(React.createElement(WelcomeEmail));
    expect(html).toContain("Coomander");
  });

  it("links CTA to /app path", async () => {
    const html = await render(
      React.createElement(WelcomeEmail, { appUrl: "https://demo.com" })
    );
    expect(html).toContain("https://demo.com/app");
  });
});

// ── Template: Verification ─────────────────────────────────────────────────────

describe("VerificationEmail", () => {
  it("renders to HTML with verify button", async () => {
    const html = await render(React.createElement(VerificationEmail));
    expect(typeof html).toBe("string");
    expect(html).toContain("Verify");
    expect(html).toContain("Verify Email");
  });

  it("includes custom verificationUrl in CTA", async () => {
    const url = "https://myapp.com/verify?token=abc123";
    const html = await render(
      React.createElement(VerificationEmail, { verificationUrl: url })
    );
    expect(html).toContain(url);
  });

  it("mentions 24 hour expiry", async () => {
    const html = await render(React.createElement(VerificationEmail));
    expect(html).toContain("24 hours");
  });
});

// ── Template: Password Reset ───────────────────────────────────────────────────

describe("PasswordResetEmail", () => {
  it("renders to HTML with reset button", async () => {
    const html = await render(React.createElement(PasswordResetEmail));
    expect(typeof html).toBe("string");
    expect(html).toContain("Reset");
    expect(html).toContain("Reset Password");
  });

  it("includes custom resetUrl in CTA", async () => {
    const url = "https://myapp.com/reset?token=xyz789";
    const html = await render(
      React.createElement(PasswordResetEmail, { resetUrl: url })
    );
    expect(html).toContain(url);
  });

  it("mentions 1 hour expiry", async () => {
    const html = await render(React.createElement(PasswordResetEmail));
    expect(html).toContain("1 hour");
  });
});

// ── Template: Lifetime Purchase ────────────────────────────────────────────────

describe("LifetimePurchaseEmail", () => {
  it("renders to HTML with lifetime messaging", async () => {
    const html = await render(React.createElement(LifetimePurchaseEmail));
    expect(typeof html).toBe("string");
    expect(html).toContain("lifetime");
    expect(html).toContain("Lifetime Deal");
    expect(html).toContain("Go to app");
  });

  it("includes custom appName", async () => {
    const html = await render(
      React.createElement(LifetimePurchaseEmail, { appName: "SuperApp" })
    );
    expect(html).toContain("SuperApp");
  });

  it("mentions no recurring payments", async () => {
    const html = await render(React.createElement(LifetimePurchaseEmail));
    expect(html).toContain("one-time purchase");
  });
});

// ── Template: Waitlist Invite ──────────────────────────────────────────────────

describe("WaitlistInviteEmail", () => {
  it("renders to HTML with invite messaging", async () => {
    const html = await render(React.createElement(WaitlistInviteEmail));
    expect(typeof html).toBe("string");
    expect(html).toContain("invited");
    expect(html).toContain("Accept Invite");
  });

  it("includes invite code in body", async () => {
    const html = await render(
      React.createElement(WaitlistInviteEmail, { inviteCode: "SPECIAL99" })
    );
    expect(html).toContain("SPECIAL99");
  });

  it("builds signup URL with invite code", async () => {
    const html = await render(
      React.createElement(WaitlistInviteEmail, {
        appUrl: "https://myapp.com",
        inviteCode: "TEST123",
      })
    );
    expect(html).toContain("https://myapp.com/auth?tab=signup&amp;invite=TEST123");
  });

  it("passes unsubscribeUrl to layout", async () => {
    const html = await render(
      React.createElement(WaitlistInviteEmail, {
        unsubscribeUrl: "https://myapp.com/unsub",
      })
    );
    expect(html).toContain("https://myapp.com/unsub");
    expect(html).toContain("Unsubscribe");
  });
});

// ── Template: Subscription Confirmation ────────────────────────────────────────

describe("SubscriptionConfirmationEmail", () => {
  it("renders to HTML with plan name", async () => {
    const html = await render(React.createElement(SubscriptionConfirmationEmail));
    expect(typeof html).toBe("string");
    expect(html).toContain("Pro");
    expect(html).toContain("Go to app");
  });

  it("includes custom plan name in body", async () => {
    const html = await render(
      React.createElement(SubscriptionConfirmationEmail, { plan: "Enterprise" })
    );
    expect(html).toContain("Enterprise");
  });

  it("includes app name", async () => {
    const html = await render(
      React.createElement(SubscriptionConfirmationEmail, { appName: "CoolApp" })
    );
    expect(html).toContain("CoolApp");
  });
});

// ── Template: Subscription Cancelled ───────────────────────────────────────────

describe("SubscriptionCancelledEmail", () => {
  it("renders to HTML with cancellation messaging", async () => {
    const html = await render(React.createElement(SubscriptionCancelledEmail));
    expect(typeof html).toBe("string");
    expect(html).toContain("cancelled");
    expect(html).toContain("Resubscribe");
  });

  it("links resubscribe CTA to billing page", async () => {
    const html = await render(
      React.createElement(SubscriptionCancelledEmail, { appUrl: "https://demo.com" })
    );
    expect(html).toContain("https://demo.com/app/billing");
  });

  it("mentions free features still available", async () => {
    const html = await render(React.createElement(SubscriptionCancelledEmail));
    expect(html).toContain("free features");
  });
});

// ── Template: Payment Failed ───────────────────────────────────────────────────

describe("PaymentFailedEmail", () => {
  it("renders to HTML with payment failed messaging", async () => {
    const html = await render(React.createElement(PaymentFailedEmail));
    expect(typeof html).toBe("string");
    expect(html).toContain("Payment failed");
    expect(html).toContain("Update Payment");
  });

  it("links update payment CTA to billing page", async () => {
    const html = await render(
      React.createElement(PaymentFailedEmail, { appUrl: "https://demo.com" })
    );
    expect(html).toContain("https://demo.com/app/billing");
  });

  it("mentions contacting card issuer", async () => {
    const html = await render(React.createElement(PaymentFailedEmail));
    expect(html).toContain("card issuer");
  });
});
