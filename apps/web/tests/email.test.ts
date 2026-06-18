import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Intercept the Cloudflare Email transport ───────────────────────────────
//
// Email was migrated from Resend to Cloudflare Email Service (#374 / PR #383).
// lib/email.ts now has a three-tier sendEmail() transport:
//   1. Workers binding   (getCloudflareContext().env.EMAIL.send)
//   2. REST API          (fetch to the CF email/sending/send endpoint, used
//                         when CLOUDFLARE_ACCOUNT_ID + CF_EMAIL_API_TOKEN are set)
//   3. Console fallback   (dev mode, no provider configured)
//
// In the test runtime there is no Workers binding (getCloudflareContext()
// throws off-Workers, so tier 1 is skipped). We force the REST API path by
// setting the two env vars and stubbing global fetch — this exercises the real
// sendWelcomeEmail/etc. functions through the real transport while letting us
// assert the recipient, subject, and rendered HTML from the request body.

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acct_test");
  vi.stubEnv("CF_EMAIL_API_TOKEN", "tok_test");
  fetchMock.mockReset().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "",
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// Import after the transport interception is configured
import {
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSubscriptionConfirmationEmail,
} from "@/lib/email";

/** Parse the email payload from the most recent fetch (CF REST API body). */
function lastEmailPayload(): { to: string; subject: string; html: string } {
  const init = fetchMock.mock.calls[0][1] as { body: string };
  return JSON.parse(init.body);
}

describe("Email Functions", () => {
  describe("sendWelcomeEmail", () => {
    it("should send welcome email with correct parameters", async () => {
      await sendWelcomeEmail("user@test.com");

      expect(fetchMock).toHaveBeenCalledOnce();
      const call = lastEmailPayload();
      expect(call.to).toBe("user@test.com");
      expect(call.subject).toContain("Welcome");
      expect(call.html).toContain("Welcome");
      expect(call.html).toContain("Get started");
    });
  });

  describe("sendVerificationEmail", () => {
    it("should send verification email with the provided URL", async () => {
      const url = "https://example.com/verify?token=abc123";
      await sendVerificationEmail("user@test.com", url);

      expect(fetchMock).toHaveBeenCalledOnce();
      const call = lastEmailPayload();
      expect(call.to).toBe("user@test.com");
      expect(call.subject).toContain("Verify");
      expect(call.html).toContain(url);
      expect(call.html).toContain("Verify Email");
    });
  });

  describe("sendPasswordResetEmail", () => {
    it("should send password reset email with the provided URL", async () => {
      const url = "https://example.com/reset?token=xyz789";
      await sendPasswordResetEmail("user@test.com", url);

      expect(fetchMock).toHaveBeenCalledOnce();
      const call = lastEmailPayload();
      expect(call.to).toBe("user@test.com");
      expect(call.subject).toContain("Reset");
      expect(call.html).toContain(url);
      expect(call.html).toContain("Reset Password");
    });
  });

  describe("sendSubscriptionConfirmationEmail", () => {
    it("should send subscription confirmation with plan name", async () => {
      await sendSubscriptionConfirmationEmail("user@test.com", "Pro");

      expect(fetchMock).toHaveBeenCalledOnce();
      const call = lastEmailPayload();
      expect(call.to).toBe("user@test.com");
      expect(call.subject).toContain("Pro");
      expect(call.html).toContain("Pro");
      expect(call.html).toContain("Go to app");
    });
  });
});
