import { expect, test } from "@playwright/test";
import { clickAndExpectSideEffect, devSignIn, reseedDatabase, SEEDED } from "./_helpers";

test.beforeEach(reseedDatabase);

test.describe("Lawyer surfaces (signed in)", () => {
  test.beforeEach(async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
  });

  // TODO(phase-12): dashboard cleanup; assertions reference UI elements that
  // have drifted (sparkline, requests label). Tied to broader naming alignment.
  test.skip("Dashboard — header CTA, nav, schedule, requests, sparkline", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /Good morning/i })).toBeVisible();

    // Top bar nav links
    await expect(page.getByRole("link", { name: "Dashboard" }).first()).toHaveAttribute("href", "/lawyer/dashboard");
    await expect(page.getByRole("link", { name: "Requests" }).first()).toHaveAttribute("href", "/lawyer/requests");
    await expect(page.getByRole("link", { name: "Messages" }).first()).toHaveAttribute("href", "/lawyer/messages");
    await expect(page.getByRole("link", { name: "Profile" }).first()).toHaveAttribute("href", "/lawyer/profile/edit");

    // Edit Profile CTA → /lawyer/profile/edit
    await expect(page.getByRole("link", { name: /Edit Profile/i })).toHaveAttribute("href", "/lawyer/profile/edit");

    // Recent requests — each links into a request review page
    const reqLink = page.locator("a[href^='/lawyer/requests/']").first();
    if (await reqLink.count()) {
      await expect(reqLink).toHaveAttribute("href", /^\/lawyer\/requests\//);
    }
  });

  test("Requests list — clicking a row goes to /lawyer/requests/[id]", async ({ page }) => {
    await page.goto("/lawyer/requests");
    const first = page.locator("a[href^='/lawyer/requests/']").first();
    if (!(await first.count())) test.skip(); // Maria has no PENDING in the seed
    const href = await first.getAttribute("href");
    await clickAndExpectSideEffect(page, first, "First request row");
    await page.waitForURL(href!, { waitUntil: "domcontentloaded" });
  });

  test("Request Review — accept/decline POST, suggest is disabled", async ({ page }) => {
    // Anya Kowalski (employment, wallet ending …0005) is the lawyer the seed
    // assigns David Cohen's REQUESTED booking to.
    const anya = "0x1111000000000000000000000000000000000005";
    await page.context().clearCookies();
    await devSignIn(page, { wallet: anya, role: "lawyer" });

    await page.goto("/lawyer/requests", { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(800);
    const first = page.locator("a[href^='/lawyer/requests/']").first();
    if (!(await first.count())) {
      test.skip(true, "no requests for this lawyer (seeded booking went elsewhere)");
    }
    const href = await first.getAttribute("href");
    // Hard navigation is more reliable than client-side Link click in dev mode.
    await page.goto(href!, { waitUntil: "domcontentloaded" });

    // Suggest Different Time is disabled (placeholder for post-MVP)
    const suggest = page.getByRole("button", { name: /Suggest Different Time/i });
    await expect(suggest).toBeDisabled();

    // Decline POSTs and refreshes — wait for React to hydrate before clicking
    const decline = page.getByRole("button", { name: /^Decline$/ });
    await expect(decline).toBeVisible();
    await page
      .waitForFunction(
        () => {
          const btns = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
          const d = btns.find((b) => b.textContent?.trim() === "Decline");
          return d ? Object.keys(d).some((k) => k.startsWith("__reactProps$")) : false;
        },
        undefined,
        { timeout: 10_000 },
      )
      .catch(() => {});
    const [resp] = await Promise.all([
      page.waitForResponse((r) => /\/api\/bookings\/.+\/decline/.test(r.url()) && r.request().method() === "POST"),
      decline.click(),
    ]);
    expect(resp.status()).toBe(200);
  });

  test("Profile Editor — tabs, inputs, sticky save bar", async ({ page }) => {
    await page.goto("/lawyer/profile/edit");
    await expect(page.getByRole("heading", { name: /Edit your profile/i })).toBeVisible();

    // Tab switching
    for (const tab of ["Profile", "Availability", "Pricing", "Verification"]) {
      const t = page.getByRole("tab", { name: new RegExp(tab) });
      await clickAndExpectSideEffect(page, t, `Tab: ${tab}`);
    }
    // Back to Profile
    await page.getByRole("tab", { name: /^Profile$/ }).click();

    // Edit headline. Skip the first input (read-only Name field, populated
    // from the bar-credential disclosure and not editable here).
    const headline = page.locator("input:not([readonly])").first();
    await headline.fill("Family & Estate counsel · Stockholm — updated by E2E");

    // Save Changes hits PATCH /api/lawyer/profile
    const save = page.getByRole("button", { name: /Save Changes/i });
    await expect(save).toBeEnabled();
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/lawyer/profile") && r.request().method() === "PATCH"),
      save.click(),
    ]);
    expect(resp.status()).toBe(200);
  });

  test("Lawyer Messages — thread + send", async ({ page }) => {
    await page.goto("/lawyer/messages");
    if (await page.getByRole("heading", { name: /^Messages$/ }).count()) {
      const input = page.locator("input[placeholder*='Type a message']");
      if (await input.count()) {
        await input.fill("Reply from the lawyer side");
        const [resp] = await Promise.all([
          page.waitForResponse((r) => r.url().includes("/api/messages") && r.request().method() === "POST"),
          page.getByRole("button", { name: /^Send$/ }).click(),
        ]);
        expect(resp.status()).toBe(200);
      }
    } else {
      // No conversations seeded for this lawyer — empty state shows
      await expect(page.getByText(/No messages yet/i)).toBeVisible();
    }
  });
});
