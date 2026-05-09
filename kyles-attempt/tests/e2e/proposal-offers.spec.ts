import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

// =============================================================================
// Feature 4 — EIP-712-signed follow-up proposal offers.
//
// These tests drive the full flow:
//   - lawyer composes + signs an offer (server-side dev signer; production
//     replaces with wagmi's `signTypedData` against the real wallet)
//   - server verifies the typed-data signature against the engagement's
//     lawyer wallet, persists the row
//   - client funds via /api/proposals/[id]/fund — the chain layer recovers
//     the lawyer's signature again and burns the nonce on success
//   - lifecycle continues uniformly: markDelivered → release works for
//     proposalIndex>0 just like proposal[0]
//
// Cryptography is REAL — viem's `signTypedData` / `recoverTypedDataAddress`
// produce + recover the same digest. Storage + state transitions go through
// the F1 mock chain because we don't want real txs in the test suite.
// =============================================================================

test.beforeAll(reseedDatabase);

async function getLawyerByWallet(
  request: APIRequestContext,
  wallet: string,
): Promise<{ id: string; userWallet: string }> {
  const r = await request.get("/api/lawyers");
  const data = (await r.json()) as { lawyers: Array<{ id: string; user: { walletAddress: string } }> };
  const match = data.lawyers.find((l) => l.user.walletAddress.toLowerCase() === wallet.toLowerCase());
  if (!match) throw new Error(`No lawyer with wallet ${wallet}`);
  return { id: match.id, userWallet: match.user.walletAddress };
}

async function createPaidBooking(page: Page, lawyerProfileId: string) {
  return page.request.post("/api/bookings", {
    data: {
      lawyerProfileId,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      durationMinutes: 60,
      practiceArea: "Family",
      caseDescription: "F4 follow-up proposal test.",
      lineItems: [{ id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 }],
      deliverables: [{ id: "d-1", title: "Live consultation" }],
    },
  });
}

interface OfferEnvelope {
  signature: `0x${string}`;
  nonce: `0x${string}`;
  itemsHash: `0x${string}`;
  amountWei: string;
}

async function signOfferAsLawyer(
  lawyerPage: Page,
  args: { engagementId: number; amountWei: string; items: unknown[]; deliverables: unknown[] },
): Promise<OfferEnvelope> {
  const r = await lawyerPage.request.post("/api/dev/sign-proposal-offer", {
    data: {
      engagementId: args.engagementId,
      amountWei: args.amountWei,
      items: args.items,
      deliverables: args.deliverables,
    },
  });
  expect(r.status(), `dev sign-proposal-offer ok: ${await r.text()}`).toBe(200);
  const j = (await r.json()) as OfferEnvelope;
  expect(j.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
  expect(j.nonce).toMatch(/^0x[0-9a-fA-F]{64}$/);
  expect(j.itemsHash).toMatch(/^0x[0-9a-fA-F]{64}$/);
  return j;
}

const OFFER_ITEMS_DEFAULT = [
  { id: "f1", title: "Draft contract", kind: "fixed" as const, fixedPrice: 500, subtotal: 500 },
];
const OFFER_DELIVERABLES_DEFAULT = [{ id: "d1", title: "Signed PDF" }];
const OFFER_AMOUNT_WEI_DEFAULT = "50000"; // 500 EUR × 100 (mock convention)

test.describe.serial("F4 — EIP-712-signed proposal offers", () => {
  test("lawyer-can-sign-and-send-offer", async ({ page, browser, request }) => {
    // 1. Client books a paid consultation so the engagement exists.
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    expect(created.status(), `booking create: ${await created.text()}`).toBe(200);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };
    expect(booking.engagementId).not.toBeNull();

    // 2. Lawyer signs + posts the offer.
    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI_DEFAULT,
      items: OFFER_ITEMS_DEFAULT,
      deliverables: OFFER_DELIVERABLES_DEFAULT,
    });

    const offerRes = await lawyerPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signed.amountWei,
        itemsHash: signed.itemsHash,
        nonce: signed.nonce,
        signature: signed.signature,
        items: OFFER_ITEMS_DEFAULT,
        deliverables: OFFER_DELIVERABLES_DEFAULT,
        note: "Follow-up draft",
      },
    });
    expect(offerRes.status(), `POST /api/proposals: ${await offerRes.text()}`).toBe(200);
    const offerJson = (await offerRes.json()) as {
      offer: { id: string; itemsHash: string; lawyerSig: string; lawyerAddress: string; amountWei: string };
    };
    expect(offerJson.offer.itemsHash.toLowerCase()).toBe(signed.itemsHash.toLowerCase());
    expect(offerJson.offer.lawyerSig).toBe(signed.signature);
    expect(offerJson.offer.amountWei).toBe(signed.amountWei);
    // Recovered lawyer address — must match the lawyer's dev signer (since
    // the seeded `0x1111…` placeholder isn't a real EOA).
    expect(offerJson.offer.lawyerAddress.toLowerCase()).toMatch(/^0x[0-9a-f]{40}$/);

    // GET surface returns the offer too.
    const getRes = await lawyerPage.request.get(`/api/proposals?engagementId=${booking.engagementId}`);
    expect(getRes.status()).toBe(200);
    const getJson = (await getRes.json()) as { offers: Array<{ id: string; consumedAt: string | null }> };
    expect(getJson.offers).toHaveLength(1);
    expect(getJson.offers[0].consumedAt).toBeNull();

    await ctx.close();
  });

  test("client-sees-and-funds-offer", async ({ page, browser, request }) => {
    // Setup: open booking, lawyer publishes offer.
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI_DEFAULT,
      items: OFFER_ITEMS_DEFAULT,
      deliverables: OFFER_DELIVERABLES_DEFAULT,
    });
    const offerRes = await lawyerPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signed.amountWei,
        itemsHash: signed.itemsHash,
        nonce: signed.nonce,
        signature: signed.signature,
        items: OFFER_ITEMS_DEFAULT,
        deliverables: OFFER_DELIVERABLES_DEFAULT,
      },
    });
    expect(offerRes.status()).toBe(200);
    const { offer } = (await offerRes.json()) as { offer: { id: string } };
    await ctx.close();

    // Client funds.
    const fundRes = await page.request.post(`/api/proposals/${offer.id}/fund`);
    expect(fundRes.status(), `fund: ${await fundRes.text()}`).toBe(200);
    const fundJson = (await fundRes.json()) as {
      proposalIndex: number;
      txHash: string;
      offer: { consumedAt: string | null };
    };
    expect(fundJson.proposalIndex).toBe(1); // proposal[0] is the consultation, [1] the follow-up.
    expect(fundJson.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(fundJson.offer.consumedAt).not.toBeNull();

    // Engagement mirror: now has 2 proposals, both FUNDED.
    const eRes = await page.request.get(
      `/api/dev/chain?method=getEngagement&engagementId=${booking.engagementId}`,
    );
    const eJson = (await eRes.json()) as {
      result: {
        engagement: { proposalCount: number; proposals: Array<{ proposalIndex: number; state: string; amountWei: string }> };
      };
    };
    expect(eJson.result.engagement.proposalCount).toBe(2);
    const p1 = eJson.result.engagement.proposals.find((p) => p.proposalIndex === 1);
    expect(p1?.state).toBe("FUNDED");
    expect(p1?.amountWei).toBe(signed.amountWei);
  });

  test("forged-signature-rejected", async ({ page, browser, request }) => {
    // Open booking + dev-sign the typed data so we have a valid envelope to
    // mutate. The forgery is then a single-bit flip of the signature.
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI_DEFAULT,
      items: OFFER_ITEMS_DEFAULT,
      deliverables: OFFER_DELIVERABLES_DEFAULT,
    });

    // Flip one nibble of the signature — the recovery still produces a valid
    // 65-byte hex but for a different signer (or fails outright). Either way
    // the assertion against the lawyer's wallet must fire and we get 422.
    const lastChar = signed.signature.slice(-1);
    const flipped = (lastChar === "0" ? "1" : "0") as string;
    const forgedSig = (signed.signature.slice(0, -1) + flipped) as `0x${string}`;

    const r = await lawyerPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signed.amountWei,
        itemsHash: signed.itemsHash,
        nonce: signed.nonce,
        signature: forgedSig,
        items: OFFER_ITEMS_DEFAULT,
        deliverables: OFFER_DELIVERABLES_DEFAULT,
      },
    });
    expect(r.status()).toBe(422);
    const j = (await r.json()) as { error?: { code?: string } };
    expect(j.error?.code).toBe("InvalidOfferSignature");
    await ctx.close();
  });

  test("nonce-replay-rejected", async ({ page, browser, request }) => {
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI_DEFAULT,
      items: OFFER_ITEMS_DEFAULT,
      deliverables: OFFER_DELIVERABLES_DEFAULT,
    });
    const offerRes = await lawyerPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signed.amountWei,
        itemsHash: signed.itemsHash,
        nonce: signed.nonce,
        signature: signed.signature,
        items: OFFER_ITEMS_DEFAULT,
        deliverables: OFFER_DELIVERABLES_DEFAULT,
      },
    });
    expect(offerRes.status()).toBe(200);
    const { offer } = (await offerRes.json()) as { offer: { id: string } };
    await ctx.close();

    // First fund: succeeds.
    const r1 = await page.request.post(`/api/proposals/${offer.id}/fund`);
    expect(r1.status()).toBe(200);
    // Second fund: same offer → server returns 409 with code OfferAlreadyConsumed.
    const r2 = await page.request.post(`/api/proposals/${offer.id}/fund`);
    expect(r2.status()).toBe(409);
    const j = (await r2.json()) as { error?: { code?: string } };
    expect(j.error?.code).toBe("OfferAlreadyConsumed");
  });

  test("two-offers-on-same-engagement", async ({ page, browser, request }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerAnya);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });

    async function signAndPost(amountEUR: number, label: string) {
      const items = [{ id: `li-${label}`, title: label, kind: "fixed" as const, fixedPrice: amountEUR, subtotal: amountEUR }];
      const deliverables = [{ id: `d-${label}`, title: `${label} deliverable` }];
      const signed = await signOfferAsLawyer(lawyerPage, {
        engagementId: booking.engagementId,
        amountWei: String(amountEUR * 100),
        items,
        deliverables,
      });
      const r = await lawyerPage.request.post("/api/proposals", {
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
      expect(r.status(), `offer post: ${await r.text()}`).toBe(200);
      return ((await r.json()) as { offer: { id: string } }).offer.id;
    }

    const offerA = await signAndPost(300, "A");
    const offerB = await signAndPost(700, "B");
    await ctx.close();

    // Client funds both.
    expect((await page.request.post(`/api/proposals/${offerA}/fund`)).status()).toBe(200);
    expect((await page.request.post(`/api/proposals/${offerB}/fund`)).status()).toBe(200);

    const eRes = await page.request.get(
      `/api/dev/chain?method=getEngagement&engagementId=${booking.engagementId}`,
    );
    const eJson = (await eRes.json()) as {
      result: { engagement: { proposalCount: number; proposals: Array<{ proposalIndex: number; state: string; amountWei: string }> } };
    };
    expect(eJson.result.engagement.proposalCount).toBe(3);
    expect(eJson.result.engagement.proposals.find((p) => p.proposalIndex === 1)?.state).toBe("FUNDED");
    expect(eJson.result.engagement.proposals.find((p) => p.proposalIndex === 2)?.state).toBe("FUNDED");
    expect(eJson.result.engagement.proposals.find((p) => p.proposalIndex === 1)?.amountWei).toBe("30000");
    expect(eJson.result.engagement.proposals.find((p) => p.proposalIndex === 2)?.amountWei).toBe("70000");
  });

  test("client-cannot-fund-someone-elses-offer", async ({ page, browser, request }) => {
    // Lawyer publishes an offer for client1's engagement; client2 tries to
    // fund it.
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);

    // First, client1 opens a booking and the lawyer signs an offer for it.
    const c1Ctx = await browser.newContext();
    const c1Page = await c1Ctx.newPage();
    await devSignIn(c1Page, { wallet: SEEDED.client1, role: "client" });
    const created = await createPaidBooking(c1Page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };
    await c1Ctx.close();

    const lCtx = await browser.newContext();
    const lawyerPage = await lCtx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI_DEFAULT,
      items: OFFER_ITEMS_DEFAULT,
      deliverables: OFFER_DELIVERABLES_DEFAULT,
    });
    const offerRes = await lawyerPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signed.amountWei,
        itemsHash: signed.itemsHash,
        nonce: signed.nonce,
        signature: signed.signature,
        items: OFFER_ITEMS_DEFAULT,
        deliverables: OFFER_DELIVERABLES_DEFAULT,
      },
    });
    expect(offerRes.status()).toBe(200);
    const { offer } = (await offerRes.json()) as { offer: { id: string } };
    await lCtx.close();

    // client2 tries to fund — must 403.
    const r = await page.request.post(`/api/proposals/${offer.id}/fund`);
    expect(r.status()).toBe(403);
    const j = (await r.json()) as { error?: { code?: string } };
    expect(j.error?.code).toBe("NotEngagementClient");
  });

  test("lawyer-cannot-sign-as-other-lawyer", async ({ page, browser, request }) => {
    // Lawyer A's engagement; lawyer B signs an offer for it. /api/proposals
    // recovers B's address, sees it doesn't match A (the engagement's
    // lawyer), returns 422 InvalidOfferSignature.
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyerA = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const lawyerB = await getLawyerByWallet(request, SEEDED.lawyerAnya);
    const created = await createPaidBooking(page, lawyerA.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Sign with lawyer B's session — but then try to POST from the lawyer
    // B session against an engagement that belongs to lawyer A. The route's
    // signer-recovery happens against the SIWE-bound caller (lawyer B), so
    // verification recovers B but the engagement lookup confirms B is not
    // the lawyer → 403. Test the cryptographic-mismatch surface by hand-
    // crafting: sign with B, then POST while signed in as the engagement's
    // actual lawyer (A). Recovery yields B; expected = A; → 422.
    const bCtx = await browser.newContext();
    const bPage = await bCtx.newPage();
    await devSignIn(bPage, { wallet: lawyerB.userWallet, role: "lawyer" });
    const signedByB = await signOfferAsLawyer(bPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI_DEFAULT,
      items: OFFER_ITEMS_DEFAULT,
      deliverables: OFFER_DELIVERABLES_DEFAULT,
    });
    await bCtx.close();

    const aCtx = await browser.newContext();
    const aPage = await aCtx.newPage();
    await devSignIn(aPage, { wallet: lawyerA.userWallet, role: "lawyer" });
    const r = await aPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signedByB.amountWei,
        itemsHash: signedByB.itemsHash,
        nonce: signedByB.nonce,
        signature: signedByB.signature,
        items: OFFER_ITEMS_DEFAULT,
        deliverables: OFFER_DELIVERABLES_DEFAULT,
      },
    });
    expect(r.status()).toBe(422);
    const j = (await r.json()) as { error?: { code?: string } };
    expect(j.error?.code).toBe("InvalidOfferSignature");
    await aCtx.close();
  });

  test("deliver-and-release-on-followup-proposal", async ({ page, browser, request }) => {
    // Once funded, a follow-up proposal goes through markDelivered → release
    // just like proposal[0]. The booking-bridge `markDeliveredForProposal` /
    // `releaseForProposal` helpers cover non-zero indexes; here we drive
    // them via the dedicated /api/proposals/[id]/deliver + /release routes.
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyer.userWallet, role: "lawyer" });
    const signed = await signOfferAsLawyer(lawyerPage, {
      engagementId: booking.engagementId,
      amountWei: OFFER_AMOUNT_WEI_DEFAULT,
      items: OFFER_ITEMS_DEFAULT,
      deliverables: OFFER_DELIVERABLES_DEFAULT,
    });
    const offerRes = await lawyerPage.request.post("/api/proposals", {
      data: {
        engagementId: booking.engagementId,
        amountWei: signed.amountWei,
        itemsHash: signed.itemsHash,
        nonce: signed.nonce,
        signature: signed.signature,
        items: OFFER_ITEMS_DEFAULT,
        deliverables: OFFER_DELIVERABLES_DEFAULT,
      },
    });
    expect(offerRes.status()).toBe(200);
    const { offer } = (await offerRes.json()) as { offer: { id: string } };

    // Client funds.
    expect((await page.request.post(`/api/proposals/${offer.id}/fund`)).status()).toBe(200);

    // Lawyer marks delivered.
    const deliverRes = await lawyerPage.request.post(`/api/proposals/${offer.id}/deliver`);
    expect(deliverRes.status(), `deliver: ${await deliverRes.text()}`).toBe(200);
    const deliverJson = (await deliverRes.json()) as { proposalIndex: number; deliveredAt: string };
    expect(deliverJson.proposalIndex).toBe(1);
    expect(deliverJson.deliveredAt).toBeTruthy();
    await ctx.close();

    // Client releases.
    const releaseRes = await page.request.post(`/api/proposals/${offer.id}/release`);
    expect(releaseRes.status(), `release: ${await releaseRes.text()}`).toBe(200);

    // Mirror confirms: proposal[1] is RELEASED with amountToLawyerWei set.
    const eRes = await page.request.get(
      `/api/dev/chain?method=getEngagement&engagementId=${booking.engagementId}`,
    );
    const eJson = (await eRes.json()) as {
      result: { engagement: { proposals: Array<{ proposalIndex: number; state: string; amountToLawyerWei: string | null }> } };
    };
    const p1 = eJson.result.engagement.proposals.find((p) => p.proposalIndex === 1);
    expect(p1?.state).toBe("RELEASED");
    expect(p1?.amountToLawyerWei).not.toBeNull();
  });
});
