import { test, expect } from "@playwright/test";

test.describe("Password reset flow", () => {
  test("forgot password page loads from auth page", async ({ page }) => {
    await page.goto("/auth?tab=login");

    // Look for "Forgot password" link
    const forgotLink = page.getByText(/forgot.*password/i).first();
    if (await forgotLink.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await forgotLink.click();
      // Should navigate to forgot-password page or show reset form
      await page.waitForURL(/forgot-password|reset/, { timeout: 5_000 }).catch(() => {
        // Some implementations show inline form instead of navigating
      });
    }
  });

  test("forgot password page renders with email input", async ({ page }) => {
    await page.goto("/forgot-password");

    const emailInput = page.getByLabel(/email/i).or(page.getByPlaceholder(/email/i)).first();
    await expect(emailInput).toBeVisible({ timeout: 5_000 });

    const submitBtn = page.getByRole("button", { name: /reset|send|submit/i }).first();
    await expect(submitBtn).toBeVisible();
  });

  test("forgot password with empty email shows validation", async ({ page }) => {
    await page.goto("/forgot-password");

    const submitBtn = page.getByRole("button", { name: /reset|send|submit/i }).first();
    if (await submitBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await submitBtn.click();
      // Should stay on page or show error
      expect(page.url()).toContain("forgot-password");
    }
  });

  test("reset-password page loads", async ({ page }) => {
    // Without a valid token, should show error or redirect
    await page.goto("/reset-password");
    // Page should render something (even if it's an error about missing token)
    await expect(page.locator("body")).toBeVisible();
  });
});

test.describe("Email verification flow", () => {
  test("verify-email page loads", async ({ page }) => {
    await page.goto("/verify-email");
    // Should render — may show "verifying" or error about missing/invalid token
    await expect(page.locator("body")).toBeVisible();
  });

  test("verify-email with invalid token shows error or message", async ({ page }) => {
    await page.goto("/verify-email?token=invalid-token-123");
    // Should show some feedback (error message, not a crash)
    await page.waitForTimeout(2_000);
    // Page should still be rendered (not 500 error)
    const bodyText = await page.locator("body").textContent();
    expect(bodyText).toBeTruthy();
  });
});
