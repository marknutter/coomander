import { test, expect } from "@playwright/test";

test.describe("Documentation pages", () => {
  test("customer docs at /docs loads", async ({ page }) => {
    await page.goto("/docs");
    await expect(page.locator("body")).toBeVisible();
    // Should have some content (not a 404)
    const heading = page.locator("h1, h2").first();
    await expect(heading).toBeVisible({ timeout: 8_000 });
  });

  test("API docs at /api-docs loads", async ({ page }) => {
    // Scalar's bundle is heavy and cold Turbopack compilation can push past
    // Playwright's default 30s test timeout on CI. Extend to 60s.
    test.setTimeout(60_000);
    await page.goto("/api-docs", { waitUntil: "domcontentloaded" });
    await expect(page.locator("body")).toBeVisible();
    // Scalar renders the API reference
    await page.waitForTimeout(3_000);
    const content = await page.locator("body").textContent();
    expect(content?.length).toBeGreaterThan(100);
  });

  test("docs search API returns valid response", async ({ request }) => {
    const res = await request.get("/api/docs-search?query=getting+started");
    // Should return 200 with search results
    expect(res.ok()).toBe(true);
  });
});

test.describe("Blog", () => {
  test("blog page loads", async ({ page }) => {
    await page.goto("/blog");
    await expect(page.locator("body")).toBeVisible();
  });
});
