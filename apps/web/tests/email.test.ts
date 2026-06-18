import { describe, it, expect, vi, beforeEach } from "vitest";

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
  sendWelcomeEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendSubscriptionConfirmationEmail,
} from "@/lib/email";

describe("Email Functions", () => {
  beforeEach(() => {
    mockSend.mockClear();
  });

  describe("sendWelcomeEmail", () => {
    it("should send welcome email with correct parameters", async () => {
      await sendWelcomeEmail("user@test.com");

      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0][0];
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

      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0][0];
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

      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe("user@test.com");
      expect(call.subject).toContain("Reset");
      expect(call.html).toContain(url);
      expect(call.html).toContain("Reset Password");
    });
  });

  describe("sendSubscriptionConfirmationEmail", () => {
    it("should send subscription confirmation with plan name", async () => {
      await sendSubscriptionConfirmationEmail("user@test.com", "Pro");

      expect(mockSend).toHaveBeenCalledOnce();
      const call = mockSend.mock.calls[0][0];
      expect(call.to).toBe("user@test.com");
      expect(call.subject).toContain("Pro");
      expect(call.html).toContain("Pro");
      expect(call.html).toContain("Go to app");
    });
  });
});
