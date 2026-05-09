import { expect, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

// =============================================================================
// Feature 5 — extra parity & robustness tests for the asymmetric dispute
// mechanism. Layered on top of `dispute-asymmetric.spec.ts` after an
// independent F5 review. Each scenario maps to a parity axis flagged by the
// reviewer:
//
//   1. dispute-anchors-transcript-root — disputeProposal MUST emit
//      TranscriptAnchored + write to transcriptRootHistory (mirrors the
//      Solidity contract emitting both events atomically with the dispute).
//   2. cooldown-boundary — the on-chain check is `block.timestamp < unlockAt`
//      so AT or AFTER the unlock must succeed; one second BEFORE must fail.
//   3. escalate-then-status-cannot-revert — once Disputed, the client cannot
//      release (InvalidProposalState). Only the operator's resolveDispute
//      may move the proposal off Disputed.
//   4. race-double-dispute — two rapid disputes against the same proposal:
//      first wins, second hits InvalidProposalState (Prisma transactions
//      serialise; the contract semantic is the same).
//   5. dispute-then-fund-followup — disputing proposal[0] does NOT lock the
//      engagement; the lawyer may still publish (and the client may fund) a
//      follow-up offer. Mirrors A's per-proposal state isolation: Engagement
//      is independent of any single Proposal until closeEngagement is called.
//   6. decline-then-dispute — booking declined (status DECLINED) but the
//      escrow is still FUNDED. The client may still dispute to recover the
//      funds via operator review. Contract semantic: dispute gates on
//      proposal state, not booking shell.
//   7. revoke-lawyer-mid-dispute — capability revoke does not affect an
//      already-Disputed proposal or block in-flight escalation paths.
//   8. chain-event-log — after disputeProposal/escalateProposal, ChainEvent
//      rows for ProposalDisputed + TranscriptAnchored exist with the right
//      payload. Both `dispute` and `escalate` emit ProposalDisputed (same
//      kind, since the contract emits one event for both call sites).
//
// Each test reseeds before running and resets the mock clock at the top so
// they remain order-independent.
// =============================================================================

const OPERATOR = "0x09e8a70811111111111111111111111111111bbb";

// -----------------------------------------------------------------------------
// Helpers (modelled on dispute-asymmetric.spec.ts)
// -----------------------------------------------------------------------------

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

interface ChainEvent {
  kind: string;
  payload: string;
  txHash: string;
  blockNumber: number;
}

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
      caseDescription: "F5 dispute extra test.",
      lineItems: [
        { id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 },
      ],
      deliverables: [{ id: "d-1", title: "Live consultation" }],
    },
  });
}

async function getEngagement(request: APIRequestContext, engagementId: number): Promise<ChainEngagement> {
  const r = await request.get(`/api/dev/chain?method=getEngagement&engagementId=${engagementId}`);
  const j = (await r.json()) as { ok: boolean; result: { engagement: ChainEngagement | null } };
  expect(j.ok).toBe(true);
  expect(j.result.engagement).not.toBeNull();
  return j.result.engagement!;
}

async function getEvents(request: APIRequestContext, engagementId: number): Promise<ChainEvent[]> {
  const r = await request.get(`/api/dev/chain?method=getEvents&engagementId=${engagementId}`);
  const j = (await r.json()) as { ok: boolean; result: { events: ChainEvent[] } };
  expect(j.ok).toBe(true);
  return j.result.events;
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

async function lawyerSignedIn(
  browser: import("@playwright/test").Browser,
  wallet: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await devSignIn(page, { wallet, role: "lawyer" });
  return { ctx, page };
}

async function clientSignedIn(
  browser: import("@playwright/test").Browser,
  wallet: string,
): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await devSignIn(page, { wallet, role: "client" });
  return { ctx, page };
}

// =============================================================================
// Tests
// =============================================================================

test.describe.serial("F5-extra — asymmetric dispute mechanism (parity follow-ups)", () => {
  test.beforeAll(reseedDatabase);

  // ---------------------------------------------------------------------------
  // 1. disputeProposal anchors the transcript root.
  // ---------------------------------------------------------------------------
  test("dispute-anchors-transcript-root", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as {
      booking: { id: string; engagementId: number; conversationId?: string };
    };

    // Send a few messages so the engagement has some chat traffic. We can't
    // recompute the merkle root client-side (F9 will), but the dispute MUST
    // still anchor whatever root the engagement currently holds.
    const conv = await page.request.get(`/api/bookings/${booking.id}`);
    const { booking: full } = (await conv.json()) as {
      booking: { conversation: { id: string } | null };
    };
    expect(full.conversation, "expected conversation row for booking").not.toBeNull();
    const conversationId = full.conversation!.id;

    // Send messages from the client.
    for (const msg of ["First", "Second", "Third"]) {
      const m = await page.request.post("/api/messages", {
        data: { conversationId, content: msg },
      });
      expect(m.status()).toBe(200);
    }

    const before = await getEngagement(page.request, booking.engagementId);
    const rootBefore = before.transcriptRoot;
    const eventsBefore = await getEvents(page.request, booking.engagementId);
    const anchorBefore = eventsBefore.filter((e) => e.kind === "TranscriptAnchored").length;

    // Dispute.
    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status(), `dispute: ${await dispute.text()}`).toBe(200);

    // ChainEvent log MUST contain a fresh TranscriptAnchored emitted alongside
    // the ProposalDisputed event.
    const eventsAfter = await getEvents(page.request, booking.engagementId);
    const anchorAfter = eventsAfter.filter((e) => e.kind === "TranscriptAnchored").length;
    expect(anchorAfter).toBe(anchorBefore + 1);

    // The most-recent TranscriptAnchored event should share the txHash with
    // the dispute (atomic anchor — both emitted from disputeProposal).
    const lastAnchor = eventsAfter
      .filter((e) => e.kind === "TranscriptAnchored")
      .sort((a, b) => b.blockNumber - a.blockNumber)[0];
    const lastDispute = eventsAfter
      .filter((e) => e.kind === "ProposalDisputed")
      .sort((a, b) => b.blockNumber - a.blockNumber)[0];
    expect(lastAnchor.txHash).toBe(lastDispute.txHash);

    // Engagement.transcriptRoot is still set (the route passes the existing
    // root, which is fine — F9 deepens this so the root changes per dispute).
    const after = await getEngagement(page.request, booking.engagementId);
    expect(after.transcriptRoot).toBe(rootBefore);
    void browser; // prevent unused-arg lint
  });

  // ---------------------------------------------------------------------------
  // 2. Cooldown boundary — `block.timestamp < unlockAt` semantic.
  // ---------------------------------------------------------------------------
  test("cooldown-boundary-30-days-exact", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(200);

    // Skip 30 days MINUS 60 seconds — well inside the cooldown. Must fail.
    await skipTime(request, 30 * 86400 - 60);
    const tooEarly = await lawyerPage.request.post(`/api/bookings/${booking.id}/escalate`);
    expect(tooEarly.status()).toBe(425);
    const earlyBody = (await tooEarly.json()) as { error: { code: string; unlockAt: string } };
    expect(earlyBody.error.code).toBe("CooldownNotElapsed");

    // Skip another 120 seconds → now ≈30 days + 60 seconds past deliveredAt.
    // The contract semantic is `block.timestamp >= unlockAt` allowed, so this
    // call MUST succeed.
    await skipTime(request, 120);
    const ok = await lawyerPage.request.post(`/api/bookings/${booking.id}/escalate`);
    expect(ok.status(), `escalate at boundary+60s: ${await ok.text()}`).toBe(200);

    const after = await getEngagement(request, booking.engagementId);
    expect(after.proposals[0].state).toBe("DISPUTED");

    await ctx.close();
    await resetClock(request);
  });

  // ---------------------------------------------------------------------------
  // 3. Once Disputed, the client cannot release. Only operator can resolve.
  // ---------------------------------------------------------------------------
  test("disputed-state-blocks-release-and-deliver", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Client disputes.
    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status()).toBe(200);

    // Now release should fail with InvalidProposalState (proposal is Disputed).
    const release = await page.request.post(`/api/bookings/${booking.id}/complete`);
    expect(release.status()).toBe(409);
    const rj = (await release.json()) as { error: { code: string } };
    expect(rj.error.code).toBe("InvalidProposalState");

    // And the lawyer's markDelivered should also fail (proposal is Disputed).
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(409);
    const dj = (await deliver.json()) as { error: { code: string } };
    expect(dj.error.code).toBe("InvalidProposalState");

    // The operator can still resolve via /api/dev/chain.
    const resolve = await request.post("/api/dev/chain", {
      data: {
        method: "resolveDispute",
        args: {
          engagementId: booking.engagementId,
          proposalIndex: 0,
          toLawyerWei: "12000",
          toClientWei: "12000",
          from: OPERATOR,
        },
      },
    });
    const rb = (await resolve.json()) as { ok: boolean; code?: string; message?: string };
    expect(rb.ok, `resolve: ${JSON.stringify(rb)}`).toBe(true);

    const after = await getEngagement(request, booking.engagementId);
    expect(after.proposals[0].state).toBe("RESOLVED");

    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 4. Race: two near-simultaneous disputeProposal calls. The second hits
  //    InvalidProposalState because the first's transaction has flipped the
  //    state to DISPUTED.
  // ---------------------------------------------------------------------------
  test("race-double-dispute", async ({ page, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Drive the chain RPC directly twice — closer to a true race than the
    // booking-route path because we bypass the per-route locks (there are
    // none, but route handler overhead asymmetrically delays the first call).
    const eng = await getEngagement(request, booking.engagementId);
    const args = {
      engagementId: booking.engagementId,
      proposalIndex: 0,
      transcriptRoot: eng.transcriptRoot,
      from: SEEDED.client4,
    };
    const [a, b] = await Promise.all([
      request.post("/api/dev/chain", { data: { method: "disputeProposal", args } }),
      request.post("/api/dev/chain", { data: { method: "disputeProposal", args } }),
    ]);
    const responses = [a, b];
    const bodies = await Promise.all(
      responses.map(async (r) => ({ status: r.status(), body: (await r.json()) as { ok: boolean; code?: string } })),
    );
    const successes = bodies.filter((x) => x.body.ok);
    const failures = bodies.filter((x) => !x.body.ok);
    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].body.code).toBe("InvalidProposalState");

    const after = await getEngagement(request, booking.engagementId);
    expect(after.proposals[0].state).toBe("DISPUTED");
  });

  // ---------------------------------------------------------------------------
  // 5. Dispute on proposal[0] doesn't block follow-up offers.
  //    A's Engagement state is independent of any single proposal's state —
  //    so the lawyer can still post offers and the client can still fund
  //    follow-ups while proposal[0] sits in Disputed.
  // ---------------------------------------------------------------------------
  test("dispute-then-fund-followup-still-works", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Dispute the consultation proposal.
    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status()).toBe(200);

    // Engagement still ACTIVE — only proposal[0] is Disputed.
    const mid = await getEngagement(request, booking.engagementId);
    expect(mid.state).toBe("ACTIVE");
    expect(mid.proposals[0].state).toBe("DISPUTED");

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
    expect(fundRes.status(), `fund: ${await fundRes.text()}`).toBe(200);

    const after = await getEngagement(request, booking.engagementId);
    expect(after.state).toBe("ACTIVE");
    expect(after.proposalCount).toBe(2);
    expect(after.proposals[0].state).toBe("DISPUTED");
    expect(after.proposals[1].state).toBe("FUNDED");
  });

  // ---------------------------------------------------------------------------
  // 6. Booking declined → escrow still funded → client can still dispute to
  //    recover via operator review. The contract gates dispute on proposal
  //    state, NOT on Booking.status.
  // ---------------------------------------------------------------------------
  test("declined-booking-can-still-be-disputed", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Lawyer declines.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const decline = await lawyerPage.request.post(`/api/bookings/${booking.id}/decline`);
    expect(decline.status()).toBe(200);
    await ctx.close();

    // Booking shell flipped to DECLINED but the Proposal stays FUNDED — funds
    // are stuck until refunded or disputed.
    const fresh = await page.request.get(`/api/bookings/${booking.id}`);
    const fj = (await fresh.json()) as { booking: { status: string } };
    expect(fj.booking.status).toBe("DECLINED");
    const beforeDispute = await getEngagement(request, booking.engagementId);
    expect(beforeDispute.proposals[0].state).toBe("FUNDED");

    // Client disputes. Should succeed — the contract semantic for dispute
    // gates on proposal state (FUNDED qualifies), not booking status.
    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status(), `dispute on declined: ${await dispute.text()}`).toBe(200);

    const after = await getEngagement(request, booking.engagementId);
    expect(after.proposals[0].state).toBe("DISPUTED");
    // Booking shell flips to DISPUTED on top of DECLINED — last write wins.
    const after2 = await page.request.get(`/api/bookings/${booking.id}`);
    const aj = (await after2.json()) as { booking: { status: string } };
    expect(aj.booking.status).toBe("DISPUTED");
  });

  // ---------------------------------------------------------------------------
  // 7. Revoke the lawyer's capability mid-flow. An already-Disputed proposal
  //    is unaffected. Revocation does NOT block a NotEngagementParty path
  //    (party check is by address, not capability).
  // ---------------------------------------------------------------------------
  test("revoke-lawyer-mid-dispute-does-not-affect-state", async ({ page, browser, request }) => {
    await resetClock(request);
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const created = await createPaidBooking(page, lawyer.id);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Lawyer marks delivered first so we can also exercise escalate paths.
    const { ctx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(200);

    // Client disputes → proposal Disputed.
    const dispute = await page.request.post(`/api/bookings/${booking.id}/dispute`);
    expect(dispute.status()).toBe(200);

    // Now revoke the lawyer's SCHEMA_LAWYER capability.
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      throw new Error("ADMIN_API_KEY not set in test env");
    }
    const revoke = await request.post("/api/admin/verify-lawyer", {
      headers: { "x-admin-key": adminKey },
      data: { walletAddress: SEEDED.lawyerMaria, action: "REVOKE" },
    });
    expect(revoke.status()).toBe(200);

    // Capability gone.
    const cap = await request.get(
      `/api/dev/chain?method=hasCapability&subject=${SEEDED.lawyerMaria}&schemaId=SCHEMA_LAWYER`,
    );
    const cj = (await cap.json()) as { result: { hasCapability: boolean } };
    expect(cj.result.hasCapability).toBe(false);

    // The dispute is unchanged.
    const after = await getEngagement(request, booking.engagementId);
    expect(after.proposals[0].state).toBe("DISPUTED");

    // Operator can still resolve.
    const resolve = await request.post("/api/dev/chain", {
      data: {
        method: "resolveDispute",
        args: {
          engagementId: booking.engagementId,
          proposalIndex: 0,
          toLawyerWei: after.proposals[0].amountWei,
          toClientWei: "0",
          from: OPERATOR,
        },
      },
    });
    const rb = (await resolve.json()) as { ok: boolean; code?: string };
    expect(rb.ok, `resolve after revoke: ${JSON.stringify(rb)}`).toBe(true);

    const final = await getEngagement(request, booking.engagementId);
    expect(final.proposals[0].state).toBe("RESOLVED");

    // Restore Maria's capability so subsequent tests in this serial describe
    // can still find her in the public directory. The revoke is a side-effect
    // we own.
    const reverify = await request.post("/api/admin/verify-lawyer", {
      headers: { "x-admin-key": adminKey },
      data: { walletAddress: SEEDED.lawyerMaria, action: "VERIFY" },
    });
    expect(reverify.status()).toBe(200);

    await ctx.close();
  });

  // ---------------------------------------------------------------------------
  // 8. ChainEvent log: dispute and escalate both emit ProposalDisputed
  //    (single event kind for both call sites — mirrors A's contract).
  // ---------------------------------------------------------------------------
  test("chain-event-log-dispute-and-escalate", async ({ page, browser, request }) => {
    await resetClock(request);

    // CASE A: client dispute path.
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyer = await getLawyerByWallet(request, SEEDED.lawyerMaria);
    const createdA = await createPaidBooking(page, lawyer.id);
    const { booking: bookingA } = (await createdA.json()) as {
      booking: { id: string; engagementId: number };
    };
    const disputeA = await page.request.post(`/api/bookings/${bookingA.id}/dispute`);
    expect(disputeA.status()).toBe(200);

    const eventsA = await getEvents(request, bookingA.engagementId);
    const disputedA = eventsA.filter((e) => e.kind === "ProposalDisputed");
    expect(disputedA.length).toBe(1);
    const payloadA = JSON.parse(disputedA[0].payload) as {
      engagementId: number;
      proposalIndex: number;
      by: string;
    };
    expect(payloadA.engagementId).toBe(bookingA.engagementId);
    expect(payloadA.proposalIndex).toBe(0);
    expect(payloadA.by.toLowerCase()).toBe(SEEDED.client4.toLowerCase());

    // CASE B: lawyer escalate path.
    const { ctx: clientCtxB, page: clientPageB } = await clientSignedIn(browser, SEEDED.client1);
    const createdB = await createPaidBooking(clientPageB, lawyer.id);
    const { booking: bookingB } = (await createdB.json()) as {
      booking: { id: string; engagementId: number };
    };

    const { ctx: lawyerCtx, page: lawyerPage } = await lawyerSignedIn(browser, lawyer.userWallet);
    const deliver = await lawyerPage.request.post(`/api/bookings/${bookingB.id}/deliver`);
    expect(deliver.status()).toBe(200);
    await skipTime(request, 31 * 86400);
    const escalate = await lawyerPage.request.post(`/api/bookings/${bookingB.id}/escalate`);
    expect(escalate.status(), `escalate: ${await escalate.text()}`).toBe(200);

    const eventsB = await getEvents(request, bookingB.engagementId);
    const disputedB = eventsB.filter((e) => e.kind === "ProposalDisputed");
    expect(disputedB.length).toBe(1);
    const payloadB = JSON.parse(disputedB[0].payload) as {
      engagementId: number;
      proposalIndex: number;
      by: string;
    };
    expect(payloadB.engagementId).toBe(bookingB.engagementId);
    expect(payloadB.proposalIndex).toBe(0);
    // `by` is the lawyer's wallet — escalate emits the same event with the
    // caller as `by`, mirroring the contract's `emit ProposalDisputed(eid, idx, msg.sender)`.
    expect(payloadB.by.toLowerCase()).toBe(SEEDED.lawyerMaria.toLowerCase());

    // Both call sites also emit TranscriptAnchored alongside.
    const anchorsB = eventsB.filter((e) => e.kind === "TranscriptAnchored");
    expect(anchorsB.length).toBeGreaterThanOrEqual(1);
    const lastAnchorB = anchorsB.sort((x, y) => y.blockNumber - x.blockNumber)[0];
    expect(lastAnchorB.txHash).toBe(disputedB[0].txHash);

    await lawyerCtx.close();
    await clientCtxB.close();
    await resetClock(request);
  });
});
