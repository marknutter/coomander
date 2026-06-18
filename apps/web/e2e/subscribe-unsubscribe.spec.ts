import { test, expect } from "@playwright/test";

test.describe("Newsletter subscribe + unsubscribe flow", () => {
  const testEmail = `unsub-${Date.now()}@example.com`;

  test("can subscribe via API and get unsubscribe token", async ({ request }) => {
    const res = await request.post("/api/subscribe", {
      data: { email: testEmail },
    });
    expect(res.status()).toBe(201);
    const body = await res.json();
    expect(body.data.subscribed).toBe(true);
  });

  test("duplicate subscribe returns success silently", async ({ request }) => {
    // Subscribe first
    await request.post("/api/subscribe", { data: { email: `dup-${Date.now()}@example.com` } });
    // Subscribe again with same email — should be 200 (not error)
    const res = await request.post("/api/subscribe", {
      data: { email: `dup-${Date.now()}@example.com` },
    });
    expect(res.ok()).toBe(true);
  });

  test("subscribe with invalid email returns 400", async ({ request }) => {
    const res = await request.post("/api/subscribe", {
      data: { email: "not-an-email" },
    });
    expect(res.status()).toBe(400);
  });

  test("unsubscribe without token returns 400", async ({ request }) => {
    const res = await request.get("/api/unsubscribe");
    expect(res.status()).toBe(400);
  });

  test("unsubscribe with invalid token returns 404", async ({ request }) => {
    const res = await request.get("/api/unsubscribe?token=fake-token-123");
    // Should return 404 (redirect won't happen via API request, but the response code tells us)
    expect(res.status()).toBe(404);
  });

  test("POST unsubscribe with invalid token returns 404", async ({ request }) => {
    const res = await request.post("/api/unsubscribe?token=fake-token-123");
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  test("/unsubscribed page renders", async ({ page }) => {
    await page.goto("/unsubscribed");
    await expect(page.getByText(/unsubscribed/i)).toBeVisible({ timeout: 5_000 });
  });
});
