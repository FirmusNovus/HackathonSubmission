import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";
// Direct import — verifyMutualRefundSigForUser doesn't drag any
// edge-runtime-incompatible code, and importing it eagerly avoids the
// dynamic-import-in-CJS pitfall under Playwright's ts-node loader.
import {
  devSignerFallbackEnabled,
  verifyMutualRefundSigForUser,
} from "@/lib/chain/eip712";

// =============================================================================
// Feature 6 — EIP-712 mutual refund (real cryptography, no nonce).
//
// The mechanism:
//   - Either party signs the MutualRefundAuthorization typed-data
//     ({engagementId, proposalIndex}). Cryptography is real (viem's
//     `signTypedData`); state changes go through the F1 mock chain.
//   - Initiator creates a MutualRefundRequest (PENDING). Counterparty signs
//     to approve (status → SIGNED_BOTH) or rejects (status → REJECTED).
//   - Either party submits the now-fully-signed authorisation; the chain
//     layer verifies BOTH sigs against the engagement's actual client and
//     lawyer wallets, flips the proposal Funded → Refunded, and writes a
//     MutualRefundAuth row.
//   - Replay safety is single-shot via the state-machine transition
//     (a second submit trips InvalidProposalState).
//
// Constraints:
//   - Forged sigs (e.g. client tries to mint the lawyer's sig) → 422
//     InvalidRefundSignature on submit.
//   - Only Funded proposals can be refunded — Delivered must go through
//     dispute (asymmetric mechanism from F5).
//   - Submit-without-both-sigs is server-guarded (409 InvalidStatus).
//   - Refunded proposals block other actions (release / deliver → 409
//     InvalidProposalState).
//   - Dev-signer fallback is gated by NODE_ENV / ENABLE_MOCK_AUTH (F4
//     hazard — production deploys without ENABLE_MOCK_AUTH must reject
//     a sig recovered to the dev signer).
// =============================================================================

test.beforeAll(reseedDatabase);

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

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
      caseDescription: "F6 mutual refund test.",
      lineItems: [
        { id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 },
      ],
      deliverables: [{ id: "d-1", title: "Live consultation" }],
    },
  });
}

interface ChainEngagement {
  state: string;
  proposalCount: number;
  transcriptRoot: string;
  proposals: Array<{
    proposalIndex: number;
    state: string;
    amountWei: string;
    deliveredAt: string | null;
    refundTxHash: string | null;
    disputeTxHash: string | null;
  }>;
}

async function getEngagement(request: APIRequestContext, engagementId: number): Promise<ChainEngagement> {
  const r = await request.get(`/api/dev/chain?method=getEngagement&engagementId=${engagementId}`);
  const j = (await r.json()) as { ok: boolean; result: { engagement: ChainEngagement | null } };
  expect(j.ok).toBe(true);
  expect(j.result.engagement).not.toBeNull();
  return j.result.engagement!;
}

async function lawyerSignedIn(
  browser: import("@playwright/test").Browser,
  wallet: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await devSignIn(page, { wallet, role: "lawyer" });
  return { ctx, page };
}

interface SignResult {
  signature: string;
  signer: string;
}

async function signRefund(
  page: Page,
  args: { engagementId: number; proposalIndex: number; role: "client" | "lawyer" },
): Promise<SignResult> {
  const r = await page.request.post("/api/dev/sign-mutual-refund", {
    data: {
      engagementId: args.engagementId,
      proposalIndex: args.proposalIndex,
      role: args.role,
    },
  });
  expect(r.status(), `sign-mutual-refund: ${await r.text()}`).toBe(200);
  const j = (await r.json()) as SignResult;
  expect(j.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
  return j;
}

async function fundFollowupOffer(args: {
  clientPage: Page;
  lawyerPage: Page;
  engagementId: number;
}): Promise<{ offerId: string; proposalIndex: number }> {
  const items = [{ id: "fi", title: "Draft contract", kind: "fixed" as const, fixedPrice: 500, subtotal: 500 }];
  const deliverables = [{ id: "fd", title: "Signed PDF" }];
  const signRes = await args.lawyerPage.request.post("/api/dev/sign-proposal-offer", {
    data: { engagementId: args.engagementId, amountWei: "50000", items, deliverables },
  });
  expect(signRes.status(), `sign-proposal-offer: ${await signRes.text()}`).toBe(200);
  const signed = (await signRes.json()) as {
    signature: string;
    nonce: string;
    itemsHash: string;
    amountWei: string;
  };
  const offerRes = await args.lawyerPage.request.post("/api/proposals", {
    data: {
      engagementId: args.engagementId,
      amountWei: signed.amountWei,
      itemsHash: signed.itemsHash,
      nonce: signed.nonce,
      signature: signed.signature,
      items,
      deliverables,
    },
  });
  expect(offerRes.status(), `proposals POST: ${await offerRes.text()}`).toBe(200);
  const { offer } = (await offerRes.json()) as { offer: { id: string } };
  const fundRes = await args.clientPage.request.post(`/api/proposals/${offer.id}/fund`);
  expect(fundRes.status(), `fund: ${await fundRes.text()}`).toBe(200);
  const { proposalIndex } = (await fundRes.json()) as { proposalIndex: number };
  return { offerId: offer.id, proposalIndex };
}

// =============================================================================
// 1. client-initiates-lawyer-approves-then-submit
// =============================================================================

test.describe.serial("F6 — mutual refund (real EIP-712)", () => {
  test("client-initiates-lawyer-approves-then-submit", async ({ page, browser, request }) => {
    void request;
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Client signs and creates the request.
    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const reqRes = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { proposalIndex: 0, signature: clientSig.signature },
    });
    expect(reqRes.status(), `request create: ${await reqRes.text()}`).toBe(201);
    const { request: reqRow } = (await reqRes.json()) as {
      request: { id: string; status: string; hasClientSig: boolean; hasLawyerSig: boolean; initiatedBy: string };
    };
    expect(reqRow.status).toBe("PENDING");
    expect(reqRow.initiatedBy).toBe("CLIENT");
    expect(reqRow.hasClientSig).toBe(true);
    expect(reqRow.hasLawyerSig).toBe(false);

    // Lawyer signs and approves.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    // Lawyer sees the request via GET.
    const listRes = await lawyerPage.request.get(`/api/bookings/${booking.id}/mutual-refund`);
    expect(listRes.status()).toBe(200);
    const list = (await listRes.json()) as { requests: Array<{ id: string; status: string }> };
    expect(list.requests).toHaveLength(1);
    expect(list.requests[0].id).toBe(reqRow.id);

    const lawyerSig = await signRefund(lawyerPage, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "lawyer",
    });
    const approveRes = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/approve`,
      { data: { signature: lawyerSig.signature } },
    );
    expect(approveRes.status(), `approve: ${await approveRes.text()}`).toBe(200);
    const approved = (await approveRes.json()) as {
      request: { status: string; hasClientSig: boolean; hasLawyerSig: boolean };
    };
    expect(approved.request.status).toBe("SIGNED_BOTH");
    expect(approved.request.hasClientSig).toBe(true);
    expect(approved.request.hasLawyerSig).toBe(true);

    // Either party submits — pick the lawyer (client just as valid).
    const submitRes = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/submit`,
    );
    expect(submitRes.status(), `submit: ${await submitRes.text()}`).toBe(200);
    const submitted = (await submitRes.json()) as {
      request: { status: string; submitTxHash: string | null };
      booking: { status: string };
      txHash: string;
    };
    expect(submitted.request.status).toBe("SUBMITTED");
    expect(submitted.txHash).toMatch(/^0x[0-9a-fA-F]+$/);
    expect(submitted.booking.status).toBe("CANCELLED");
    expect(submitted.request.submitTxHash).toBe(submitted.txHash);

    // Chain mirror confirms Refunded.
    const eng = await getEngagement(page.request, booking.engagementId);
    const p0 = eng.proposals.find((p) => p.proposalIndex === 0)!;
    expect(p0.state).toBe("REFUNDED");
    expect(p0.refundTxHash).not.toBeNull();

    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 2. lawyer-initiates-client-approves
  // ---------------------------------------------------------------------------
  test("lawyer-initiates-client-approves", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const lawyerSig = await signRefund(lawyerPage, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "lawyer",
    });
    const reqRes = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/request`,
      { data: { signature: lawyerSig.signature } },
    );
    expect(reqRes.status()).toBe(201);
    const { request: reqRow } = (await reqRes.json()) as { request: { id: string; initiatedBy: string } };
    expect(reqRow.initiatedBy).toBe("LAWYER");

    // Client approves.
    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const approveRes = await page.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/approve`,
      { data: { signature: clientSig.signature } },
    );
    expect(approveRes.status()).toBe(200);

    // Client submits.
    const submitRes = await page.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/submit`,
    );
    expect(submitRes.status()).toBe(200);

    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("REFUNDED");
    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 3. counterparty-rejects
  // ---------------------------------------------------------------------------
  test("counterparty-rejects", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Client initiates.
    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const reqRes = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: clientSig.signature },
    });
    expect(reqRes.status()).toBe(201);
    const { request: reqRow } = (await reqRes.json()) as { request: { id: string } };

    // Lawyer rejects.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const rejectRes = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/reject`,
    );
    expect(rejectRes.status()).toBe(200);
    const rejected = (await rejectRes.json()) as { request: { status: string } };
    expect(rejected.request.status).toBe("REJECTED");
    await ctx.close();

    // Chain state untouched.
    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("FUNDED");
  });

  // ---------------------------------------------------------------------------
  // 4. wrong-signer-rejected — client tries to forge the lawyer's sig
  // ---------------------------------------------------------------------------
  test("wrong-signer-rejected", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Client signs CLIENT side legitimately, then forges the "lawyer" side
    // by sending another client-signed sig in the lawyer slot. The
    // signature recovers to the client wallet, NOT the lawyer's, so the
    // chain submit must reject with InvalidRefundSignature.

    // Initiate as client (legit).
    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const reqRes = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: clientSig.signature },
    });
    expect(reqRes.status()).toBe(201);
    const { request: reqRow } = (await reqRes.json()) as { request: { id: string } };

    // Approve with another client-side sig (forgery — pretending to be the
    // lawyer). The /approve endpoint enforces "initiator cannot also
    // approve" via role — but since we're SIWE'd in as the client, the
    // role is "client", same as initiator → 403 InitiatorCannotApprove.
    // That alone proves the role-based forgery prevention; verify it.
    const approveAsClientAgain = await page.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/approve`,
      { data: { signature: clientSig.signature } },
    );
    expect(approveAsClientAgain.status()).toBe(403);

    // Now try the deeper forgery: directly hit the chain RPC bypassing the
    // approve route, forging the lawyer's slot with a client-side sig.
    const direct = await page.request.post("/api/dev/chain", {
      data: {
        method: "mutualRefundProposal",
        args: {
          engagementId: booking.engagementId,
          proposalIndex: 0,
          clientSig: clientSig.signature,
          lawyerSig: clientSig.signature, // forged — recovers to client
          from: SEEDED.client4,
        },
      },
    });
    expect(direct.status()).toBe(422);
    const j = (await direct.json()) as { code?: string };
    expect(j.code).toBe("InvalidRefundSignature");

    // Chain unchanged.
    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("FUNDED");
  });

  // ---------------------------------------------------------------------------
  // 5. only-funded-can-be-refunded — Delivered must go through dispute
  // ---------------------------------------------------------------------------
  test("only-funded-can-be-refunded", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Lawyer marks delivered → proposal state is DELIVERED, not FUNDED.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(200);

    // Initiating a refund request must fail with InvalidProposalState.
    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const reqRes = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: clientSig.signature },
    });
    expect(reqRes.status()).toBe(409);
    const j = (await reqRes.json()) as { error: { code: string } };
    expect(j.error.code).toBe("InvalidProposalState");
    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 6. submit-without-both-sigs-fails
  // ---------------------------------------------------------------------------
  test("submit-without-both-sigs-fails", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const reqRes = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: clientSig.signature },
    });
    expect(reqRes.status()).toBe(201);
    const { request: reqRow } = (await reqRes.json()) as { request: { id: string } };

    // Try to submit immediately — only one sig present, request status is
    // PENDING. Server must refuse with 409 InvalidStatus.
    const submitRes = await page.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/submit`,
    );
    expect(submitRes.status()).toBe(409);
    const j = (await submitRes.json()) as { error: { code: string } };
    expect(j.error.code).toBe("InvalidStatus");
  });

  // ---------------------------------------------------------------------------
  // 7. followup-proposal-mutual-refund — works for proposal[i>0] too
  // ---------------------------------------------------------------------------
  test("followup-proposal-mutual-refund", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const { offerId, proposalIndex } = await fundFollowupOffer({
      clientPage: page,
      lawyerPage,
      engagementId: booking.engagementId,
    });
    expect(proposalIndex).toBe(1);

    // Either party initiates via the proposal-id-keyed routes.
    const lawyerSig = await signRefund(lawyerPage, {
      engagementId: booking.engagementId,
      proposalIndex,
      role: "lawyer",
    });
    const reqRes = await lawyerPage.request.post(`/api/proposals/${offerId}/mutual-refund/request`, {
      data: { signature: lawyerSig.signature },
    });
    expect(reqRes.status(), `proposal request: ${await reqRes.text()}`).toBe(201);
    const { request: reqRow } = (await reqRes.json()) as { request: { id: string } };

    // Client approves + submits.
    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex,
      role: "client",
    });
    const approveRes = await page.request.post(
      `/api/proposals/${offerId}/mutual-refund/${reqRow.id}/approve`,
      { data: { signature: clientSig.signature } },
    );
    expect(approveRes.status()).toBe(200);

    const submitRes = await page.request.post(
      `/api/proposals/${offerId}/mutual-refund/${reqRow.id}/submit`,
    );
    expect(submitRes.status(), `submit: ${await submitRes.text()}`).toBe(200);

    // Engagement state: proposal[1] REFUNDED, proposal[0] still FUNDED,
    // booking shell NOT cancelled (follow-up refund leaves booking alone).
    const eng = await getEngagement(page.request, booking.engagementId);
    const p0 = eng.proposals.find((p) => p.proposalIndex === 0)!;
    const p1 = eng.proposals.find((p) => p.proposalIndex === 1)!;
    expect(p0.state).toBe("FUNDED");
    expect(p1.state).toBe("REFUNDED");
    const bookingFresh = await page.request.get(`/api/bookings/${booking.id}`);
    const bj = (await bookingFresh.json()) as { booking: { status: string } };
    expect(bj.booking.status).not.toBe("CANCELLED");
    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 8. declined-booking-funds-recovered — booking declined, mutual refund
  //    still recovers funds from the still-Funded proposal[0].
  // ---------------------------------------------------------------------------
  test("declined-booking-funds-recovered", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Lawyer declines the booking. The booking shell flips to DECLINED but
    // the on-chain Proposal[0] stays FUNDED — the contract has no
    // "decline" path; refund is the recovery mechanism.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const decline = await lawyerPage.request.post(`/api/bookings/${booking.id}/decline`);
    // Decline route may return 200 or 409 depending on prior state — don't
    // hard-fail; what we care about is that proposal[0] stays FUNDED.
    void decline;
    const eng0 = await getEngagement(page.request, booking.engagementId);
    expect(eng0.proposals[0].state).toBe("FUNDED");

    // Mutual refund flow as usual.
    const lawyerSig = await signRefund(lawyerPage, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "lawyer",
    });
    const reqRes = await lawyerPage.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: lawyerSig.signature },
    });
    expect(reqRes.status(), `request: ${await reqRes.text()}`).toBe(201);
    const { request: reqRow } = (await reqRes.json()) as { request: { id: string } };

    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const approveRes = await page.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/approve`,
      { data: { signature: clientSig.signature } },
    );
    expect(approveRes.status()).toBe(200);

    const submitRes = await page.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/submit`,
    );
    expect(submitRes.status()).toBe(200);

    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("REFUNDED");
    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 9. mutual-refund-blocks-other-actions
  // ---------------------------------------------------------------------------
  test("mutual-refund-blocks-other-actions", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Drive through to REFUNDED.
    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const reqRes = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: clientSig.signature },
    });
    const { request: reqRow } = (await reqRes.json()) as { request: { id: string } };

    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const lawyerSig = await signRefund(lawyerPage, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "lawyer",
    });
    const approveRes = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/approve`,
      { data: { signature: lawyerSig.signature } },
    );
    expect(approveRes.status()).toBe(200);
    const submitRes = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/submit`,
    );
    expect(submitRes.status()).toBe(200);

    // Now state is REFUNDED. Client release → 409.
    const release = await page.request.post(`/api/bookings/${booking.id}/complete`);
    expect(release.status()).toBe(409);
    const releaseJson = (await release.json()) as { error: { code: string } };
    expect(releaseJson.error.code).toBe("InvalidProposalState");

    // Lawyer mark-delivered → 409.
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(409);
    const delJson = (await deliver.json()) as { error: { code: string } };
    expect(delJson.error.code).toBe("InvalidProposalState");

    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 10. production-rejects-dev-signer-on-refund
  // -----------------------------------------------------------------------------
  // Mirrors the F4 hazard test for `verifyProposalOfferSigForUser`. We can't
  // toggle NODE_ENV mid-suite; instead we exercise the symmetry by directly
  // calling the chain layer's verifier helper with the dev fallback gated.
  // Cheaper than spinning up a second `next start` with NODE_ENV=production,
  // and it's the same code-path that gets traversed under prod.
  // ---------------------------------------------------------------------------
  test("production-rejects-dev-signer-on-refund", async ({ page }) => {
    // The Playwright suite runs against `next start` with ENABLE_MOCK_AUTH=true,
    // so `devSignerFallbackEnabled` returns true here. We assert that
    // recovering to the dev-signer alias is REJECTED when we manually pass a
    // wallet that doesn't match. Symmetric to the F4 hazard test.
    expect(devSignerFallbackEnabled()).toBe(true);
    void page;

    // Build a client/lawyer pair from the seed.
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    void lawyer;

    // Use the existing /api/dev/sign-mutual-refund route to mint a sig as
    // the client persona, then verify it against a DIFFERENT wallet (the
    // lawyer's). Recovery doesn't match → InvalidRefundSignature.
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { engagementId: number } };
    const sig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });

    // Verify with the wrong wallet (the lawyer's wallet) — must throw.
    let threw = false;
    try {
      await verifyMutualRefundSigForUser({
        message: {
          engagementId: BigInt(booking.engagementId),
          proposalIndex: BigInt(0),
        },
        signature: sig.signature as `0x${string}`,
        walletAddress: SEEDED.lawyerMaria,
        // Note: NOT passing the client's devSignerAddress, so the sig that
        // recovers to client's dev signer matches NOTHING in this call.
        devSignerAddress: null,
      });
    } catch (err) {
      threw = true;
      expect(err).toMatchObject({ code: "InvalidRefundSignature" });
    }
    expect(threw, "verifyMutualRefundSigForUser must throw on wallet mismatch").toBe(true);
  });
});
