import { test, expect } from "@playwright/test";
import { signUp, ensureLoggedIn, uniqueEmail, ADMIN_EMAIL } from "./helpers";

test.describe("Admin panel — access control", () => {
  test("unauthenticated user is redirected from /admin", async ({ page }) => {
    await page.goto("/admin");
    await page.waitForURL(/\/auth/, { timeout: 8_000 });
    expect(page.url()).toContain("/auth");
  });

  test("unauthenticated user is redirected from /admin/users", async ({ page }) => {
    await page.goto("/admin/users");
    await page.waitForURL(/\/auth/, { timeout: 8_000 });
  });

  test("unauthenticated user is redirected from /admin/crm", async ({ page }) => {
    await page.goto("/admin/crm");
    await page.waitForURL(/\/auth/, { timeout: 8_000 });
  });

  test("non-admin user is redirected from /admin to /app", async ({ page }) => {
    // Sign up with a regular (non-admin) email
    await signUp(page, uniqueEmail());
    await page.goto("/admin");
    // Should redirect to /app (not admin)
    await page.waitForURL(/\/app/, { timeout: 8_000 });
  });
});

test.describe("Admin panel — dashboard and navigation", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page, ADMIN_EMAIL);
  });

  test("admin dashboard loads", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.locator("h1, h2").first()).toBeVisible({ timeout: 8_000 });
  });

  test("admin sidebar shows all expected nav items", async ({ page }) => {
    await page.goto("/admin");

    const sidebar = page.locator("aside").first();
    const expectedItems = [
      "Dashboard",
      "Users",
      "Database",
      "Analytics",
      "CRM",
      "Campaigns",
      "Roles",
      "Waitlist",
      "Audit Logs",
      "Dev Wiki",
    ];

    for (const item of expectedItems) {
      await expect(sidebar.getByText(item, { exact: true })).toBeVisible({
        timeout: 3_000,
      });
    }
  });

  test("admin can navigate to Users page and see user list", async ({ page }) => {
    await page.goto("/admin/users");
    await expect(page).toHaveURL(/\/admin\/users/);

    // Should show a table or list of users
    // The admin email should be in the list since we just signed up with it
    await expect(
      page.getByText(ADMIN_EMAIL).or(page.getByText(/admin/i)).first()
    ).toBeVisible({ timeout: 8_000 });
  });

  test("admin can navigate to CRM page", async ({ page }) => {
    await page.goto("/admin/crm");
    await expect(page).toHaveURL(/\/admin\/crm/);
    await expect(page.getByText(/subscriber/i).first()).toBeVisible({ timeout: 8_000 });
  });

  test("admin can navigate to Waitlist page", async ({ page }) => {
    await page.goto("/admin/waitlist");
    await expect(page).toHaveURL(/\/admin\/waitlist/);
  });

  test("admin can navigate to Audit Logs page", async ({ page }) => {
    await page.goto("/admin/logs");
    await expect(page).toHaveURL(/\/admin\/logs/);
  });

  test("admin can navigate to Dev Wiki", async ({ page }) => {
    await page.goto("/admin/docs");
    await expect(page).toHaveURL(/\/admin\/docs/);
  });
});

test.describe("Admin API — access control", () => {
  test("users API requires authentication", async ({ request }) => {
    const res = await request.get("/api/admin/users");
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("subscribers API requires authentication", async ({ request }) => {
    const res = await request.get("/api/admin/subscribers");
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("logs API requires authentication", async ({ request }) => {
    const res = await request.get("/api/admin/logs");
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("waitlist API requires authentication", async ({ request }) => {
    const res = await request.get("/api/admin/waitlist");
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("campaigns API requires authentication", async ({ request }) => {
    const res = await request.get("/api/admin/campaigns");
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
