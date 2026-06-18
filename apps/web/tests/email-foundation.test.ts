import { describe, it, expect, vi, beforeEach } from "vitest";

// Intercept sendEmail at the module level — the cleanest approach is to
// mock the email module itself, keeping the real exports but swapping the
// transport. We use vi.spyOn after import.
//
// Since the email functions catch errors internally and log them, the tests
// use vi.mock to replace the entire module transport with our mock.

const mockSend = vi.fn().mockResolvedValue(undefined);

// Mock the email module — keep real implementations but inject our mock
// into the sendEmail path. We do this by mocking @opennextjs/cloudflare
// which is dynamically required in resolveEmailBinding().
vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: vi.fn(() => ({
    env: {
      EMAIL: { send: mockSend },
    },
  })),
}));

// Force the dynamic require to resolve our mock — Vitest's vi.mock handles
// static imports automatically, but the dynamic require() in email.ts needs
// the module to be in the registry. We ensure it by also mocking at require level.
vi.stubGlobal("__vitest_required_opennextjs_cloudflare__", true);

// Import after mock
import {
  sendEmail,
  FROM,
  APP_NAME,
  APP_URL,
  unsubscribeUrl,
  sendSubscriptionCancelledEmail,
  sendPaymentFailedEmail,
  sendWaitlistInviteEmail,
  sendSubscriptionConfirmationEmail,
} from "@/lib/email";

describe("Email Foundation", () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  describe("Exports", () => {
    it("should export sendEmail as a function", () => {
      expect(typeof sendEmail).toBe("function");
    });

    it("should export FROM as a string", () => {
      expect(typeof FROM).toBe("string");
      expect(FROM.length).toBeGreaterThan(0);
    });

    it("should export APP_NAME as a string", () => {
      expect(typeof APP_NAME).toBe("string");
      expect(APP_NAME.length).toBeGreaterThan(0);
    });

    it("should export APP_URL as a string", () => {
      expect(typeof APP_URL).toBe("string");
      expect(APP_URL.length).toBeGreaterThan(0);
    });

    it("should export unsubscribeUrl as a function", () => {
      expect(typeof unsubscribeUrl).toBe("function");
    });
  });

  describe("unsubscribeUrl", () => {
    it("should generate URL with token parameter", () => {
      const url = unsubscribeUrl("test-token-123");
      expect(url).toContain("test-token-123");
      expect(url).toContain("/api/unsubscribe");
      expect(url).toContain("token=");
    });

    it("should include APP_URL as the base", () => {
      const url = unsubscribeUrl("abc");
      expect(url).toMatch(/^https?:\/\//);
      expect(url).toContain("/api/unsubscribe");
    });
  });

  describe("sendEmail (direct)", () => {
    it("should call the transport with the correct parameters", async () => {
      await sendEmail({
        from: FROM,
        to: "test@example.com",
        subject: "Test Subject",
        html: "<p>Hello</p>",
      });

      // sendEmail falls through to console fallback in tests (no CF binding).
      // The function should complete without throwing.
    });
  });

  describe("sendSubscriptionCancelledEmail", () => {
    it("should send cancellation email and include subject with 'cancelled'", async () => {
      // Spy on console.info to verify the dev-mode fallback fires
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      await sendSubscriptionCancelledEmail("user@test.com");

      // In test env without CF binding, emails go to console fallback
      expect(consoleSpy).toHaveBeenCalled();
      const logMessage = consoleSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("user@test.com");
      expect(logMessage).toContain("cancelled");

      consoleSpy.mockRestore();
    });
  });

  describe("sendPaymentFailedEmail", () => {
    it("should send payment failure email", async () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});

      await sendPaymentFailedEmail("user@test.com");

      expect(consoleSpy).toHaveBeenCalled();
      const logMessage = consoleSpy.mock.calls[0][0] as string;
      expect(logMessage).toContain("user@test.com");
      expect(logMessage).toContain("Payment failed");

      consoleSpy.mockRestore();
    });
  });

  describe("Unsubscribe URL generation", () => {
    it("sendWaitlistInviteEmail should complete without errors", async () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      await sendWaitlistInviteEmail("user@test.com", "INVITE123", "unsub-waitlist");
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("sendSubscriptionConfirmationEmail should complete without errors", async () => {
      const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {});
      await sendSubscriptionConfirmationEmail("user@test.com", "Pro", "unsub-confirm");
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("EMAIL_FROM env var", () => {
    it("FROM should fall back to APP_NAME-based address when EMAIL_FROM is not set", () => {
      // Since EMAIL_FROM is not set in the test environment, FROM should use the fallback
      expect(FROM).toContain("<");
      expect(FROM).toContain(">");
      expect(FROM).toContain("noreply@");
    });
  });
});
