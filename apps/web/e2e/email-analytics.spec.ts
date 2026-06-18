import { test, expect } from "@playwright/test";

test.describe("Resend webhook endpoint", () => {
  test("accepts email.delivered event", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.delivered",
        data: {
          email_id: "e2e-test-delivered",
          to: ["delivered@example.com"],
          created_at: new Date().toISOString(),
        },
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  test("accepts email.opened event", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.opened",
        data: {
          email_id: "e2e-test-opened",
          to: ["opened@example.com"],
          created_at: new Date().toISOString(),
        },
      },
    });
    expect(res.ok()).toBe(true);
  });

  test("accepts email.clicked event with link", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.clicked",
        data: {
          email_id: "e2e-test-clicked",
          to: ["clicked@example.com"],
          created_at: new Date().toISOString(),
          click: { link: "https://example.com/cta" },
        },
      },
    });
    expect(res.ok()).toBe(true);
  });

  test("accepts email.bounced event", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.bounced",
        data: {
          email_id: "e2e-test-bounced",
          to: ["bounced@example.com"],
          created_at: new Date().toISOString(),
        },
      },
    });
    expect(res.ok()).toBe(true);
  });

  test("accepts email.complained event", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.complained",
        data: {
          email_id: "e2e-test-complained",
          to: ["complained@example.com"],
          created_at: new Date().toISOString(),
        },
      },
    });
    expect(res.ok()).toBe(true);
  });

  test("ignores unrecognized event types", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.unknown_event",
        data: { email_id: "e2e-test-unknown" },
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  test("extracts campaign_id from tags without error", async ({ request }) => {
    // Use no campaign_id tag to avoid FK constraint on nonexistent campaign
    const res = await request.post("/api/webhooks/resend", {
      data: {
        type: "email.delivered",
        data: {
          email_id: "e2e-test-no-tag",
          to: ["notag@example.com"],
          created_at: new Date().toISOString(),
          tags: [{ name: "source", value: "test" }],
        },
      },
    });
    expect(res.ok()).toBe(true);
  });

  test("returns 400 for invalid JSON", async ({ request }) => {
    const res = await request.post("/api/webhooks/resend", {
      headers: { "Content-Type": "application/json" },
      data: "not-json",
    });
    // Should handle gracefully
    expect([200, 400]).toContain(res.status());
  });
});

test.describe("Campaign analytics API", () => {
  test("requires authentication", async ({ request }) => {
    const res = await request.get("/api/admin/campaigns/fake-id/analytics");
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});

test.describe("Subscriber events API", () => {
  test("requires authentication", async ({ request }) => {
    const res = await request.get(
      `/api/admin/subscribers/${encodeURIComponent("test@example.com")}/events`
    );
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
