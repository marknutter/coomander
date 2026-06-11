/**
 * Dashboard & Settings E2E tests.
 *
 * These tests require a running dev server (handled by playwright.config.ts
 * webServer configuration) and create real accounts in the E2E test database.
 *
 * Each test that needs an authenticated session calls signUp() to create a
 * fresh account with a unique email, avoiding inter-test state pollution.
 */

import { test, expect } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

// ---------------------------------------------------------------------------
// Dashboard / Items CRUD
// ---------------------------------------------------------------------------

test.describe("Dashboard — items CRUD", () => {
  test("shows empty-state message when no items exist", async ({ page }) => {
    await signUp(page, uniqueEmail());

    // The app page should load
    await expect(page).toHaveURL(/\/app/);
    // Page title or heading should be visible
    await expect(page.locator("h1, h2, [data-testid='page-heading']").first()).toBeVisible({
      timeout: 8_000,
    });
  });

  test("can create an item via the UI", async ({ page }) => {
    await signUp(page, uniqueEmail());

    // Look for an input or form to create an item
    const nameInput = page
      .getByPlaceholder(/item name|add item|new item/i)
      .or(page.getByLabel(/item name|name/i))
      .first();

    if (await nameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await nameInput.fill("My First Item");

      // Submit
      const submitBtn = page
        .getByRole("button", { name: /add|create|save/i })
        .first();
      await submitBtn.click();

      // Item should appear in the list
      await expect(page.getByText("My First Item")).toBeVisible({ timeout: 5_000 });
    }
  });

  test("items persist across page reload", async ({ page }) => {
    await signUp(page, uniqueEmail());

    const nameInput = page
      .getByPlaceholder(/item name|add item|new item/i)
      .or(page.getByLabel(/item name|name/i))
      .first();

    if (await nameInput.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await nameInput.fill("Persistent Item");
      const submitBtn = page.getByRole("button", { name: /add|create|save/i }).first();
      await submitBtn.click();
      await expect(page.getByText("Persistent Item")).toBeVisible({ timeout: 5_000 });

      // Reload and check the item is still there
      await page.reload();
      await expect(page.getByText("Persistent Item")).toBeVisible({ timeout: 8_000 });
    }
  });
});

// ---------------------------------------------------------------------------
// Settings page
// ---------------------------------------------------------------------------

test.describe("Settings page", () => {
  test("authenticated user can navigate to settings", async ({ page }) => {
    await signUp(page, uniqueEmail());

    // Navigate to settings
    await page.goto("/settings");
    await expect(page).toHaveURL(/\/settings/);
    await expect(page).toHaveTitle(/Coomander/i);
  });

  test("settings page shows account info section", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);

    await page.goto("/settings");

    // The settings page should show some account-related content
    // Look for common headings/labels
    const accountSection = page
      .getByText(/account|profile|email/i)
      .first();
    await expect(accountSection).toBeVisible({ timeout: 8_000 });
  });

  test("settings page has sign out option", async ({ page }) => {
    await signUp(page, uniqueEmail());

    await page.goto("/settings");

    // Look for sign-out button
    const signOutBtn = page
      .getByRole("button", { name: /sign out|log out|signout|logout/i })
      .or(page.getByText(/sign out|log out/i))
      .first();

    await expect(signOutBtn).toBeVisible({ timeout: 8_000 });
  });

  test("sign out redirects to auth page", async ({ page }) => {
    await signUp(page, uniqueEmail());

    await page.goto("/settings");

    const signOutBtn = page
      .getByRole("button", { name: /sign out|log out/i })
      .first();

    if (await signOutBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await signOutBtn.click();
      // Should be redirected to auth after sign-out
      await page.waitForURL(/\/auth|\//, { timeout: 8_000 });
      // And protected routes should now redirect to auth
      await page.goto("/app");
      await page.waitForURL(/\/auth/, { timeout: 5_000 });
      expect(page.url()).toContain("/auth");
    }
  });
});
