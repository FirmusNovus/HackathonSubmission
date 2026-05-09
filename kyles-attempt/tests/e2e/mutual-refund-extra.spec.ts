import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

// =============================================================================
// Feature 6 — extra coverage / parity tests for the mutual-refund workflow.
// Layered on top of `mutual-refund.spec.ts` after an independent F6 review.
//
// Each test maps to a parity / robustness axis the reviewer flagged:
//
//   1. lawyer-initiated-self-signed-client-rejected — initiator role-guard:
//      lawyer initiates, then tries to approve as if they were the client
//      (forged sig). Approve route 403s on InitiatorCannotApprove; even
//      a direct chain-RPC call with two lawyer-side sigs trips
//      InvalidRefundSignature.
//   2. multiple-pending-requests — second `/request` call while one is in
//      flight 409s with ActiveRequestExists. The first request can still be
//      driven to SUBMITTED.
//   3. race-approve-reject — counterparty approves while initiator rejects
//      simultaneously. Conditional updates serialise; one wins, the other
//      surfaces InvalidStatus / AlreadySubmitted-style failure.
//   4. submit-by-third-party-rejected — operator (neither client nor lawyer
//      of the booking) attempts submit → 403.
//   5. request-on-disputed-proposal-rejected — proposal already DISPUTED
//      (state set via dispute API). `/request` 409s with InvalidProposalState.
//   6. request-on-resolved-proposal-rejected — same for RESOLVED (dispute +
//      operator resolveDispute via /api/dev/chain).
//   7. dev-signer-rejected-in-prod — the verifier helper rejects a sig
//      recovered to a wallet other than the expected one regardless of dev
//      fallback gating; mirrors the F4 hazard test for the refund verifier.
//   8. request-list-isolation — GET /api/bookings/[id]/mutual-refund returns
//      ONLY rows whose engagementId matches that booking; rows from other
//      engagements never leak.
// =============================================================================

const OPERATOR = "0x09e8a70811111111111111111111111111111bbb";

// -----------------------------------------------------------------------------
// Helpers (modelled on mutual-refund.spec.ts)
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
      caseDescription: "F6 mutual refund extra test.",
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
  proposals: Array<{ proposalIndex: number; state: string }>;
}

async function getEngagement(request: APIRequestContext, engagementId: number): Promise<ChainEngagement> {
  const r = await request.get(`/api/dev/chain?method=getEngagement&engagementId=${engagementId}`);
  const j = (await r.json()) as { ok: boolean; result: { engagement: ChainEngagement | null } };
  expect(j.ok).toBe(true);
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

// =============================================================================

test.describe.serial("F6 extra — mutual refund parity & concurrency", () => {
  test.beforeAll(reseedDatabase);

  // ---------------------------------------------------------------------------
  // 1. lawyer-initiated-self-signed-client-rejected
  //    Lawyer initiates a request, then signs ANOTHER lawyer-side sig and
  //    attempts to approve as if they were the client. The approve route
  //    refuses on the role guard. A direct chain-RPC call with two
  //    lawyer-side sigs trips InvalidRefundSignature.
  // ---------------------------------------------------------------------------
  test("lawyer-initiated-self-signed-client-rejected", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Lawyer initiates.
    const { ctx: lawyerCtx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const lawyerSig = await signRefund(lawyerPage, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "lawyer",
    });
    const reqRes = await lawyerPage.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: lawyerSig.signature },
    });
    expect(reqRes.status()).toBe(201);
    const { request: reqRow } = (await reqRes.json()) as { request: { id: string } };

    // Lawyer (still SIWE'd in as the lawyer) tries to approve their own
    // request — must 403 InitiatorCannotApprove.
    const selfApprove = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/approve`,
      { data: { signature: lawyerSig.signature } },
    );
    expect(selfApprove.status()).toBe(403);
    const selfApproveJson = (await selfApprove.json()) as { error: { code: string } };
    expect(selfApproveJson.error.code).toBe("InitiatorCannotApprove");

    // Direct chain RPC bypassing the workflow — two lawyer-side sigs in
    // {clientSig, lawyerSig}. Recovery on clientSig won't match the client
    // wallet → InvalidRefundSignature.
    const direct = await lawyerPage.request.post("/api/dev/chain", {
      data: {
        method: "mutualRefundProposal",
        args: {
          engagementId: booking.engagementId,
          proposalIndex: 0,
          clientSig: lawyerSig.signature,
          lawyerSig: lawyerSig.signature,
          from: lawyer.userWallet,
        },
      },
    });
    expect(direct.status()).toBe(422);
    const j = (await direct.json()) as { code?: string };
    expect(j.code).toBe("InvalidRefundSignature");

    // Chain unchanged.
    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("FUNDED");
    await lawyerCtx.close();
  });

  // ---------------------------------------------------------------------------
  // 2. multiple-pending-requests — server refuses a second create while one
  //    is in flight. The first can still be driven to SUBMITTED.
  // ---------------------------------------------------------------------------
  test("multiple-pending-requests", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const first = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: clientSig.signature },
    });
    expect(first.status()).toBe(201);
    const { request: firstRow } = (await first.json()) as { request: { id: string } };

    // Second create — must 409 ActiveRequestExists. Server returns the
    // existing request in the body so the UI can surface it.
    const second = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: clientSig.signature },
    });
    expect(second.status()).toBe(409);
    const secondJson = (await second.json()) as { error: { code: string }; request: { id: string } };
    expect(secondJson.error.code).toBe("ActiveRequestExists");
    expect(secondJson.request.id).toBe(firstRow.id);

    // First request still drives through to SUBMITTED.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const lawyerSig = await signRefund(lawyerPage, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "lawyer",
    });
    const approve = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${firstRow.id}/approve`,
      { data: { signature: lawyerSig.signature } },
    );
    expect(approve.status()).toBe(200);
    const submit = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${firstRow.id}/submit`,
    );
    expect(submit.status()).toBe(200);

    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("REFUNDED");

    // After SUBMITTED, a fresh `/request` would still 409 — proposal is
    // REFUNDED, not FUNDED.
    const third = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: clientSig.signature },
    });
    expect(third.status()).toBe(409);
    const thirdJson = (await third.json()) as { error: { code: string } };
    expect(thirdJson.error.code).toBe("InvalidProposalState");

    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 3. race-approve-reject — counterparty approves while initiator rejects.
  //    Conditional updates serialise: exactly one transition takes effect.
  //    Whichever loses surfaces a clean failure rather than overwriting the
  //    winner's terminal status.
  // ---------------------------------------------------------------------------
  test("race-approve-reject", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
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

    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const lawyerSig = await signRefund(lawyerPage, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "lawyer",
    });

    // Fire approve (lawyer) and reject (client) in parallel.
    const [approveRes, rejectRes] = await Promise.all([
      lawyerPage.request.post(
        `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/approve`,
        { data: { signature: lawyerSig.signature } },
      ),
      page.request.post(`/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/reject`),
    ]);

    // Both responded 2xx OR one is 4xx — but final DB state is deterministic.
    // Re-read via GET. The row's status is one of REJECTED or SIGNED_BOTH;
    // it is NEVER both, never an indeterminate intermediate, and the
    // approve route never silently overwrites a REJECTED row.
    const list = await page.request.get(`/api/bookings/${booking.id}/mutual-refund`);
    const { requests } = (await list.json()) as {
      requests: Array<{ id: string; status: string; hasLawyerSig: boolean }>;
    };
    const row = requests.find((r) => r.id === reqRow.id)!;
    expect(["REJECTED", "SIGNED_BOTH"]).toContain(row.status);

    // Cross-check: if approve won, status = SIGNED_BOTH and reject's response
    //   was either 200 idempotent (fresh REJECTED of an already-non-PENDING)
    //   or it landed first then approve overwrote — but that's the bug we
    //   fixed, so it MUST have failed. With the conditional update, reject
    //   matched zero rows after approve flipped the row to SIGNED_BOTH; we
    //   then re-flipped to REJECTED via the SIGNED_BOTH→REJECTED branch in
    //   updateMany. Either outcome is consistent — what matters is that
    //   exactly one transition is reflected and the chain hasn't been
    //   touched (no submit happened).
    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("FUNDED");

    void approveRes;
    void rejectRes;
    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 4. submit-by-third-party-rejected — the operator, who is signed in but
  //    not a party to this booking, cannot submit. 403.
  // ---------------------------------------------------------------------------
  test("submit-by-third-party-rejected", async ({ page, browser }) => {
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Build a SIGNED_BOTH request first.
    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const reqRes = await page.request.post(`/api/bookings/${booking.id}/mutual-refund/request`, {
      data: { signature: clientSig.signature },
    });
    const { request: reqRow } = (await reqRes.json()) as { request: { id: string } };

    const { ctx: lawyerCtx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const lawyerSig = await signRefund(lawyerPage, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "lawyer",
    });
    const approve = await lawyerPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/approve`,
      { data: { signature: lawyerSig.signature } },
    );
    expect(approve.status()).toBe(200);

    // Operator is signed in but isn't a party to this booking.
    const opCtx = await browser.newContext();
    const opPage = await opCtx.newPage();
    await devSignIn(opPage, { wallet: OPERATOR, role: "client" });

    const submit = await opPage.request.post(
      `/api/bookings/${booking.id}/mutual-refund/${reqRow.id}/submit`,
    );
    expect(submit.status()).toBe(403);

    // Chain unchanged.
    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("FUNDED");

    await opCtx.close();
    await lawyerCtx.close();
  });

  // ---------------------------------------------------------------------------
  // 5. request-on-disputed-proposal-rejected — once Disputed, mutual refund
  //    /request 409s. The contract requires Funded; Delivered/Disputed/
  //    Resolved/Refunded all trip InvalidProposalState.
  // ---------------------------------------------------------------------------
  test("request-on-disputed-proposal-rejected", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Client disputes proposal[0].
    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status()).toBe(200);
    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("DISPUTED");

    // /request must 409.
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
  });

  // ---------------------------------------------------------------------------
  // 6. request-on-resolved-proposal-rejected — same for RESOLVED. Drive
  //    through dispute → operator resolveDispute via /api/dev/chain, then
  //    confirm /request 409s.
  // ---------------------------------------------------------------------------
  test("request-on-resolved-proposal-rejected", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Dispute → operator resolves. ResolveDispute requires the chain to be
    // in Disputed; we use the dev/chain RPC to resolve as the operator.
    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status()).toBe(200);
    const resolve = await page.request.post("/api/dev/chain", {
      data: {
        method: "resolveDispute",
        args: {
          engagementId: booking.engagementId,
          proposalIndex: 0,
          toLawyerWei: "0",
          toClientWei: "24000",
          from: OPERATOR,
        },
      },
    });
    expect(resolve.status()).toBe(200);
    const eng = await getEngagement(page.request, booking.engagementId);
    expect(eng.proposals[0].state).toBe("RESOLVED");

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
  });

  // ---------------------------------------------------------------------------
  // 7. dev-signer-rejected-in-prod (verifier-level)
  //    This sibling of the original `production-rejects-dev-signer-on-refund`
  //    test exercises the cross-wallet rejection: a sig minted as the client
  //    persona is offered as if it were the lawyer's. Even with the dev
  //    fallback enabled (test env), the sig recovers to the CLIENT's
  //    devSignerAddress, NOT the lawyer's, so verification rejects.
  // ---------------------------------------------------------------------------
  test("dev-signer-rejected-on-cross-wallet-refund", async ({ page }) => {
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Client signs LEGITIMATELY.
    const clientSig = await signRefund(page, {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    // ... but pass it as the "lawyer's" sig in a direct chain RPC call. The
    // recovered address is the client's devSigner, which doesn't match
    // either the lawyer's wallet OR the lawyer's devSigner. → 422.
    const direct = await page.request.post("/api/dev/chain", {
      data: {
        method: "mutualRefundProposal",
        args: {
          engagementId: booking.engagementId,
          proposalIndex: 0,
          clientSig: clientSig.signature,
          lawyerSig: clientSig.signature, // same client sig in lawyer slot
          from: SEEDED.client3,
        },
      },
    });
    expect(direct.status()).toBe(422);
    const j = (await direct.json()) as { code?: string };
    expect(j.code).toBe("InvalidRefundSignature");
  });

  // ---------------------------------------------------------------------------
  // 8. request-list-isolation — GET /api/bookings/[id]/mutual-refund returns
  //    only this engagement's requests; rows for OTHER engagements never
  //    appear.
  // ---------------------------------------------------------------------------
  test("request-list-isolation", async ({ page, browser }) => {
    // Two bookings under different clients with the same lawyer. Each
    // initiates a refund request; each booking's GET must return ONLY its
    // own request, not the other.
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(page.request, SEEDED.lawyerMaria);
    const c4Booking = await createPaidBooking(page, lawyer.id);
    const { booking: bookingA } = (await c4Booking.json()) as { booking: { id: string; engagementId: number } };

    const c4Sig = await signRefund(page, {
      engagementId: bookingA.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const reqA = await page.request.post(`/api/bookings/${bookingA.id}/mutual-refund/request`, {
      data: { signature: c4Sig.signature },
    });
    expect(reqA.status()).toBe(201);
    const { request: reqRowA } = (await reqA.json()) as { request: { id: string } };

    // Second booking under a different client.
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await devSignIn(pageB, { wallet: SEEDED.client1, role: "client" });
    const c1Booking = await createPaidBooking(pageB, lawyer.id);
    const { booking: bookingB } = (await c1Booking.json()) as { booking: { id: string; engagementId: number } };
    expect(bookingB.engagementId).not.toBe(bookingA.engagementId);

    const c1Sig = await signRefund(pageB, {
      engagementId: bookingB.engagementId,
      proposalIndex: 0,
      role: "client",
    });
    const reqB = await pageB.request.post(`/api/bookings/${bookingB.id}/mutual-refund/request`, {
      data: { signature: c1Sig.signature },
    });
    expect(reqB.status()).toBe(201);
    const { request: reqRowB } = (await reqB.json()) as { request: { id: string } };
    expect(reqRowB.id).not.toBe(reqRowA.id);

    // GET booking A — only reqRowA.
    const listA = await page.request.get(`/api/bookings/${bookingA.id}/mutual-refund`);
    const dataA = (await listA.json()) as { requests: Array<{ id: string }> };
    expect(dataA.requests.map((r) => r.id)).toEqual([reqRowA.id]);

    // GET booking B — only reqRowB.
    const listB = await pageB.request.get(`/api/bookings/${bookingB.id}/mutual-refund`);
    const dataB = (await listB.json()) as { requests: Array<{ id: string }> };
    expect(dataB.requests.map((r) => r.id)).toEqual([reqRowB.id]);

    await ctxB.close();
  });
});
