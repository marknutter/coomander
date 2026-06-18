import type { Page } from "@playwright/test";

/** Generate a unique test email to avoid collisions between runs. */
export function uniqueEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
}

export const TEST_PASSWORD = "SecurePass123!";

/** Fixed admin email — must match ADMIN_EMAILS in playwright.config.ts */
export const ADMIN_EMAIL = "e2e-admin@test.local";

/** Dismiss cookie consent banner if visible. */
async function dismissCookies(page: Page) {
  const btn = page.getByRole("button", { name: /accept all/i });
  await btn.click({ timeout: 2_000 }).catch(() => {});
}

/**
 * Ensure the user is authenticated, landing on /app.
 * Tries signin first; if that fails, tries signup.
 */
export async function ensureLoggedIn(page: Page, email: string) {
  // Check if already on /app (e.g., session cookie still valid)
  await page.goto("/app");
  if (page.url().includes("/app") && !page.url().includes("/auth")) {
    // Wait a moment to see if we get redirected
    await page.waitForTimeout(1_000);
    if (page.url().includes("/app")) return;
  }

  // Try sign-in
  try {
    await signIn(page, email);
    return;
  } catch {
    // Sign-in failed — try signup
  }

  try {
    await signUp(page, email);
  } catch {
    // Both failed — try sign-in one more time (signup may have succeeded but redirected oddly)
    await signIn(page, email);
  }
}

/**
 * Sign up a brand-new account. Lands on /app on success.
 */
export async function signUp(page: Page, email: string) {
  await page.goto("/auth?tab=signup");
  await dismissCookies(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(TEST_PASSWORD);
  await page.getByLabel("Confirm Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  // 20s timeout accounts for Next dev's lazy route compilation on first hit
  // and the slow React-email render inside the Better Auth after-create hook.
  await page.waitForURL(/\/app/, { timeout: 20_000 });
}

/**
 * Sign in with an existing account. Lands on /app on success.
 */
export async function signIn(page: Page, email: string) {
  await page.goto("/auth?tab=login");
  await dismissCookies(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(TEST_PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  // 20s timeout accounts for Next dev's lazy route compilation on first hit
  // and the slow React-email render inside the Better Auth after-create hook.
  await page.waitForURL(/\/app/, { timeout: 20_000 });
}
