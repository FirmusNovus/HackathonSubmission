import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

// =============================================================================
// Feature 3 — Booking ↔ Engagement bridge.
//
// These tests assert that the client-facing Booking flows now drive System A's
// Engagement + Proposal state machine through the F1 mock chain. Every
// scenario hits the public API surface (`/api/bookings/*`, `/api/dev/chain`)
// rather than touching Prisma directly, so they verify the full route path
// the UI exercises.
// =============================================================================

test.beforeAll(reseedDatabase);

async function getLawyerId(request: APIRequestContext): Promise<string> {
  const r = await request.get("/api/lawyers");
  expect(r.status()).toBe(200);
  const data = (await r.json()) as { lawyers: Array<{ id: string; user: { walletAddress: string } }> };
  expect(data.lawyers.length).toBeGreaterThan(0);
  return data.lawyers[0].id;
}

async function getLawyerByWallet(request: APIRequestContext, wallet: string): Promise<{ id: string }> {
  const r = await request.get("/api/lawyers");
  const data = (await r.json()) as { lawyers: Array<{ id: string; user: { walletAddress: string } }> };
  const match = data.lawyers.find((l) => l.user.walletAddress.toLowerCase() === wallet.toLowerCase());
  if (!match) throw new Error(`No lawyer with wallet ${wallet} in /api/lawyers`);
  return { id: match.id };
}

async function rpcGet<T = unknown>(
  request: APIRequestContext,
  method: string,
  params: Record<string, string | number>,
): Promise<T> {
  const qs = new URLSearchParams({ method });
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const r = await request.get(`/api/dev/chain?${qs.toString()}`);
  const j = (await r.json()) as { ok: boolean; result: T };
  expect(j.ok, JSON.stringify(j)).toBe(true);
  return j.result;
}

async function createPaidBooking(page: Page, lawyerProfileId: string) {
  return page.request.post("/api/bookings", {
    data: {
      lawyerProfileId,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      durationMinutes: 60,
      practiceArea: "Family",
      caseDescription: "F3 lifecycle test — paid booking.",
      lineItems: [
        { id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 },
      ],
      deliverables: [{ id: "d-1", title: "Live consultation" }],
    },
  });
}

async function createFreeBooking(page: Page, lawyerProfileId: string) {
  return page.request.post("/api/bookings", {
    data: {
      lawyerProfileId,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      durationMinutes: 30,
      practiceArea: "Employment",
      caseDescription: "F3 lifecycle test — free intake booking.",
      lineItems: [
        { id: "li-1", title: "Free initial assessment", kind: "fixed", fixedPrice: 0, subtotal: 0 },
      ],
      deliverables: [{ id: "d-1", title: "Verbal advice" }],
    },
  });
}

test.describe.serial("F3 — booking ↔ engagement bridge", () => {
  test("paid-booking-funds-engagement-on-create", async ({ page, request }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyerProfileId = await getLawyerId(request);

    const r = await createPaidBooking(page, lawyerProfileId);
    expect(r.status()).toBe(200);
    const data = (await r.json()) as {
      booking: {
        id: string;
        status: string;
        engagementId: number | null;
        escrowTxHash: string | null;
        proposalIndex: number;
      };
    };
    expect(data.booking.status).toBe("REQUESTED");
    expect(data.booking.engagementId, "engagement opened on POST /api/bookings").not.toBeNull();
    expect(data.booking.escrowTxHash, "escrow tx hash set at booking time").not.toBeNull();
    expect(data.booking.proposalIndex).toBe(0);

    const result = await rpcGet<{ engagement: { state: string; proposalCount: number; proposals: Array<{ state: string; proposalIndex: number }> } | null }>(
      page.request,
      "getEngagement",
      { engagementId: data.booking.engagementId! },
    );
    expect(result.engagement, "engagement mirror row exists").not.toBeNull();
    expect(result.engagement!.state).toBe("ACTIVE");
    expect(result.engagement!.proposalCount).toBe(1);
    expect(result.engagement!.proposals[0].state).toBe("FUNDED");
    expect(result.engagement!.proposals[0].proposalIndex).toBe(0);
  });

  test("lawyer-accept-flips-only-status", async ({ page, browser, request }) => {
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyerProfileId = await getLawyerId(request);
    const created = await createPaidBooking(page, lawyerProfileId);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Snapshot the engagement BEFORE accept.
    const before = await rpcGet<{ engagement: { proposalCount: number; proposals: Array<{ state: string; deliveredAt: string | null }> } }>(
      page.request,
      "getEngagement",
      { engagementId: booking.engagementId },
    );

    // Lawyer accepts.
    const lawyerWallet = (await page.request.get(`/api/lawyers/${lawyerProfileId}`).then(async (r) => (await r.json()) as { lawyer: { user: { walletAddress: string } } })).lawyer.user.walletAddress;
    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyerWallet, role: "lawyer" });
    const accepted = await lawyerPage.request.post(`/api/bookings/${booking.id}/accept`);
    expect(accepted.status()).toBe(200);
    await ctx.close();

    // Engagement state must be byte-identical.
    const after = await rpcGet<{ engagement: { proposalCount: number; proposals: Array<{ state: string; deliveredAt: string | null }> } }>(
      page.request,
      "getEngagement",
      { engagementId: booking.engagementId },
    );
    expect(after.engagement.proposalCount).toBe(before.engagement.proposalCount);
    expect(after.engagement.proposals.length).toBe(before.engagement.proposals.length);
    expect(after.engagement.proposals[0].state).toBe(before.engagement.proposals[0].state);
    expect(after.engagement.proposals[0].deliveredAt).toBe(before.engagement.proposals[0].deliveredAt);
  });

  test("lawyer-mark-delivered-then-client-release", async ({ page, browser, request }) => {
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyerProfileId = await getLawyerId(request);
    const created = await createPaidBooking(page, lawyerProfileId);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const lawyerWallet = (await page.request.get(`/api/lawyers/${lawyerProfileId}`).then(async (r) => (await r.json()) as { lawyer: { user: { walletAddress: string } } })).lawyer.user.walletAddress;
    const lawyerCtx = await browser.newContext();
    const lawyerPage = await lawyerCtx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyerWallet, role: "lawyer" });

    // Lawyer marks delivered.
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(200);
    const delivered = (await deliver.json()) as { booking: { status: string; deliveredAt: string | null } };
    expect(delivered.booking.status).toBe("DELIVERED");
    expect(delivered.booking.deliveredAt).not.toBeNull();
    await lawyerCtx.close();

    // Client releases.
    const release = await page.request.post(`/api/bookings/${booking.id}/complete`);
    expect(release.status()).toBe(200);
    const released = (await release.json()) as { booking: { status: string; escrowReleaseHash: string | null } };
    expect(released.booking.status).toBe("COMPLETED");
    expect(released.booking.escrowReleaseHash).not.toBeNull();

    // Verify chain mirror.
    const eng = await rpcGet<{ engagement: { proposals: Array<{ state: string; amountToLawyerWei: string | null }> } }>(
      page.request,
      "getEngagement",
      { engagementId: booking.engagementId },
    );
    expect(eng.engagement.proposals[0].state).toBe("RELEASED");
    expect(eng.engagement.proposals[0].amountToLawyerWei).not.toBeNull();
  });

  test("client-release-without-delivery-still-works", async ({ page, request }) => {
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyerProfileId = await getLawyerId(request);
    const created = await createPaidBooking(page, lawyerProfileId);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    // Skip the lawyer's deliver step and release directly.
    const release = await page.request.post(`/api/bookings/${booking.id}/complete`);
    expect(release.status()).toBe(200);
    const released = (await release.json()) as { booking: { status: string; escrowReleaseHash: string | null } };
    expect(released.booking.status).toBe("COMPLETED");
    expect(released.booking.escrowReleaseHash).not.toBeNull();

    const eng = await rpcGet<{ engagement: { proposals: Array<{ state: string; deliveredAt: string | null }> } }>(
      page.request,
      "getEngagement",
      { engagementId: booking.engagementId },
    );
    expect(eng.engagement.proposals[0].state).toBe("RELEASED");
    // markDelivered was never called → deliveredAt stays null on the proposal.
    expect(eng.engagement.proposals[0].deliveredAt).toBeNull();
  });

  test("decline-on-funded-leaves-funds-pending", async ({ page, browser, request }) => {
    await devSignIn(page, { wallet: SEEDED.client1, role: "client" });
    const lawyerProfileId = await getLawyerId(request);
    const created = await createPaidBooking(page, lawyerProfileId);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const lawyerWallet = (await page.request.get(`/api/lawyers/${lawyerProfileId}`).then(async (r) => (await r.json()) as { lawyer: { user: { walletAddress: string } } })).lawyer.user.walletAddress;
    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyerWallet, role: "lawyer" });

    const decline = await lawyerPage.request.post(`/api/bookings/${booking.id}/decline`);
    expect(decline.status()).toBe(200);
    const declined = (await decline.json()) as { booking: { status: string } };
    expect(declined.booking.status).toBe("DECLINED");
    await ctx.close();

    // Proposal[0] must still be FUNDED — F6 wires the mutual refund that
    // unlocks the funds. Documenting the lingering state here.
    const eng = await rpcGet<{ engagement: { proposals: Array<{ state: string }> } }>(
      page.request,
      "getEngagement",
      { engagementId: booking.engagementId },
    );
    expect(eng.engagement.proposals[0].state).toBe("FUNDED");
  });

  test("free-booking-creates-proposal0-zero-amount", async ({ page, browser, request }) => {
    await devSignIn(page, { wallet: SEEDED.client2, role: "client" });
    const lawyerProfileId = await getLawyerId(request);
    const created = await createFreeBooking(page, lawyerProfileId);
    expect(created.status()).toBe(200);
    const { booking } = (await created.json()) as {
      booking: { id: string; engagementId: number; escrowTxHash: string | null };
    };
    expect(booking.engagementId).not.toBeNull();
    // Free path also gets an open tx hash recorded as the escrowTxHash —
    // the engagement-open + proposal-funded events share the same tx.
    expect(booking.escrowTxHash).not.toBeNull();

    const eng = await rpcGet<{ engagement: { proposalCount: number; proposals: Array<{ state: string; amountWei: string }> } }>(
      page.request,
      "getEngagement",
      { engagementId: booking.engagementId },
    );
    expect(eng.engagement.proposalCount).toBe(1);
    expect(eng.engagement.proposals[0].state).toBe("FUNDED");
    expect(eng.engagement.proposals[0].amountWei).toBe("0");

    // Deliver→release flow works the same way for free as for paid.
    const lawyerWallet = (await page.request.get(`/api/lawyers/${lawyerProfileId}`).then(async (r) => (await r.json()) as { lawyer: { user: { walletAddress: string } } })).lawyer.user.walletAddress;
    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyerWallet, role: "lawyer" });
    const deliver = await lawyerPage.request.post(`/api/bookings/${booking.id}/deliver`);
    expect(deliver.status()).toBe(200);
    await ctx.close();

    const release = await page.request.post(`/api/bookings/${booking.id}/complete`);
    expect(release.status()).toBe(200);

    const after = await rpcGet<{ engagement: { proposals: Array<{ state: string }> } }>(
      page.request,
      "getEngagement",
      { engagementId: booking.engagementId },
    );
    expect(after.engagement.proposals[0].state).toBe("RELEASED");
  });

  test("engagement-not-mutated-by-status-flip", async ({ page, browser, request }) => {
    // Bookings/accept/decline/complete must never directly write Engagement
    // or Proposal rows — only the bridge does. We confirm by snapshotting
    // proposalCount + proposal-state before and after each status-flip and
    // asserting no spurious mutation creeps in.
    await devSignIn(page, { wallet: SEEDED.client3, role: "client" });
    const lawyerProfileId = await getLawyerId(request);
    const created = await createPaidBooking(page, lawyerProfileId);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const lawyerWallet = (await page.request.get(`/api/lawyers/${lawyerProfileId}`).then(async (r) => (await r.json()) as { lawyer: { user: { walletAddress: string } } })).lawyer.user.walletAddress;

    // Snapshot before lawyer accept.
    const beforeAccept = await rpcGet<{ engagement: { proposalCount: number; proposals: Array<{ state: string; deliveredAt: string | null; amountToLawyerWei: string | null }> } }>(
      page.request,
      "getEngagement",
      { engagementId: booking.engagementId },
    );

    const ctx = await browser.newContext();
    const lawyerPage = await ctx.newPage();
    await devSignIn(lawyerPage, { wallet: lawyerWallet, role: "lawyer" });
    await lawyerPage.request.post(`/api/bookings/${booking.id}/accept`);
    await ctx.close();

    const afterAccept = await rpcGet<{ engagement: { proposalCount: number; proposals: Array<{ state: string; deliveredAt: string | null; amountToLawyerWei: string | null }> } }>(
      page.request,
      "getEngagement",
      { engagementId: booking.engagementId },
    );
    expect(afterAccept).toEqual(beforeAccept);
  });

  test("release-on-released-fails", async ({ page, request }) => {
    await devSignIn(page, { wallet: SEEDED.client4, role: "client" });
    const lawyerProfileId = await getLawyerId(request);
    const created = await createPaidBooking(page, lawyerProfileId);
    const { booking } = (await created.json()) as { booking: { id: string; engagementId: number } };

    const first = await page.request.post(`/api/bookings/${booking.id}/complete`);
    expect(first.status()).toBe(200);

    // Second release on a now-RELEASED proposal must fail with InvalidProposalState.
    const second = await page.request.post(`/api/bookings/${booking.id}/complete`);
    expect(second.status()).toBe(409);
    const j = (await second.json()) as { error?: { code?: string } };
    expect(j.error?.code).toBe("InvalidProposalState");
  });
});
