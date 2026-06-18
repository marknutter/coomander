import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockSend = vi.fn().mockResolvedValue({ id: "test-email-id" });

// Mock Resend before importing — use a class so `new Resend()` works
vi.mock("resend", () => {
  return {
    Resend: class MockResend {
      emails = { send: mockSend };
    },
  };
});

// Import after mock
import {
  getResend,
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
    it("should export getResend as a function", () => {
      expect(typeof getResend).toBe("function");
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

  describe("sendSubscriptionCancelledEmail", () => {
    it("should send cancellation email with correct parameters", async () => {
      await sendSubscriptionCancelledEmail("user@test.com");

      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe("user@test.com");
      expect(call.subject.toLowerCase()).toContain("cancelled");
      expect(call.from).toBe(FROM);
    });

    it("should include resubscribe CTA in the HTML", async () => {
      await sendSubscriptionCancelledEmail("user@test.com");

      const call = mockSend.mock.calls[0][0];
      expect(call.html).toBeDefined();
      // Should have some call-to-action for resubscribing
      expect(call.html.toLowerCase()).toMatch(/resubscribe|re-subscribe|renew|restart/);
    });

    it("should include unsubscribe headers when token is provided", async () => {
      await sendSubscriptionCancelledEmail("user@test.com", "unsub-token-123");

      const call = mockSend.mock.calls[0][0];
      expect(call.headers).toBeDefined();
      expect(call.headers["List-Unsubscribe"]).toBeDefined();
      expect(call.headers["List-Unsubscribe"]).toContain("unsub-token-123");
      expect(call.headers["List-Unsubscribe-Post"]).toBeDefined();
      expect(call.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    });

    it("should not include unsubscribe headers when no token is provided", async () => {
      await sendSubscriptionCancelledEmail("user@test.com");

      const call = mockSend.mock.calls[0][0];
      // Either no headers or no List-Unsubscribe header
      if (call.headers) {
        expect(call.headers["List-Unsubscribe"]).toBeUndefined();
      }
    });
  });

  describe("sendPaymentFailedEmail", () => {
    it("should send payment failure email with correct parameters", async () => {
      await sendPaymentFailedEmail("user@test.com");

      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe("user@test.com");
      expect(call.subject).toContain("Payment failed");
      expect(call.from).toBe(FROM);
    });

    it("should include update payment CTA in the HTML", async () => {
      await sendPaymentFailedEmail("user@test.com");

      const call = mockSend.mock.calls[0][0];
      expect(call.html).toBeDefined();
      // Should have some call-to-action for updating payment
      expect(call.html.toLowerCase()).toMatch(/update.*payment|payment.*method|billing/);
    });

    it("should include unsubscribe headers when token is provided", async () => {
      await sendPaymentFailedEmail("user@test.com", "unsub-token-456");

      const call = mockSend.mock.calls[0][0];
      expect(call.headers).toBeDefined();
      expect(call.headers["List-Unsubscribe"]).toBeDefined();
      expect(call.headers["List-Unsubscribe"]).toContain("unsub-token-456");
      expect(call.headers["List-Unsubscribe-Post"]).toBeDefined();
      expect(call.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    });

    it("should not include unsubscribe headers when no token is provided", async () => {
      await sendPaymentFailedEmail("user@test.com");

      const call = mockSend.mock.calls[0][0];
      if (call.headers) {
        expect(call.headers["List-Unsubscribe"]).toBeUndefined();
      }
    });
  });

  describe("Unsubscribe headers on marketing emails", () => {
    it("sendWaitlistInviteEmail includes unsubscribe headers with token", async () => {
      await sendWaitlistInviteEmail("user@test.com", "INVITE123", "unsub-waitlist");

      const call = mockSend.mock.calls[0][0];
      expect(call.headers).toBeDefined();
      expect(call.headers["List-Unsubscribe"]).toBeDefined();
      expect(call.headers["List-Unsubscribe"]).toContain("unsub-waitlist");
      expect(call.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    });

    it("sendWaitlistInviteEmail omits unsubscribe headers without token", async () => {
      await sendWaitlistInviteEmail("user@test.com", "INVITE123");

      const call = mockSend.mock.calls[0][0];
      if (call.headers) {
        expect(call.headers["List-Unsubscribe"]).toBeUndefined();
      }
    });

    it("sendSubscriptionConfirmationEmail includes unsubscribe headers with token", async () => {
      await sendSubscriptionConfirmationEmail("user@test.com", "Pro", "unsub-confirm");

      const call = mockSend.mock.calls[0][0];
      expect(call.headers).toBeDefined();
      expect(call.headers["List-Unsubscribe"]).toBeDefined();
      expect(call.headers["List-Unsubscribe"]).toContain("unsub-confirm");
      expect(call.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    });

    it("sendSubscriptionConfirmationEmail omits unsubscribe headers without token", async () => {
      await sendSubscriptionConfirmationEmail("user@test.com", "Pro");

      const call = mockSend.mock.calls[0][0];
      if (call.headers) {
        expect(call.headers["List-Unsubscribe"]).toBeUndefined();
      }
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
