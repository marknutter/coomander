import { test, expect } from "@playwright/test";

test.describe("Landing page — sections", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("hero section renders with CTA", async ({ page }) => {
    // Hero heading
    await expect(page.locator("h1").first()).toBeVisible({ timeout: 8_000 });
    // CTA button (Get Started or Join Waitlist)
    const cta = page
      .getByRole("link", { name: /get started|join waitlist/i })
      .first();
    await expect(cta).toBeVisible();
  });

  test("features section renders", async ({ page }) => {
    const features = page.locator("#features");
    await expect(features).toBeVisible();
    // Should have multiple feature cards
    const cards = features.locator("[class*='rounded']").or(features.locator("h3"));
    expect(await cards.count()).toBeGreaterThan(3);
  });

  test("how-it-works section renders", async ({ page }) => {
    const section = page.locator("#how-it-works");
    await expect(section).toBeVisible();
    // 3 steps
    await expect(section.getByText(/clone|customize|deploy/i).first()).toBeVisible();
  });

  test("pricing section renders with plans", async ({ page }) => {
    const pricing = page.locator("#pricing");
    await expect(pricing).toBeVisible();
    // Should show at least Free and Pro plans
    await expect(pricing.getByText(/free/i).first()).toBeVisible();
    await expect(pricing.getByText(/pro/i).first()).toBeVisible();
  });

  test("FAQ section renders with accordion items", async ({ page }) => {
    const faq = page.locator("#faq");
    await expect(faq).toBeVisible();
    // Should have clickable FAQ items
    const buttons = faq.getByRole("button");
    expect(await buttons.count()).toBeGreaterThan(2);
  });

  test("newsletter or waitlist signup form renders", async ({ page }) => {
    // Newsletter or waitlist section should have an email input
    const emailInput = page
      .getByPlaceholder(/you@example\.com|email/i)
      .or(page.locator("input[type='email']"))
      .last();
    await expect(emailInput).toBeVisible({ timeout: 5_000 });
  });

  test("header navigation links exist", async ({ page }) => {
    const nav = page.locator("header nav").first();
    await expect(nav.getByText("Features")).toBeVisible();
    await expect(nav.getByText("Pricing")).toBeVisible();
    await expect(nav.getByText("Docs")).toBeVisible();
  });

  test("footer renders", async ({ page }) => {
    const footer = page.locator("footer");
    await expect(footer).toBeVisible();
  });
});
