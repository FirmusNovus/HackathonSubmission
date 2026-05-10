import { expect, test } from "@playwright/test";
import { clickAndExpectSideEffect, devSignIn, reseedDatabase, SEEDED } from "./_helpers";

test.beforeEach(reseedDatabase);

test.describe("Client surfaces (signed in)", () => {
  test.beforeEach(async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
  });

  test("Client Home — top bar, categories, active booking, recommendations", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /Hi .+, what do you need help with/i })).toBeVisible();

    // Top bar nav links
    await expect(page.getByRole("link", { name: "Home" }).first()).toHaveAttribute("href", "/client/home");
    await expect(page.getByRole("link", { name: "Cases" }).first()).toHaveAttribute("href", "/client/cases");
    await expect(page.getByRole("link", { name: "Messages" }).first()).toHaveAttribute("href", "/client/messages");

    // Category chips are links with hrefs
    for (const cat of ["All", "Family", "Property", "Employment", "Immigration", "Business", "Tax", "Estate"]) {
      const chip = page.getByRole("link", { name: new RegExp(`^${cat}$`) });
      await expect(chip).toHaveAttribute("href", cat === "All" ? "/client/home" : new RegExp(`cat=${cat}`));
    }

    // Click into Business → see sample services
    await page.goto("/client/home?cat=Business", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Incorporation in your EU country/i)).toBeVisible({ timeout: 15_000 });
    const findLawyer = page.getByRole("link", { name: /Find lawyer/i }).first();
    await expect(findLawyer).toHaveAttribute("href", /\/lawyers\?practice=Business/);

    // Active booking buttons (seeded: client1 has an ACCEPTED booking)
    await page.goto("/client/home");
    const join = page.getByRole("link", { name: /Join room/i });
    if (await join.count()) {
      await expect(join).toHaveAttribute("href", /\/client\/consultation\//);
    }

    // See all → directory
    await expect(page.getByRole("link", { name: /See all/i })).toHaveAttribute("href", "/lawyers");

    // Lawyer cards link out
    const card = page.locator("a[href^='/lawyers/']").first();
    await expect(card).toBeVisible();
    await expect(card).toHaveAttribute("href", /^\/lawyers\/[a-z0-9]+/);
  });

  // TODO(phase-6): booking form will be rewired to emit a fund-calldata
  // wallet prompt. Re-enable with the new flow's selectors.
  test.skip("Booking page — every form control is interactive", async ({ page }) => {
    // Find a verified lawyer's id from the directory
    await page.goto("/lawyers");
    const href = await page.locator("a[href^='/lawyers/']").first().getAttribute("href");
    const id = href!.split("/").pop()!;
    await page.goto(`/client/book/${id}`);
    await expect(page.getByRole("heading", { name: /Book your consultation/i })).toBeVisible();

    // Back link
    await expect(page.getByRole("link", { name: /Back to home/i })).toHaveAttribute("href", "/client/home");

    // Duration radios — wait for React to attach Radix's onClick before firing
    // a click, otherwise the force-click can land before hydration finishes.
    const r30 = page.getByRole("radio").nth(0);
    const r60 = page.getByRole("radio").nth(1);
    await expect(r60).toBeChecked();
    await page
      .waitForFunction(() => {
        const radios = document.querySelectorAll('[role="radio"]');
        return radios.length >= 2 && Array.from(radios).every((r) => Object.keys(r).some((k) => k.startsWith("__reactProps$")));
      }, undefined, { timeout: 10_000 })
      .catch(() => {});
    await r30.click({ force: true });
    await expect(r30).toBeChecked();
    await r60.click({ force: true });
    await expect(r60).toBeChecked();

    // Datetime input is editable
    const datetime = page.locator("input[type=datetime-local]");
    await expect(datetime).toBeEditable();

    // Practice area select
    const select = page.locator("select").first();
    await expect(select).toBeEnabled();

    // Textarea
    const textarea = page.locator("textarea").first();
    await textarea.fill("Help with EU inheritance.");

    // Sign & send invoice → POSTs /api/bookings, then lands on /client/cases.
    // The consultation room is gated by time and reached from there.
    const confirm = page.getByRole("button", { name: /Sign & send invoice/i });
    await expect(confirm).toBeEnabled();
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/bookings") && r.request().method() === "POST"),
      confirm.click(),
    ]);
    expect(response.status()).toBe(200);
    await page.waitForURL(/\/client\/cases/, { timeout: 30_000, waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Booking sent/i)).toBeVisible({ timeout: 10_000 });
  });

  test("Consultation Room — controls and chat are wired", async ({ page }) => {
    // Use the seeded ACCEPTED booking — pick the first booking that belongs to client1
    await page.goto("/client/home");
    const joinHref = await page.getByRole("link", { name: /Join room/i }).getAttribute("href").catch(() => null);
    if (!joinHref) test.skip();
    await page.goto(joinHref!);

    // Top bar Mark Complete is visible & enabled
    const markCompleteTop = page.getByRole("button", { name: /Mark Complete/i });
    await expect(markCompleteTop).toBeVisible();

    // Mic / camera control buttons — toggle aria-label between Mute↔Unmute / camera-on↔off.
    // Wait for the dark-mode controls bar to fully hydrate before clicking.
    await page
      .waitForFunction(() => {
        const b = Array.from(document.querySelectorAll<HTMLButtonElement>("button"))
          .find((el) => el.getAttribute("aria-label") === "Mute");
        return b ? Object.keys(b).some((k) => k.startsWith("__reactProps$")) : false;
      }, undefined, { timeout: 10_000 })
      .catch(() => {});
    const mute = page.getByRole("button", { name: /^Mute$/ });
    await expect(mute).toBeVisible();
    await mute.click({ force: true });
    await expect(page.getByRole("button", { name: /^Unmute$/ })).toBeVisible({ timeout: 10_000 });

    const camOff = page.getByRole("button", { name: /Turn camera off/i });
    await camOff.click({ force: true });
    await expect(page.getByRole("button", { name: /Turn camera on/i })).toBeVisible({ timeout: 10_000 });

    const share = page.getByRole("button", { name: /Share screen/i });
    await expect(share).toBeEnabled();

    // Send a chat message — POSTs /api/messages
    const chatInput = page.locator("input[placeholder*='Type a message']");
    await chatInput.fill("Hello from the e2e test");
    const send = page.getByRole("button", { name: /^Send$/ });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/messages") && r.request().method() === "POST"),
      send.click(),
    ]);
    expect(resp.status()).toBe(200);
  });

  test("Messages — thread switching and send are wired", async ({ page }) => {
    await page.goto("/client/messages");
    await expect(page.getByRole("heading", { name: /^Messages$/ })).toBeVisible();

    // Switching threads (when more than one) triggers a fetch
    const threads = page.locator("aside ul li button");
    const count = await threads.count();
    if (count > 1) {
      const second = threads.nth(1);
      const [r] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/api/messages?")),
        second.click(),
      ]);
      expect(r.status()).toBe(200);
    }

    const attach = page.getByRole("button", { name: /Attach file/i });
    await expect(attach).toBeEnabled();

    const input = page.locator("input[placeholder*='Type a message']");
    await input.fill("Quick test message");
    const send = page.getByRole("button", { name: /^Send$/ });
    const [resp] = await Promise.all([
      page.waitForResponse((r) => r.url().includes("/api/messages") && r.request().method() === "POST"),
      send.click(),
    ]);
    expect(resp.status()).toBe(200);
  });
});
