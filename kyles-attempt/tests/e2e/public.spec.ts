import { expect, test } from "@playwright/test";
import { clickAndExpectSideEffect } from "./_helpers";

test.describe("Public marketing surfaces", () => {
  test("Landing — every primary control is wired", async ({ page }) => {
    await page.goto("/");

    // Brand visible
    await expect(page.getByRole("heading", { name: /Verified Legal Counsel/i })).toBeVisible();

    // Marketing nav links
    await expect(page.getByRole("link", { name: "Lawyers" }).first()).toHaveAttribute("href", "/lawyers");
    await expect(page.getByRole("link", { name: /How It Works/i }).first()).toHaveAttribute("href", /#how/);
    await expect(page.getByRole("link", { name: /For Lawyers/i }).first()).toHaveAttribute("href", "/connect");
    // Exactly one Sign In affordance — the WalletButton CTA in the top right.
    const signIn = page.getByRole("link", { name: /^Sign In$/i });
    await expect(signIn).toHaveCount(1);
    await expect(signIn).toHaveAttribute("href", "/connect");

    // Hero CTAs
    await expect(page.getByRole("link", { name: /Find a Lawyer/i })).toHaveAttribute("href", "/lawyers");
    await expect(page.getByRole("link", { name: /How It Works/i }).nth(1)).toHaveAttribute("href", /#how/);

    // The Sign In CTA from the WalletButton was already asserted above.

    // Browse all lawyers
    await expect(page.getByRole("link", { name: /Browse all lawyers/i })).toHaveAttribute("href", "/lawyers");

    // Each featured lawyer card is a link to /lawyers/<id>
    const cards = page.locator("a[href^='/lawyers/']");
    expect(await cards.count()).toBeGreaterThan(0);
    for (const href of await cards.evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute("href")))) {
      expect(href).toMatch(/^\/lawyers\/[a-z0-9]+/);
    }
  });

  test("Lawyer Directory — filters and cards are wired", async ({ page }) => {
    await page.goto("/lawyers");
    await expect(page.getByRole("heading", { name: /Find your lawyer/i })).toBeVisible();

    // Filters are a plain HTML form; clicking the (sr-only) inputs updates the URL.
    await page.locator("input[name=practice][value=Family]").click({ force: true });
    await expect(page).toHaveURL(/practice=Family/, { timeout: 5_000 });

    await page.locator("input[name=pricing][value=FIXED]").click({ force: true });
    await expect(page).toHaveURL(/pricing=FIXED/, { timeout: 5_000 });

    await page.locator("input[name=lang][value=English]").click({ force: true });
    await expect(page).toHaveURL(/lang=English/, { timeout: 5_000 });

    // Lawyer cards exist and link out
    await page.goto("/lawyers");
    const firstCard = page.locator("a[href^='/lawyers/']").first();
    await expect(firstCard).toBeVisible();
    await expect(firstCard).toHaveAttribute("href", /^\/lawyers\/[a-z0-9]+/);
  });

  test("Lawyer Profile — tabs and Book button are wired", async ({ page }) => {
    await page.goto("/lawyers");
    const firstHref = await page.locator("a[href^='/lawyers/']").first().getAttribute("href");
    expect(firstHref).toBeTruthy();
    await page.goto(firstHref!);
    await page.waitForLoadState("domcontentloaded");

    await expect(page.getByRole("link", { name: /All lawyers/i })).toHaveAttribute("href", "/lawyers");

    // Tabs change content
    const credentialsTab = page.getByRole("tab", { name: /Credentials/i });
    await clickAndExpectSideEffect(page, credentialsTab, "Credentials tab");
    await expect(page.getByText(/Trusted Issuers Registry/i)).toBeVisible();

    const reviewsTab = page.getByRole("tab", { name: /Reviews/i });
    await clickAndExpectSideEffect(page, reviewsTab, "Reviews tab");

    const aboutTab = page.getByRole("tab", { name: /About/i });
    await clickAndExpectSideEffect(page, aboutTab, "About tab");

    // Book Consultation → /client/book/<id>
    const book = page.getByRole("link", { name: /Book Consultation/i });
    await expect(book).toHaveAttribute("href", /^\/client\/book\//);
  });
});
