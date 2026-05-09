import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

// =============================================================================
// Feature 7 — operator dispute resolution.
//
// Covers:
//   1. /api/operator/disputes returns only DISPUTED proposals.
//   2-4. /api/operator/disputes/[engagementId]/[proposalIndex]/resolve happy
//        paths (equal split, all-to-lawyer, all-to-client).
//   5. invalid-split rejected server-side (422 InvalidSplit) — both directions.
//   6. non-operator (client / lawyer) → 403.
//   7. resolve-twice rejected (409 InvalidProposalState).
//   8. resolve on a non-DISPUTED proposal rejected (409 InvalidProposalState).
//   9. UI: form's submit is disabled when sum ≠ amount; enabled when ==.
//   10. UI: operator-list-detail-roundtrip — login, list, click, resolve.
//   11. follow-up proposal resolve works; booking shell stays DISPUTED until
//       proposal[0] also resolves.
// =============================================================================

test.describe.configure({ mode: "serial" });
test.beforeAll(reseedDatabase);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

const OPERATOR_WALLET = "0x09e8a70811111111111111111111111111111bbb";

interface LawyerSummary {
  id: string;
  user: { walletAddress: string };
}

async function getLawyerByWallet(
  request: APIRequestContext,
  wallet: string,
): Promise<{ id: string; userWallet: string }> {
  const r = await request.get("/api/lawyers");
  const data = (await r.json()) as { lawyers: LawyerSummary[] };
  const match = data.lawyers.find((l) => l.user.walletAddress.toLowerCase() === wallet.toLowerCase());
  if (!match) throw new Error(`No lawyer with wallet ${wallet}`);
  return { id: match.id, userWallet: match.user.walletAddress };
}

async function createPaidBooking(
  page: Page,
  lawyerProfileId: string,
  fee = 240,
): Promise<{ id: string; engagementId: number; proposalIndex: number }> {
  const r = await page.request.post("/api/bookings", {
    data: {
      lawyerProfileId,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      durationMinutes: 60,
      practiceArea: "Family",
      caseDescription: "F7 operator-disputes test booking.",
      lineItems: [
        {
          id: "li-1",
          title: "60-min consultation",
          kind: "hourly",
          hours: 1,
          ratePerHour: fee,
          subtotal: fee,
        },
      ],
      deliverables: [{ id: "d-1", title: "Live consultation" }],
    },
  });
  expect(r.status(), `createPaidBooking: ${await r.text()}`).toBe(200);
  const j = (await r.json()) as {
    booking: { id: string; engagementId: number; proposalIndex: number };
  };
  return j.booking;
}

async function disputeBooking(page: Page, bookingId: string): Promise<void> {
  const r = await page.request.post(`/api/bookings/${bookingId}/dispute`);
  expect(r.status(), `dispute: ${await r.text()}`).toBe(200);
}

async function lawyerSignedIn(
  browser: Browser,
  wallet: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await devSignIn(page, { wallet, role: "lawyer" });
  return { ctx, page };
}

async function operatorSignedIn(
  browser: Browser,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Operator persona's role enum is CLIENT (see prisma/seed.ts) — the
  // operator capability is what gates the /operator routes via
  // requireOperator(). dev-sign-in with role=client mints a SCHEMA_CLIENT
  // capability for the operator address; that's harmless because the
  // operator already has SCHEMA_OPERATOR from the seed and isOperator()
  // matches on either the address OR the capability.
  await devSignIn(page, { wallet: OPERATOR_WALLET, role: "client" });
  return { ctx, page };
}

interface ChainEngagement {
  state: string;
  proposalCount: number;
  proposals: Array<{
    proposalIndex: number;
    state: string;
    amountWei: string;
    amountToLawyerWei?: string | null;
    amountToClientWei?: string | null;
  }>;
}

async function getEngagement(request: APIRequestContext, engagementId: number): Promise<ChainEngagement> {
  const r = await request.get(`/api/dev/chain?method=getEngagement&engagementId=${engagementId}`);
  const j = (await r.json()) as { ok: boolean; result: { engagement: ChainEngagement | null } };
  expect(j.ok).toBe(true);
  expect(j.result.engagement).not.toBeNull();
  return j.result.engagement!;
}

async function resolveAsOperator(
  page: Page,
  engagementId: number,
  proposalIndex: number,
  toLawyerWei: string,
  toClientWei: string,
): Promise<{ status: number; body: unknown }> {
  const r = await page.request.post(
    `/api/operator/disputes/${engagementId}/${proposalIndex}/resolve`,
    {
      data: { toLawyerWei, toClientWei },
    },
  );
  let body: unknown;
  try {
    body = await r.json();
  } catch {
    body = await r.text();
  }
  return { status: r.status(), body };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

test("operator-sees-only-disputed-proposals", async ({ page, browser, request }) => {
  // Three bookings for three different clients. We'll funded one, dispute
  // another, and release a third → the list endpoint should return only
  // the disputed one.
  await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);

  // Booking 1 — funded but neither delivered nor disputed.
  const fundedBooking = await createPaidBooking(page, lawyer.id);

  // Booking 2 — disputed.
  const c2 = await browser.newContext();
  const p2 = await c2.newPage();
  await devSignIn(p2, { wallet: SEEDED.client2, role: "client" });
  const disputedBooking = await createPaidBooking(p2, lawyer.id);
  await disputeBooking(p2, disputedBooking.id);
  await c2.close();

  // Booking 3 — released (deliver + complete).
  const c3 = await browser.newContext();
  const p3 = await c3.newPage();
  await devSignIn(p3, { wallet: SEEDED.client3, role: "client" });
  const releasedBooking = await createPaidBooking(p3, lawyer.id);
  // Lawyer marks delivered.
  const { ctx: lctx, page: lpage } = await lawyerSignedIn(browser, lawyer.userWallet);
  const deliver = await lpage.request.post(`/api/bookings/${releasedBooking.id}/deliver`);
  expect(deliver.status()).toBe(200);
  await lctx.close();
  // Client releases.
  const release = await p3.request.post(`/api/bookings/${releasedBooking.id}/complete`);
  expect(release.status()).toBe(200);
  await c3.close();

  // Now list disputes as operator.
  const { ctx: opctx, page: opPage } = await operatorSignedIn(browser);
  const r = await opPage.request.get("/api/operator/disputes");
  expect(r.status()).toBe(200);
  const j = (await r.json()) as {
    disputes: Array<{ engagementId: number; proposalIndex: number }>;
  };
  const ids = new Set(j.disputes.map((d) => d.engagementId));
  expect(ids.has(disputedBooking.engagementId)).toBe(true);
  expect(ids.has(fundedBooking.engagementId)).toBe(false);
  expect(ids.has(releasedBooking.engagementId)).toBe(false);
  await opctx.close();
});

test("operator-can-resolve-with-equal-split", async ({ page, browser, request }) => {
  await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const booking = await createPaidBooking(page, lawyer.id, 200);
  await disputeBooking(page, booking.id);

  // Sanity: amount in wei = cents = 20000.
  const before = await getEngagement(page.request, booking.engagementId);
  expect(before.proposals[0].state).toBe("DISPUTED");
  expect(before.proposals[0].amountWei).toBe("20000");

  const { ctx, page: opPage } = await operatorSignedIn(browser);
  const res = await resolveAsOperator(
    opPage,
    booking.engagementId,
    0,
    "10000",
    "10000",
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);

  const after = await getEngagement(page.request, booking.engagementId);
  expect(after.proposals[0].state).toBe("RESOLVED");
  expect(after.proposals[0].amountToLawyerWei).toBe("10000");
  expect(after.proposals[0].amountToClientWei).toBe("10000");
  await ctx.close();
});

test("operator-can-resolve-all-to-lawyer", async ({ page, browser, request }) => {
  await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const booking = await createPaidBooking(page, lawyer.id, 240);
  await disputeBooking(page, booking.id);

  const { ctx, page: opPage } = await operatorSignedIn(browser);
  const res = await resolveAsOperator(opPage, booking.engagementId, 0, "24000", "0");
  expect(res.status, JSON.stringify(res.body)).toBe(200);

  const after = await getEngagement(page.request, booking.engagementId);
  expect(after.proposals[0].state).toBe("RESOLVED");
  expect(after.proposals[0].amountToLawyerWei).toBe("24000");
  expect(after.proposals[0].amountToClientWei).toBe("0");
  await ctx.close();
});

test("operator-can-resolve-all-to-client", async ({ page, browser, request }) => {
  await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const booking = await createPaidBooking(page, lawyer.id, 240);
  await disputeBooking(page, booking.id);

  const { ctx, page: opPage } = await operatorSignedIn(browser);
  const res = await resolveAsOperator(opPage, booking.engagementId, 0, "0", "24000");
  expect(res.status, JSON.stringify(res.body)).toBe(200);

  const after = await getEngagement(page.request, booking.engagementId);
  expect(after.proposals[0].state).toBe("RESOLVED");
  expect(after.proposals[0].amountToLawyerWei).toBe("0");
  expect(after.proposals[0].amountToClientWei).toBe("24000");
  await ctx.close();
});

test("invalid-split-rejected-server-side", async ({ page, browser, request }) => {
  await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const booking = await createPaidBooking(page, lawyer.id, 100);
  await disputeBooking(page, booking.id);

  const { ctx, page: opPage } = await operatorSignedIn(browser);

  // Overshoot: 6000 + 5000 > 10000.
  const over = await resolveAsOperator(opPage, booking.engagementId, 0, "6000", "5000");
  expect(over.status).toBe(422);
  const overBody = over.body as { error: { code: string } };
  expect(overBody.error.code).toBe("InvalidSplit");

  // Undershoot: 4000 + 5000 < 10000.
  const under = await resolveAsOperator(opPage, booking.engagementId, 0, "4000", "5000");
  expect(under.status).toBe(422);
  const underBody = under.body as { error: { code: string } };
  expect(underBody.error.code).toBe("InvalidSplit");

  // Proposal must remain DISPUTED — no state mutation on a rejected attempt.
  const after = await getEngagement(page.request, booking.engagementId);
  expect(after.proposals[0].state).toBe("DISPUTED");

  // Clean up by resolving cleanly so this booking doesn't pollute later
  // "operator-sees-only-disputed-proposals" checks if the suite re-runs.
  const ok = await resolveAsOperator(opPage, booking.engagementId, 0, "10000", "0");
  expect(ok.status).toBe(200);

  await ctx.close();
});

test("non-operator-cannot-resolve", async ({ page, browser, request }) => {
  await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const booking = await createPaidBooking(page, lawyer.id, 100);
  await disputeBooking(page, booking.id);

  // Client tries to resolve their own dispute → must fail. requireOperator()
  // redirects to "/" rather than returning a JSON 403, so we disable
  // redirect-following on the request and assert we either get a 30x
  // (redirect) or an explicit 401/403. The critical invariant is "the
  // resolve did NOT execute" — we re-read the proposal afterwards to
  // confirm it's still DISPUTED.
  const clientRes = await page.request.post(
    `/api/operator/disputes/${booking.engagementId}/0/resolve`,
    {
      data: { toLawyerWei: "10000", toClientWei: "0" },
      maxRedirects: 0,
    },
  );
  expect(clientRes.status(), "client resolve must not 200").not.toBe(200);
  expect([301, 302, 303, 307, 308, 401, 403]).toContain(clientRes.status());

  const lawyerCtx = await browser.newContext();
  const lpage = await lawyerCtx.newPage();
  await devSignIn(lpage, { wallet: lawyer.userWallet, role: "lawyer" });
  const lawyerRes = await lpage.request.post(
    `/api/operator/disputes/${booking.engagementId}/0/resolve`,
    {
      data: { toLawyerWei: "10000", toClientWei: "0" },
      maxRedirects: 0,
    },
  );
  expect(lawyerRes.status(), "lawyer resolve must not 200").not.toBe(200);
  expect([301, 302, 303, 307, 308, 401, 403]).toContain(lawyerRes.status());
  await lawyerCtx.close();

  // The authoritative check: proposal state must be unchanged.
  const after = await getEngagement(page.request, booking.engagementId);
  expect(after.proposals[0].state).toBe("DISPUTED");

  // Clean up so this booking's DISPUTED proposal doesn't pollute later runs.
  const { ctx: opctx, page: oppage } = await operatorSignedIn(browser);
  const ok = await resolveAsOperator(oppage, booking.engagementId, 0, "10000", "0");
  expect(ok.status).toBe(200);
  await opctx.close();
});

test("resolve-twice-rejected", async ({ page, browser, request }) => {
  await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const booking = await createPaidBooking(page, lawyer.id, 100);
  await disputeBooking(page, booking.id);

  const { ctx, page: opPage } = await operatorSignedIn(browser);
  const first = await resolveAsOperator(opPage, booking.engagementId, 0, "10000", "0");
  expect(first.status).toBe(200);

  const second = await resolveAsOperator(opPage, booking.engagementId, 0, "10000", "0");
  expect(second.status).toBe(409);
  const body = second.body as { error: { code: string } };
  expect(body.error.code).toBe("InvalidProposalState");
  await ctx.close();
});

test("resolve-on-non-disputed-rejected", async ({ page, browser, request }) => {
  await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const booking = await createPaidBooking(page, lawyer.id, 100);
  // Do NOT dispute — proposal stays FUNDED.
  const before = await getEngagement(page.request, booking.engagementId);
  expect(before.proposals[0].state).toBe("FUNDED");

  const { ctx, page: opPage } = await operatorSignedIn(browser);
  const res = await resolveAsOperator(opPage, booking.engagementId, 0, "10000", "0");
  expect(res.status).toBe(409);
  const body = res.body as { error: { code: string } };
  expect(body.error.code).toBe("InvalidProposalState");
  await ctx.close();
});

test("UI-resolve-form-disables-submit-on-bad-sum", async ({ page, browser, request }) => {
  // Set up a fresh dispute.
  const c = await browser.newContext();
  const cp = await c.newPage();
  await devSignIn(cp, { wallet: SEEDED.client4, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const booking = await createPaidBooking(cp, lawyer.id, 240);
  await disputeBooking(cp, booking.id);
  await c.close();

  // Operator visits the detail page and tries the form.
  const { ctx: opctx, page: opPage } = await operatorSignedIn(browser);
  await opPage.goto(`/operator/disputes/${booking.engagementId}/0`);

  await expect(opPage.getByTestId("resolve-form")).toBeVisible();
  const submit = opPage.getByTestId("resolve-submit");
  await expect(submit).toBeDisabled();

  await opPage.getByTestId("to-lawyer-input").fill("100");
  await opPage.getByTestId("to-client-input").fill("100"); // sums to 200, target is 240
  await expect(submit).toBeDisabled();
  await expect(opPage.getByTestId("sum-status")).toContainText(/Must equal/i);

  await opPage.getByTestId("to-client-input").fill("140"); // 100 + 140 = 240 ✓
  await expect(submit).toBeEnabled();
  await expect(opPage.getByTestId("sum-status")).toContainText(/Matches parked/i);

  // Submit — confirm modal opens.
  await submit.click();
  await expect(opPage.getByTestId("resolve-confirm")).toBeVisible();
  await opPage.getByTestId("resolve-confirm-go").click();

  // After resolve we redirect back to /operator/disputes with a banner.
  await opPage.waitForURL(/\/operator\/disputes\?resolved=1/, { timeout: 10_000 });
  await expect(opPage.getByTestId("resolve-toast")).toBeVisible();

  // Chain side: proposal is RESOLVED with the right split.
  const after = await getEngagement(opPage.request, booking.engagementId);
  expect(after.proposals[0].state).toBe("RESOLVED");
  expect(after.proposals[0].amountToLawyerWei).toBe("10000");
  expect(after.proposals[0].amountToClientWei).toBe("14000");
  await opctx.close();
});

test("operator-list-detail-roundtrip", async ({ page, browser, request }) => {
  // Set up two disputes — confirm both show in the list, click the second,
  // resolve from the detail page.
  const a = await browser.newContext();
  const ap = await a.newPage();
  await devSignIn(ap, { wallet: SEEDED.client1, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const b1 = await createPaidBooking(ap, lawyer.id, 50);
  await disputeBooking(ap, b1.id);
  await a.close();

  const c = await browser.newContext();
  const cp = await c.newPage();
  await devSignIn(cp, { wallet: SEEDED.client2, role: "client" });
  const b2 = await createPaidBooking(cp, lawyer.id, 75);
  await disputeBooking(cp, b2.id);
  await c.close();

  const { ctx, page: opPage } = await operatorSignedIn(browser);
  await opPage.goto("/operator/disputes");
  await expect(opPage.getByTestId("dispute-list")).toBeVisible();

  // Both rows visible.
  await expect(opPage.getByTestId(`dispute-row-${b1.engagementId}-0`)).toBeVisible();
  const row2 = opPage.getByTestId(`dispute-row-${b2.engagementId}-0`);
  await expect(row2).toBeVisible();

  // Click into the second.
  await row2.click();
  await opPage.waitForURL(new RegExp(`/operator/disputes/${b2.engagementId}/0`), {
    timeout: 10_000,
  });

  // Resolve all-to-client (75 EUR = 7500 cents).
  await opPage.getByTestId("to-lawyer-input").fill("0");
  await opPage.getByTestId("to-client-input").fill("75");
  const submit = opPage.getByTestId("resolve-submit");
  await expect(submit).toBeEnabled();
  await submit.click();
  await opPage.getByTestId("resolve-confirm-go").click();
  await opPage.waitForURL(/\/operator\/disputes\?resolved=1/, { timeout: 10_000 });

  // Confirm chain.
  const after2 = await getEngagement(opPage.request, b2.engagementId);
  expect(after2.proposals[0].state).toBe("RESOLVED");
  expect(after2.proposals[0].amountToClientWei).toBe("7500");

  // First dispute is still listed (unresolved).
  const list = await opPage.request.get("/api/operator/disputes");
  const j = (await list.json()) as {
    disputes: Array<{ engagementId: number }>;
  };
  const ids = new Set(j.disputes.map((d) => d.engagementId));
  expect(ids.has(b1.engagementId)).toBe(true);
  expect(ids.has(b2.engagementId)).toBe(false);

  // Resolve the leftover so we don't leak state into later tests.
  const cleanup = await resolveAsOperator(opPage, b1.engagementId, 0, "5000", "0");
  expect(cleanup.status).toBe(200);
  await ctx.close();
});

test("followup-proposal-resolve", async ({ page, browser, request }) => {
  // Set up an engagement, fund a follow-up proposal[1], dispute proposal[1],
  // resolve. The booking shell (proposal[0]) must NOT flip — proposal[0] is
  // still FUNDED, so the booking is still in its mid-flight status.
  await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
  const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
  const booking = await createPaidBooking(page, lawyer.id, 240);
  expect(booking.engagementId).toBeGreaterThan(0);

  // Lawyer publishes a follow-up offer; client funds it.
  const { ctx: lctx, page: lpage } = await lawyerSignedIn(browser, lawyer.userWallet);
  const items = [
    { id: "fi", title: "Draft contract", kind: "fixed" as const, fixedPrice: 500, subtotal: 500 },
  ];
  const deliverables = [{ id: "fd", title: "Signed PDF" }];
  const signRes = await lpage.request.post("/api/dev/sign-proposal-offer", {
    data: {
      engagementId: booking.engagementId,
      amountWei: "50000",
      items,
      deliverables,
    },
  });
  expect(signRes.status()).toBe(200);
  const signed = (await signRes.json()) as {
    signature: string;
    nonce: string;
    itemsHash: string;
    amountWei: string;
  };
  const offerRes = await lpage.request.post("/api/proposals", {
    data: {
      engagementId: booking.engagementId,
      amountWei: signed.amountWei,
      itemsHash: signed.itemsHash,
      nonce: signed.nonce,
      signature: signed.signature,
      items,
      deliverables,
    },
  });
  expect(offerRes.status(), `offer: ${await offerRes.text()}`).toBe(200);
  const offerJson = (await offerRes.json()) as { offer: { id: string } };
  await lctx.close();

  // Client funds the offer.
  const fundRes = await page.request.post(`/api/proposals/${offerJson.offer.id}/fund`);
  expect(fundRes.status()).toBe(200);
  const fundJson = (await fundRes.json()) as { proposalIndex?: number };
  const followupIndex = fundJson.proposalIndex ?? 1;
  expect(followupIndex).toBeGreaterThan(0);

  // Client disputes the follow-up.
  const disputeRes = await page.request.post(`/api/proposals/${offerJson.offer.id}/dispute`);
  expect(disputeRes.status(), `dispute: ${await disputeRes.text()}`).toBe(200);

  // Booking shell must NOT be DISPUTED — the dispute is on a follow-up, not
  // proposal[0]. Verify before any operator action.
  const bookingFresh1 = await page.request.get(`/api/bookings/${booking.id}`);
  const bj1 = (await bookingFresh1.json()) as { booking: { status: string } };
  expect(bj1.booking.status).not.toBe("DISPUTED");

  // Operator resolves the follow-up (50000 wei = 500 EUR; split 300/200).
  const { ctx: octx, page: opPage } = await operatorSignedIn(browser);
  const res = await resolveAsOperator(
    opPage,
    booking.engagementId,
    followupIndex,
    "30000",
    "20000",
  );
  expect(res.status, JSON.stringify(res.body)).toBe(200);

  // Chain: proposal[1] is RESOLVED, proposal[0] still FUNDED.
  const after = await getEngagement(opPage.request, booking.engagementId);
  const fp = after.proposals.find((p) => p.proposalIndex === followupIndex)!;
  expect(fp.state).toBe("RESOLVED");
  expect(fp.amountToLawyerWei).toBe("30000");
  expect(fp.amountToClientWei).toBe("20000");
  expect(after.proposals.find((p) => p.proposalIndex === 0)!.state).toBe("FUNDED");

  // Booking shell is unchanged — the resolve was proposal-scoped.
  const bookingFresh2 = await page.request.get(`/api/bookings/${booking.id}`);
  const bj2 = (await bookingFresh2.json()) as { booking: { status: string } };
  expect(bj2.booking.status).not.toBe("DISPUTED");
  // Specifically: proposal[0] was never disputed in this scenario, so the
  // booking should still be in its normal post-acceptance state (e.g.
  // ACCEPTED). What matters is "not COMPLETED" — the resolve on the
  // follow-up must not have flipped the shell.
  expect(bj2.booking.status).not.toBe("COMPLETED");

  await octx.close();
});
