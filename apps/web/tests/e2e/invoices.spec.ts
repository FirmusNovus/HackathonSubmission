import { expect, test } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

test.beforeEach(reseedDatabase);

test.describe("Invoice flow — both parties must sign before escrow funds", () => {
  test("Client signs invoice on booking creation; escrow stays unfunded until lawyer signs", async ({
    page,
    request,
  }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyers = await request.get("/api/lawyers");
    const { lawyers: list } = (await lawyers.json()) as { lawyers: Array<{ id: string }> };

    const post = await page.request.post("/api/bookings", {
      data: {
        lawyerProfileId: list[0].id,
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        durationMinutes: 60,
        practiceArea: "Family",
        caseDescription: "Estate planning question.",
        lineItems: [
          { id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 },
          { id: "li-2", title: "Written summary", kind: "fixed", fixedPrice: 60, subtotal: 60 },
        ],
        deliverables: [
          { id: "d-1", title: "Live consultation" },
          { id: "d-2", title: "Written summary delivered within 48h" },
        ],
      },
    });
    expect(post.status()).toBe(200);
    const { booking } = (await post.json()) as {
      booking: {
        id: string;
        status: string;
        clientAcceptedAt: string | null;
        lawyerAcceptedAt: string | null;
        consultationFeeEUR: string;
        platformFeeEUR: string;
        escrowTxHash: string | null;
      };
    };

    // Client signed; lawyer hasn't; status is REQUESTED; escrow not yet funded.
    expect(booking.status).toBe("REQUESTED");
    expect(booking.clientAcceptedAt).not.toBeNull();
    expect(booking.lawyerAcceptedAt).toBeNull();
    expect(booking.escrowTxHash).toBeNull();
    // Server computed the total from the line items.
    expect(Number(booking.consultationFeeEUR)).toBe(300);
    expect(Number(booking.platformFeeEUR)).toBeCloseTo(15, 2);
  });

  // TODO(phase-6): "Both parties signed.*funds in escrow" copy gets rewritten
  // when escrow becomes a real on-chain tx. Re-enable with new copy.
  test.skip("Cases page surfaces explicit dual-signature state", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    await page.goto("/client/cases", { waitUntil: "domcontentloaded" });
    // Sarah's seeded ACCEPTED booking has both signatures.
    await expect(page.getByText(/Both parties signed.*funds in escrow/i).first()).toBeVisible({ timeout: 5_000 });
  });

  // TODO(phase-8): post-rename to "order"; the detail-page heading and section
  // copy will change. Re-enable after orders/milestones detail page exists.
  test.skip("Invoice detail page shows line items, deliverables, and signatures", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const list = await page.request.get("/api/bookings");
    const { bookings } = (await list.json()) as { bookings: Array<{ id: string }> };
    expect(bookings.length).toBeGreaterThan(0);

    await page.goto(`/client/cases/${bookings[0].id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { level: 3, name: /^INV-/ })).toBeVisible();
    await expect(page.getByText(/Line items/i).first()).toBeVisible();
    await expect(page.getByText(/Deliverables/i).first()).toBeVisible();
    await expect(page.getByText(/Signatures/i).first()).toBeVisible();
  });

  test("Lawyer accept signs the invoice + funds escrow only after client signed", async ({ page, browser }) => {
    // First: client books, signs invoice (lawyer hasn't).
    const ctx = await browser.newContext();
    const clientPage = await ctx.newPage();
    await devSignIn(clientPage, { wallet: SEEDED.client4, role: "client" });
    const lawyers = await clientPage.request.get("/api/lawyers");
    const { lawyers: list } = (await lawyers.json()) as { lawyers: Array<{ id: string }> };
    // Pick lawyer #5 = Anya (employment) — she has no other bookings to interfere.
    const lawyer = list[4];
    expect(lawyer).toBeDefined();
    const ownerInfo = await clientPage.request.get(`/api/lawyers/${lawyer.id}`);
    const { lawyer: lwy } = (await ownerInfo.json()) as { lawyer: { user: { walletAddress: string } } };

    const create = await clientPage.request.post("/api/bookings", {
      data: {
        lawyerProfileId: lawyer.id,
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
        durationMinutes: 60,
        practiceArea: "Employment",
        caseDescription: "Unfair dismissal — looking for a strategy session.",
        lineItems: [{ id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 200, subtotal: 200 }],
        deliverables: [{ id: "d-1", title: "Live consultation + verbal advice" }],
      },
    });
    expect(create.status()).toBe(200);
    const { booking: created } = (await create.json()) as { booking: { id: string } };
    await ctx.close();

    // Now the lawyer signs.
    await devSignIn(page, { wallet: lwy.user.walletAddress, role: "lawyer" });
    const accept = await page.request.post(`/api/bookings/${created.id}/accept`);
    expect(accept.status()).toBe(200);
    const { booking: accepted } = (await accept.json()) as {
      booking: { status: string; lawyerAcceptedAt: string | null; escrowTxHash: string | null };
    };
    // Phase 6: status stays REQUESTED until the client submits the on-chain
    // funding tx. The lawyer's signature is recorded but doesn't move funds
    // — only the client can call `openEngagementAndFundFirstMilestone`
    // (msg.sender == client gate in the contract).
    expect(accepted.status).toBe("REQUESTED");
    expect(accepted.lawyerAcceptedAt).not.toBeNull();
    expect(accepted.escrowTxHash).toBeNull();
  });

  test("Lawyer accept on a non-existent booking returns 404", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    const bad = await page.request.post("/api/bookings/cm_does_not_exist/accept");
    expect(bad.status()).toBe(404);
  });
});

test.describe("Lawyer-initiated invoices", () => {
  // TODO(phase-6): /api/lawyer/invoices route + escrowTxHash semantics get
  // replaced by real on-chain funding. Re-enable with new endpoints.
  test.skip("Lawyer signs first, client counter-signs, escrow funds", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    const create = await page.request.post("/api/lawyer/invoices", {
      data: {
        clientWalletAddress: SEEDED.client1,
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 4).toISOString(),
        durationMinutes: 60,
        practiceArea: "Estate",
        caseDescription: "Drafting an updated will across SE/DE jurisdictions.",
        lineItems: [
          { id: "li-1", title: "60-min strategy session", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 },
          { id: "li-2", title: "Will draft revision", kind: "fixed", fixedPrice: 360, subtotal: 360 },
        ],
        deliverables: [
          { id: "d-1", title: "Live consultation" },
          { id: "d-2", title: "Updated will draft within 5 business days" },
        ],
      },
    });
    expect(create.status()).toBe(200);
    const { booking: created } = (await create.json()) as {
      booking: {
        id: string;
        status: string;
        clientAcceptedAt: string | null;
        lawyerAcceptedAt: string | null;
        escrowTxHash: string | null;
      };
    };
    expect(created.status).toBe("REQUESTED");
    expect(created.lawyerAcceptedAt).not.toBeNull();
    expect(created.clientAcceptedAt).toBeNull();
    expect(created.escrowTxHash).toBeNull();

    // Client signs in another context.
    const ctx = await browser.newContext();
    const clientPage = await ctx.newPage();
    await devSignIn(clientPage, { wallet: SEEDED.client1, role: "client" });
    const sign = await clientPage.request.post(`/api/bookings/${created.id}/sign`);
    expect(sign.status()).toBe(200);
    const { booking: signed } = (await sign.json()) as {
      booking: { status: string; clientAcceptedAt: string | null; escrowTxHash: string | null };
    };
    expect(signed.status).toBe("ACCEPTED");
    expect(signed.clientAcceptedAt).not.toBeNull();
    expect(signed.escrowTxHash).toBeTruthy();
    await ctx.close();
  });

  // TODO(phase-8): "Send an invoice" CTA renames to "Send order" in the
  // multi-order milestone flow.
  test.skip("Lawyer dashboard surfaces a 'Send an invoice' CTA", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    await page.goto("/lawyer/dashboard", { waitUntil: "domcontentloaded" });
    const cta = page.getByRole("link", { name: /Send an invoice/i });
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute("href", "/lawyer/invoices/new");
  });

  test("Unknown wallet on lawyer-invoice POST returns 404", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    const r = await page.request.post("/api/lawyer/invoices", {
      data: {
        clientWalletAddress: "0x9999999999999999999999999999999999999999",
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60).toISOString(),
        durationMinutes: 30,
        practiceArea: "Estate",
        caseDescription: "x",
        lineItems: [{ id: "a", title: "x", kind: "fixed", fixedPrice: 50, subtotal: 50 }],
        deliverables: [{ id: "b", title: "x" }],
      },
    });
    expect(r.status()).toBe(404);
  });

  // TODO(phase-8): chat-side "Send invoice" link → "Send order"; pre-fill flow
  // hits new /lawyer/orders/new route.
  test.skip("Lawyer's chat has a 'Send invoice' link that opens the form pre-filled with the client", async ({
    page,
  }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    await page.goto("/lawyer/messages", { waitUntil: "domcontentloaded" });

    // The link is the *only* visible chat-side affordance to invoice; it's a
    // <Link>, not a button — Radix Dialog used to live here and was flaky.
    const link = page.getByRole("link", { name: /Send an invoice to/i });
    await expect(link).toBeVisible({ timeout: 5_000 });
    const href = await link.getAttribute("href");
    expect(href).toMatch(/^\/lawyer\/invoices\/new\?client=0x[0-9a-fA-F]+&from=/);

    // Following the link lands on the new-invoice form. The form has resolved
    // the wallet to the existing client (Sarah) and pre-selected "Existing client".
    await link.click();
    await page.waitForURL(/\/lawyer\/invoices\/new/);
    await expect(page.getByRole("heading", { name: /Send an invoice to/i })).toBeVisible();
    // The "Existing client" tab is the active one (border-2 border-teal-500).
    await expect(page.getByRole("button", { name: /^Existing client$/i })).toHaveClass(/border-teal-500/);
    // The selected client's wallet appears in the dropdown's currently-shown option.
    await expect(page.locator("select").first()).toContainText(/0x2222/);
  });

  // TODO(phase-8): same — chat→form→review flow rewires for orders.
  test.skip("Lawyer-initiated invoice flow from the chat lands on the request review page", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    await page.goto("/lawyer/messages", { waitUntil: "domcontentloaded" });
    const link = page.getByRole("link", { name: /Send an invoice to/i });
    await link.click();
    await page.waitForURL(/\/lawyer\/invoices\/new/);

    // The form is pre-filled — fill in the case description and submit.
    await page.getByPlaceholder(/Brief summary of the work/i).fill("Follow-up to last week's session.");
    await page.getByRole("button", { name: /Sign & send invoice/i }).click();

    // After submit, the form sets window.location.href to the new request page.
    await page.waitForURL(/\/lawyer\/requests\/[a-z0-9_-]+/i, { timeout: 15_000 });
    // The request page should show the "awaiting client signature" caption.
    await expect(page.getByText(/awaiting (the )?client('s)? signature/i).first()).toBeVisible({ timeout: 10_000 });
  });

  test("Client doesn't see the chat-side 'Send invoice' link", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    await page.goto("/client/messages", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("link", { name: /Send an invoice to/i })).toHaveCount(0);
  });

  // TODO(phase-8): "Review & sign invoice" CTA rewords for orders/milestones.
  test.skip("Client cases page surfaces lawyer-initiated invoice with a primary 'Review & sign' CTA", async ({
    page,
    browser,
  }) => {
    // Lawyer sends an invoice first.
    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: SEEDED.lawyerMaria, role: "lawyer" });
    await lawyerPage.request.post("/api/lawyer/invoices", {
      data: {
        clientWalletAddress: SEEDED.client1,
        scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString(),
        durationMinutes: 30,
        practiceArea: "Estate",
        caseDescription: "Quick check on a clause.",
        lineItems: [{ id: "li-1", title: "30-min review", kind: "hourly", hours: 0.5, ratePerHour: 240, subtotal: 120 }],
        deliverables: [{ id: "d-1", title: "Live consultation" }],
      },
    });
    await ctx.close();

    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    await page.goto("/client/cases", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/Lawyer sent invoice .*review and sign/i).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("link", { name: /Review & sign invoice/i }).first()).toBeVisible();
  });
});
