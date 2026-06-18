import { test, expect } from "@playwright/test";
import { signUp, uniqueEmail } from "./helpers";

test.describe("Instagram OAuth → /app/insights", () => {
  test("shows Connect Instagram button to an unconnected user", async ({ page }) => {
    await signUp(page, uniqueEmail());
    await page.goto("/app/insights");
    await expect(page.getByRole("button", { name: /connect instagram/i })).toBeVisible();
    await expect(page.getByText(/connect your instagram account/i)).toBeVisible();
  });

  test("redirects to Meta's authorize endpoint with the right OAuth params on click", async ({
    page,
  }) => {
    await signUp(page, uniqueEmail());
    await page.goto("/app/insights");

    // Block Meta before it actually loads so the test stays offline,
    // serving a 200 stub instead. We assert on the navigation target.
    await page.route(/https:\/\/(?:api|www)\.instagram\.com\/oauth\/authorize/, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: "<html><body>Meta stub</body></html>",
      }),
    );

    const [authorizeReq] = await Promise.all([
      page.waitForRequest((req) =>
        /https:\/\/(?:api|www)\.instagram\.com\/oauth\/authorize/.test(req.url()),
      ),
      page.getByRole("button", { name: /connect instagram/i }).click(),
    ]);

    const url = new URL(authorizeReq.url());
    expect(url.hostname).toMatch(/instagram\.com$/);
    expect(url.pathname).toBe("/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-ig-client-id");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_insights",
    );
    expect(url.searchParams.get("state")).toMatch(/^[a-f0-9]{40,}$/);
    expect(url.searchParams.get("redirect_uri")).toContain(
      "/api/platforms/instagram/oauth/callback",
    );

    // CSRF state cookie set by /oauth/start.
    const cookies = await page.context().cookies();
    const stateCookie = cookies.find((c) => c.name === "ig_oauth_state");
    expect(stateCookie?.value).toBe(url.searchParams.get("state"));
  });

  test("rejects the callback when the state cookie does not match", async ({ page }) => {
    await signUp(page, uniqueEmail());

    // Set a bogus state cookie; the callback should return 400.
    await page.context().addCookies([
      {
        name: "ig_oauth_state",
        value: "bogus-state",
        domain: "localhost",
        path: "/",
      },
    ]);

    // page.request shares cookies (including the session) with the page context.
    const response = await page.request.get(
      "/api/platforms/instagram/oauth/callback?code=fake&state=different",
    );
    expect(response.status()).toBe(400);
  });
});
