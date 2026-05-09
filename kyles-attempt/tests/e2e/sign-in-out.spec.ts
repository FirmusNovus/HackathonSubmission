import { expect, test } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

test.beforeEach(reseedDatabase);

test.describe("Signed-in landing redirects", () => {
  test("Signed-in client visiting / lands on /client/home, not the marketing landing", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/client\/home$/);
    await expect(page.getByRole("heading", { name: /what do you need help with/i })).toBeVisible();
  });

  test("Signed-in lawyer visiting / lands on /lawyer/dashboard", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/lawyer\/dashboard$/);
    await expect(page.getByRole("heading", { name: /Good morning/i })).toBeVisible();
  });

  test("Disconnected viewer still sees the marketing landing on /", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: /Verified Legal Counsel/i })).toBeVisible();
  });
});

test.describe("Sign-in / sign-out top-right control", () => {
  test("Disconnected viewer sees a Sign In CTA, no separate sign-in link", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    // Exactly one Sign In affordance.
    const cta = page.getByRole("link", { name: /^Sign In$/i });
    await expect(cta).toHaveCount(1);
    await expect(cta).toHaveAttribute("href", "/connect");
    // No "Sign out" available when nobody's signed in.
    await expect(page.getByRole("menuitem", { name: /Sign out/i })).toHaveCount(0);
  });

  test("Signed-in client sees their app links, not 'For Lawyers' or 'Sign In'", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    await page.goto("/lawyers", { waitUntil: "domcontentloaded" });

    // No marketing/sign-in pull-down for someone who's already in.
    await expect(page.getByRole("link", { name: /^Sign In$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /For Lawyers/i })).toHaveCount(0);
    // Their app links show up in the marketing nav instead.
    await expect(page.getByRole("link", { name: /^Home$/i }).first()).toHaveAttribute("href", "/client/home");
    await expect(page.getByRole("link", { name: /^Cases$/i }).first()).toHaveAttribute("href", "/client/cases");
  });

  test("Signed-in lawyer sees their app links, not 'For Lawyers' or 'Sign In'", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    await page.goto("/lawyers", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("link", { name: /^Sign In$/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /For Lawyers/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^Dashboard$/i }).first()).toHaveAttribute(
      "href",
      "/lawyer/dashboard",
    );
  });

  test("Account menu signs the user out and clears the session cookie", async ({ page, context }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    await page.goto("/client/home", { waitUntil: "domcontentloaded" });

    // Open the wallet-pill account menu.
    const accountBtn = page.getByRole("button", { name: /Account menu/i });
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    // Click Sign out — the request to /api/auth/signout fires and we end up on /.
    const signOut = page.getByRole("menuitem", { name: /Sign out/i });
    await expect(signOut).toBeVisible();
    const [signoutResponse] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/auth/signout"), { timeout: 10_000 }),
      signOut.click(),
    ]);
    expect(signoutResponse.status()).toBe(200);

    // The session-token cookie should be cleared by signOut.
    await page.waitForURL("**/", { timeout: 10_000, waitUntil: "domcontentloaded" });
    const cookies = await context.cookies();
    const session = cookies.find((c) => c.name === "authjs.session-token");
    expect(session?.value ?? "").toBe("");

    // And the top-right shows Sign In again.
    await expect(page.getByRole("link", { name: /^Sign In$/i })).toBeVisible();

    // Trying to hit a protected route with the cleared session bounces to /connect.
    await page.goto("/client/home", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/connect(\?|$)/);
  });
});
