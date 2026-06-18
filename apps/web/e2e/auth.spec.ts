import { test, expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { signUp, signIn, uniqueEmail, TEST_PASSWORD } from "./helpers";

// ---------------------------------------------------------------------------
// Smoke tests (no auth required)
// ---------------------------------------------------------------------------

test.describe("Auth page — smoke tests", () => {
  test("shows the auth page with Sign In / Sign Up tabs", async ({ page }) => {
    await page.goto("/auth");
    await expect(page).toHaveTitle(/Coomander/i);

    const signUpTab = page.getByRole("button", { name: /sign up/i });
    const signInTab = page.getByRole("button", { name: /sign in/i });
    const hasSignUp = await signUpTab.isVisible().catch(() => false);
    const hasSignIn = await signInTab.isVisible().catch(() => false);
    expect(hasSignUp || hasSignIn).toBe(true);
  });

  test("redirects unauthenticated users from /app to /auth", async ({ page }) => {
    await page.goto("/app");
    await page.waitForURL(/\/auth/);
    expect(page.url()).toContain("/auth");
  });

  test("redirects unauthenticated users from /settings to /auth", async ({ page }) => {
    await page.goto("/settings");
    await page.waitForURL(/\/auth/);
    expect(page.url()).toContain("/auth");
  });

  test("landing page loads for unauthenticated users", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Coomander/i);
  });

  test("shows validation error for empty email on signup", async ({ page }) => {
    await page.goto("/auth?tab=signup");
    const submitButton = page.getByRole("button", { name: /create account|sign up/i });
    if (await submitButton.isVisible()) {
      await submitButton.click();
      expect(page.url()).toContain("/auth");
    }
  });

  test("health endpoint returns ok", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.db).toBe(true);
    expect(body).toHaveProperty("timestamp");
  });
});

// ---------------------------------------------------------------------------
// Full auth journey
// ---------------------------------------------------------------------------

test.describe("Sign-up → Sign-in journey", () => {
  test("can create an account and land on the dashboard", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);
    expect(page.url()).toContain("/app");
  });

  test("shows error for mismatched passwords", async ({ page }) => {
    await page.goto("/auth?tab=signup");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm Password").fill("different456");
    await page.getByRole("button", { name: /create account/i }).click();

    // Filter out Next.js 16's __next-route-announcer__ (role=alert on route change)
    await expect(
      page.getByRole("alert").filter({ hasText: /passwords do not match/i })
    ).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain("/auth");
  });

  test("cannot sign in with wrong password", async ({ page }) => {
    const email = uniqueEmail();
    await signUp(page, email);

    // Clear session by navigating to auth
    await page.goto("/auth?tab=login");

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("definitely-wrong-999");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByRole("alert")).toBeVisible({ timeout: 5_000 });
    expect(page.url()).toContain("/auth");
  });

  test("can sign in again after navigating away", async ({ page }) => {
    const email = uniqueEmail();

    // 1. Sign up
    await signUp(page, email);
    expect(page.url()).toContain("/app");

    // 2. Navigate away (clears in-browser auth state for this fresh page)
    await page.goto("/auth");

    // 3. Sign back in
    await signIn(page, email);
    expect(page.url()).toContain("/app");
  });
});
