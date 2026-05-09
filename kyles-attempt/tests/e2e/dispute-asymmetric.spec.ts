import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

// =============================================================================
// Feature 5 — Asymmetric dispute mechanism.
//
// The mechanism (mirroring `LegalEngagementEscrow.{disputeProposal,
// escalateProposal}`):
//   - Client may dispute a Funded or Delivered proposal IMMEDIATELY.
//   - Lawyer may only escalate a Delivered proposal AFTER 30 days from
//     `markDelivered`. The cooldown is contract-enforced; pre-cooldown
//     attempts return CooldownNotElapsed (HTTP 425) with `unlockAt`.
//
// We exercise both paths via API + a UI smoke test that asserts the lawyer's
// countdown button + the client's status banner respond correctly.
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
      caseDescription: "F5 dispute test.",
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

async function skipTime(request: APIRequestContext, seconds: number): Promise<number> {
  const r = await request.post("/api/dev/skip-time", { data: { seconds } });
  expect(r.status(), `skip-time: ${await r.text()}`).toBe(200);
  const j = (await r.json()) as { offsetSeconds: number };
  return j.offsetSeconds;
}

async function resetClock(request: APIRequestContext): Promise<void> {
  await request.post("/api/dev/chain", { data: { method: "__resetClock", args: {} } });
}

async function lawyerSignedIn(browser: import("@playwright/test").Browser, wallet: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await devSignIn(page, { wallet, role: "lawyer" });
  return { ctx, page };
}

// =============================================================================
// 1. Asymmetric dispute mechanism — chain-level invariants via the API.
// =============================================================================

test.describe.serial("F5 — asymmetric dispute mechanism", () => {
  test("client-immediate-dispute-funded", async ({ page, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Proposal[0] is FUNDED (paid path) right after booking.
    const before = await getEngagement(page.request, booking.engagementId);
    expect(before.proposals[0].state).toBe("FUNDED");

    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status(), `dispute response: ${await dispute.text()}`).toBe(200);
    const disputeBody = (await dispute.json()) as {
      booking: { status: string };
      proposalIndex: number;
      txHash: string;
    };
    expect(disputeBody.booking.status).toBe("DISPUTED");
    expect(disputeBody.proposalIndex).toBe(0);
    expect(disputeBody.txHash).toMatch(/^0x[0-9a-fA-F]+$/);

    const after = await getEngagement(page.request, booking.engagementId);
    expect(after.proposals[0].state).toBe("DISPUTED");
    expect(after.proposals[0].disputeTxHash).not.toBeNull();
  });

  test("client-immediate-dispute-delivered", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Lawyer marks delivered first.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(200);
    await ctx.close();

    const beforeDispute = await getEngagement(page.request, booking.engagementId);
    expect(beforeDispute.proposals[0].state).toBe("DELIVERED");

    // Client disputes the Delivered proposal — still allowed.
    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status()).toBe(200);
    const after = await getEngagement(page.request, booking.engagementId);
    expect(after.proposals[0].state).toBe("DISPUTED");
  });

  test("lawyer-cannot-dispute-pre-cooldown", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(200);

    // Lawyer escalates immediately after marking delivered → 425 with unlockAt.
    const escalate = await lawyerPage.request.post(`/api/bookings/${booking.id}/escalate`);
    expect(escalate.status()).toBe(425);
    const body = (await escalate.json()) as {
      error: { code: string; unlockAt?: string };
    };
    expect(body.error.code).toBe("CooldownNotElapsed");
    expect(body.error.unlockAt).toBeDefined();
    const unlockAt = new Date(body.error.unlockAt!).getTime();
    expect(unlockAt).toBeGreaterThan(Date.now());

    // Booking status must NOT have flipped — escalate failed.
    const after = await getEngagement(page.request, booking.engagementId);
    expect(after.proposals[0].state).toBe("DELIVERED");

    await ctx.close();
  });

  test("lawyer-can-escalate-after-cooldown", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);

    // Pre-cooldown attempt should fail.
    const pre = await lawyerPage.request.post(`/api/bookings/${booking.id}/escalate`);
    expect(pre.status()).toBe(425);

    // Skip 31 days via the dev mock-clock.
    await skipTime(page.request, 31 * 86400);

    const post = await lawyerPage.request.post(`/api/bookings/${booking.id}/escalate`);
    expect(post.status(), `escalate after cooldown: ${await post.text()}`).toBe(200);
    const j = (await post.json()) as { booking: { status: string }; txHash: string };
    expect(j.booking.status).toBe("DISPUTED");
    expect(j.txHash).toMatch(/^0x[0-9a-fA-F]+$/);

    const after = await getEngagement(page.request, booking.engagementId);
    expect(after.proposals[0].state).toBe("DISPUTED");
    expect(after.proposals[0].disputeTxHash).not.toBeNull();

    await ctx.close();
    await resetClock(request);
  });

  test("lawyer-cannot-escalate-funded", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    // Don't markDelivered — proposal stays FUNDED.
    const escalate = await lawyerPage.request.post(`/api/bookings/${booking.id}/escalate`);
    expect(escalate.status()).toBe(409);
    const j = (await escalate.json()) as { error: { code: string } };
    expect(j.error.code).toBe("InvalidProposalState");
    await ctx.close();
  });

  test("client-cannot-escalate", async ({ page, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };
    const escalate = await page.request.post(`/api/bookings/${booking.id}/escalate`);
    expect(escalate.status()).toBe(403);
  });

  test("lawyer-cannot-dispute-as-client-path", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const dispute = await lawyerPage.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status()).toBe(403);
    await ctx.close();
  });

  test("followup-proposal-dispute", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Lawyer publishes a follow-up offer; client funds it.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const items = [{ id: "fi", title: "Draft contract", kind: "fixed" as const, fixedPrice: 500, subtotal: 500 }];
    const deliverables = [{ id: "fd", title: "Signed PDF" }];
    const signRes = await lawyerPage.request.post("/api/dev/sign-proposal-offer", {
      data: { engagementId: booking.engagementId, amountWei: "50000", items, deliverables },
    });
    const signed = (await signRes.json()) as {
      signature: string;
      nonce: string;
      itemsHash: string;
      amountWei: string;
    };
    const offerRes = await lawyerPage.request.post("/api/proposals", {
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
    await ctx.close();

    const fundRes = await page.request.post(`/api/proposals/${offerJson.offer.id}/fund`);
    expect(fundRes.status()).toBe(200);

    // Confirm Proposal[1] is now FUNDED.
    const beforeDispute = await getEngagement(page.request, booking.engagementId);
    const followup = beforeDispute.proposals.find((p) => p.proposalIndex === 1);
    expect(followup?.state).toBe("FUNDED");

    // Client disputes Proposal[1] via /api/proposals/[id]/dispute.
    const disputeRes = await page.request.post(`/api/proposals/${offerJson.offer.id}/dispute`);
    expect(disputeRes.status(), `proposal dispute: ${await disputeRes.text()}`).toBe(200);

    const after = await getEngagement(page.request, booking.engagementId);
    const fp = after.proposals.find((p) => p.proposalIndex === 1)!;
    expect(fp.state).toBe("DISPUTED");
    // Engagement state is still ACTIVE (consultation Proposal[0] unaffected).
    expect(after.state).toBe("ACTIVE");
    // Proposal[0] still FUNDED.
    expect(after.proposals.find((p) => p.proposalIndex === 0)!.state).toBe("FUNDED");

    // Booking shell stays NON-DISPUTED for follow-up disputes — see
    // booking-bridge.disputeForProposal.
    const bookingFresh = await page.request.get(`/api/bookings/${booking.id}`);
    const bj = (await bookingFresh.json()) as { booking: { status: string } };
    expect(bj.booking.status).not.toBe("DISPUTED");
  });

  test("dispute-on-closed-engagement-rejected", async ({ page, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Artificially close the engagement (simulate post-resolve close that's
    // wired in F7+). We do this via direct chain RPC — write the engagement
    // to RELEASED state via release first, then close. Two-step needed
    // because closeEngagement requires all proposals terminal.
    const release = await page.request.post(`/api/bookings/${booking.id}/complete`);
    expect(release.status()).toBe(200);

    // Now close via dev/chain RPC.
    const closeRes = await page.request.post("/api/dev/chain", {
      data: {
        method: "closeEngagement",
        args: {
          engagementId: booking.engagementId,
          finalRoot: "0x" + "00".repeat(32),
          // close needs a party — the client is fine.
          from: SEEDED.client1,
        },
      },
    });
    const closeBody = (await closeRes.json()) as { ok: boolean; result?: unknown; code?: string };
    expect(closeBody.ok, `closeEngagement: ${JSON.stringify(closeBody)}`).toBe(true);

    // Now disputing must fail. The proposal is RELEASED → InvalidProposalState
    // would fire in the chain layer's proposal-state check; the
    // engagement-state check fires first → InvalidEngagementState.
    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status()).toBe(409);
    const j = (await dispute.json()) as { error: { code: string } };
    // Either InvalidEngagementState (preferred — engagement-state check)
    // or InvalidProposalState (proposal already RELEASED) is acceptable;
    // both encode "you can't dispute on a closed engagement".
    expect(["InvalidEngagementState", "InvalidProposalState"]).toContain(j.error.code);
  });

  // ---------------------------------------------------------------------------
  // 10. UI — cooldown countdown + dispute banner
  // ---------------------------------------------------------------------------
  test("UI-cooldown-countdown-visible", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Lawyer marks delivered → cooldown starts.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(200);

    // Visit lawyer consultation room.
    await lawyerPage.goto(`/lawyer/consultation/${booking.id}`);
    // The Escalate button should be visible but disabled, with
    // data-cooldown-elapsed="false".
    const escalateBtn = lawyerPage.getByTestId("rail-escalate");
    await expect(escalateBtn).toBeVisible();
    await expect(escalateBtn).toHaveAttribute("data-cooldown-elapsed", "false");
    await expect(escalateBtn).toBeDisabled();

    // Skip 31 days. The room polls /api/dev/skip-time every 4s; give it a
    // beat to refresh, then assert the countdown elapsed.
    await skipTime(lawyerPage.request, 31 * 86400);
    await expect
      .poll(
        async () => (await escalateBtn.getAttribute("data-cooldown-elapsed")) ?? "false",
        { timeout: 10_000 },
      )
      .toBe("true");
    await expect(escalateBtn).toBeEnabled();

    // Click escalate, confirm in modal.
    await escalateBtn.click();
    const confirmModal = lawyerPage.getByTestId("confirm-escalate");
    await expect(confirmModal).toBeVisible();
    await lawyerPage.getByTestId("confirm-go").click();

    // The dispute-banner should appear (booking.status = DISPUTED).
    await expect(lawyerPage.getByTestId("dispute-banner")).toBeVisible({ timeout: 10_000 });

    // Confirm chain state too.
    const after = await getEngagement(lawyerPage.request, booking.engagementId);
    expect(after.proposals[0].state).toBe("DISPUTED");

    await ctx.close();
    await resetClock(request);
  });
});
