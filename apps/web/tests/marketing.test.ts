import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the loops module to prevent actual API calls
vi.mock("loops", () => ({
  LoopsClient: class MockLoopsClient {
    updateContact = vi.fn().mockResolvedValue({ success: true });
    deleteContact = vi.fn().mockResolvedValue({ success: true });
    sendEvent = vi.fn().mockResolvedValue({ success: true });
  },
}));

import {
  getMarketingProvider,
  trackSignup,
  trackSubscriptionChange,
  trackTrialExpiry,
  removeContact,
} from "@/lib/marketing";

describe("Marketing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getMarketingProvider", () => {
    it("returns a provider with the expected interface", () => {
      const provider = getMarketingProvider();
      expect(provider).toBeDefined();
      expect(provider.name).toBeDefined();
      expect(typeof provider.upsertContact).toBe("function");
      expect(typeof provider.deleteContact).toBe("function");
      expect(typeof provider.sendEvent).toBe("function");
    });

    it("returns noop provider when LOOPS_API_KEY is not set", () => {
      const provider = getMarketingProvider();
      expect(provider.name).toBe("noop");
    });
  });

  describe("trackSignup", () => {
    it("does not throw when called", () => {
      expect(() =>
        trackSignup({ email: "test@example.com", userId: "u1" })
      ).not.toThrow();
    });

    it("accepts all optional contact fields", () => {
      expect(() =>
        trackSignup({
          email: "test@example.com",
          userId: "u1",
          firstName: "Test",
          lastName: "User",
          plan: "pro",
          createdAt: new Date().toISOString(),
          properties: { source: "signup" },
        })
      ).not.toThrow();
    });
  });

  describe("trackSubscriptionChange", () => {
    it("does not throw when called with valid args", () => {
      expect(() =>
        trackSubscriptionChange("test@example.com", "pro", "active")
      ).not.toThrow();
    });

    it("accepts different plan/status combinations", () => {
      expect(() => trackSubscriptionChange("a@b.com", "free", "inactive")).not.toThrow();
      expect(() => trackSubscriptionChange("a@b.com", "pro", "past_due")).not.toThrow();
    });
  });

  describe("trackTrialExpiry", () => {
    it("does not throw when called", () => {
      expect(() => trackTrialExpiry("test@example.com")).not.toThrow();
    });
  });

  describe("removeContact", () => {
    it("does not throw when called", () => {
      expect(() => removeContact("test@example.com")).not.toThrow();
    });
  });

  describe("noop provider behavior", () => {
    it("all methods resolve without error", async () => {
      const provider = getMarketingProvider();
      await expect(provider.upsertContact({ email: "a@b.com" })).resolves.toBeUndefined();
      await expect(provider.deleteContact("a@b.com")).resolves.toBeUndefined();
      await expect(provider.sendEvent({ name: "test", email: "a@b.com" })).resolves.toBeUndefined();
    });
  });

  describe("exported types", () => {
    it("exports all expected functions", () => {
      expect(typeof getMarketingProvider).toBe("function");
      expect(typeof trackSignup).toBe("function");
      expect(typeof trackSubscriptionChange).toBe("function");
      expect(typeof trackTrialExpiry).toBe("function");
      expect(typeof removeContact).toBe("function");
    });
  });
});
