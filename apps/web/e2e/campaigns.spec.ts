import { test, expect } from "@playwright/test";
import { signUp, ensureLoggedIn, ADMIN_EMAIL } from "./helpers";

test.describe("Campaign management — full CRUD flow", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await ensureLoggedIn(page, ADMIN_EMAIL);
  });

  test("admin can access campaigns page and see empty state", async ({ page }) => {
    await page.goto("/admin/campaigns");

    // Should land on campaigns page (not redirected)
    await expect(page).toHaveURL(/\/admin\/campaigns/);

    // Stats cards should be visible
    await expect(page.getByText("Total").first()).toBeVisible({ timeout: 8_000 });

    // "New Campaign" button visible
    await expect(
      page.getByRole("link", { name: /new campaign/i })
    ).toBeVisible();
  });

  test("admin can create a new draft campaign", async ({ page }) => {
    await page.goto("/admin/campaigns/new");
    await expect(page).toHaveURL(/\/admin\/campaigns\/new/);

    // Fill in the form
    const nameInput = page.getByPlaceholder(/newsletter/i).or(page.getByLabel(/campaign name/i)).first();
    await nameInput.fill("E2E Test Campaign");

    const subjectInput = page.getByPlaceholder(/subject/i).or(page.getByLabel(/subject/i)).first();
    await subjectInput.fill("Hello from E2E");

    const htmlTextarea = page.getByPlaceholder(/html/i).or(page.locator("textarea")).first();
    await htmlTextarea.fill("<h1>Test Campaign</h1><p>This is an e2e test email.</p>");

    // Create the draft
    await page.getByRole("button", { name: /create draft/i }).click();

    // Should redirect to the campaign detail page
    await page.waitForURL(/\/admin\/campaigns\/[a-f0-9-]+/, { timeout: 8_000 });

    // Campaign name should be visible
    await expect(page.getByText("E2E Test Campaign")).toBeVisible();

    // Status badge should show "draft" (the rounded-full badge, not buttons)
    await expect(page.locator("span.rounded-full", { hasText: "draft" })).toBeVisible();
  });

  test("admin can edit a draft campaign", async ({ page }) => {
    // First create a campaign
    await page.goto("/admin/campaigns/new");
    const nameInput = page.getByPlaceholder(/newsletter/i).or(page.getByLabel(/campaign name/i)).first();
    await nameInput.fill("Edit Test Campaign");
    const subjectInput = page.getByPlaceholder(/subject/i).or(page.getByLabel(/subject/i)).first();
    await subjectInput.fill("Original Subject");
    const htmlTextarea = page.locator("textarea").first();
    await htmlTextarea.fill("<h1>Original</h1>");
    await page.getByRole("button", { name: /create draft/i }).click();
    await page.waitForURL(/\/admin\/campaigns\/[a-f0-9-]+/, { timeout: 8_000 });

    // Wait for campaign detail page to fully load (form fields visible)
    await expect(page.getByText("Edit Test Campaign").first()).toBeVisible({ timeout: 8_000 });

    // Now edit it — change the subject using the input field
    const subjectField = page.locator("input").filter({ hasText: "" }).nth(1); // second input = subject
    const allInputs = page.locator("input[type='text']");
    const subject = allInputs.nth(1); // 0=name, 1=subject, 2=preview
    await subject.clear();
    await subject.fill("Updated Subject");

    // Save
    await page.getByRole("button", { name: /save draft/i }).click();

    // Wait for save confirmation
    await expect(page.getByText(/saved/i)).toBeVisible({ timeout: 5_000 });
  });

  test("campaign list shows created campaigns", async ({ page }) => {
    // Create a campaign first
    await page.goto("/admin/campaigns/new");
    const nameInput = page.getByPlaceholder(/newsletter/i).or(page.getByLabel(/campaign name/i)).first();
    await nameInput.fill("Listed Campaign");
    const subjectInput = page.getByPlaceholder(/subject/i).or(page.getByLabel(/subject/i)).first();
    await subjectInput.fill("List Test Subject");
    const htmlTextarea = page.locator("textarea").first();
    await htmlTextarea.fill("<p>List test</p>");
    await page.getByRole("button", { name: /create draft/i }).click();
    await page.waitForURL(/\/admin\/campaigns\/[a-f0-9-]+/, { timeout: 8_000 });

    // Go to campaign list
    await page.goto("/admin/campaigns");

    // Campaign should appear in the table
    await expect(page.getByText("Listed Campaign")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText("draft").first()).toBeVisible();
  });

  test("admin can delete a draft campaign", async ({ page }) => {
    // Create a campaign
    await page.goto("/admin/campaigns/new");
    const nameInput = page.getByPlaceholder(/newsletter/i).or(page.getByLabel(/campaign name/i)).first();
    await nameInput.fill("Delete Me Campaign");
    const subjectInput = page.getByPlaceholder(/subject/i).or(page.getByLabel(/subject/i)).first();
    await subjectInput.fill("Delete Subject");
    const htmlTextarea = page.locator("textarea").first();
    await htmlTextarea.fill("<p>Delete me</p>");
    await page.getByRole("button", { name: /create draft/i }).click();
    await page.waitForURL(/\/admin\/campaigns\/[a-f0-9-]+/, { timeout: 8_000 });

    // Go to list and delete
    await page.goto("/admin/campaigns");
    await expect(page.getByText("Delete Me Campaign")).toBeVisible({ timeout: 5_000 });

    // Click the delete button (trash icon) on that row
    page.on("dialog", (dialog) => dialog.accept());
    const row = page.getByText("Delete Me Campaign").locator("../..");
    const deleteBtn = row.locator("button[title='Delete']").or(row.locator("button").last());
    await deleteBtn.click();

    // Campaign should disappear after deletion
    await expect(page.getByText("Delete Me Campaign")).toBeHidden({ timeout: 5_000 });
  });

  test("admin sidebar shows Campaigns nav item", async ({ page }) => {
    await page.goto("/admin");

    const sidebar = page.locator("aside").first();
    await expect(sidebar.getByText("Campaigns")).toBeVisible({ timeout: 5_000 });
  });
});

test.describe("Campaign API — access control", () => {
  test("campaigns API requires authentication", async ({ request }) => {
    const res = await request.get("/api/admin/campaigns");
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("campaign create API requires authentication", async ({ request }) => {
    const res = await request.post("/api/admin/campaigns", {
      data: { name: "Test", subject: "Test", html_content: "<p>Test</p>" },
    });
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("campaign preview API requires authentication", async ({ request }) => {
    const res = await request.post("/api/admin/campaigns/fake-id/preview");
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });

  test("campaign send API requires authentication", async ({ request }) => {
    const res = await request.post("/api/admin/campaigns/fake-id/send");
    expect(res.status()).toBeGreaterThanOrEqual(400);
  });
});
