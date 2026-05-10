// Browser-side SSE coverage for the follow-up Order lifecycle. Mirror of
// sse-flow.spec.ts (which covers the consultation booking) — verifies that
// state transitions on a follow-up Order propagate to both client and
// lawyer browser contexts via the /api/orders/[id]/events stream without
// either page reloading.
//
// Doesn't exercise wagmi: the chain `fundMilestone` / `releaseMilestone`
// path needs a real wallet (or Synpress). The SSE channel + UI re-render
// works on dev-login fixtures via `?xtest-fund=1` style state injection
// performed by direct DB writes here.

import { expect, test } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(reseedDatabase);

test.setTimeout(120_000);

test("Follow-up Order: lawyer creates → client sees → state pushes via SSE to both", async ({ browser }) => {
  // ---- Sign in two contexts ----
  const clientCtx = await browser.newContext();
  const clientPage = await clientCtx.newPage();
  await devSignIn(clientPage, { wallet: SEEDED.client1, role: "client" });

  const lawyerCtx = await browser.newContext();
  const lawyerPage = await lawyerCtx.newPage();
  await devSignIn(lawyerPage, { wallet: SEEDED.lawyerMaria, role: "lawyer" });

  // ---- Resolve Maria's lawyerProfileId ----
  const lawyersRes = await clientPage.request.get("/api/lawyers");
  const { lawyers } = (await lawyersRes.json()) as {
    lawyers: Array<{ id: string; user: { walletAddress: string } }>;
  };
  const maria = lawyers.find(
    (l) => l.user.walletAddress.toLowerCase() === SEEDED.lawyerMaria.toLowerCase(),
  );
  if (!maria) throw new Error("Maria missing from /api/lawyers");

  // ---- Set up a fully-funded Engagement directly in the DB ----
  // Follow-up orders need a parent Engagement (the consultation must have
  // funded). Dev-login can't drive a real on-chain funding, so we inject the
  // engagement row + bind it to a synthetic chain id that won't collide
  // with the smoke-test-created engagements 1..N.
  const prisma = new PrismaClient();
  const synthChainId = 200_000 + Math.floor(Math.random() * 1_000_000);
  // Find a seeded user record for the client/lawyer wallets so the
  // engagement's clientId / lawyerProfileId FKs resolve.
  const clientUser = await prisma.user.findUnique({ where: { walletAddress: SEEDED.client1 } });
  if (!clientUser) throw new Error("Seeded client user not found");
  const engagement = await prisma.engagement.create({
    data: {
      clientId: clientUser.id,
      lawyerProfileId: maria.id,
      matterRef: "0x" + ("00" + Math.random().toString(16).slice(2)).slice(-2).repeat(32),
      engagementIdOnChain: synthChainId,
    },
  });

  try {
    // ---- 1. Lawyer creates a follow-up order (dev-login bypass) ----
    const createRes = await lawyerPage.request.post("/api/orders", {
      data: {
        engagementId: engagement.id,
        description: "Phase-12 SSE follow-up smoke — please ignore.",
        amountETH: 0.04,
      },
    });
    expect(createRes.ok()).toBeTruthy();
    const { order } = (await createRes.json()) as { order: { id: string } };

    // ---- 2. Both parties open the order detail pages ----
    await clientPage.goto(`/client/follow-ups/${order.id}`);
    await lawyerPage.goto(`/lawyer/follow-ups/${order.id}`);

    // Both should render — client sees a "Fund order" button, lawyer sees a
    // "Rescind order" button (status === REQUESTED).
    await expect(clientPage.getByRole("button", { name: /Fund order/i })).toBeVisible({ timeout: 10_000 });
    await expect(lawyerPage.getByRole("button", { name: /Rescind order/i })).toBeVisible({ timeout: 10_000 });

    // ---- 3. Wait for both SSE channels to deliver their initial event ----
    // useRealtimeOrder bumps window.__firmusSseOrderCount on each delivery.
    // The first hit JIT-compiles /api/orders/[id]/events in dev mode (~5s).
    await clientPage.waitForFunction(
      () => (window as unknown as { __firmusSseOrderCount?: number }).__firmusSseOrderCount! >= 1,
      undefined,
      { timeout: 60_000 },
    );
    await lawyerPage.waitForFunction(
      () => (window as unknown as { __firmusSseOrderCount?: number }).__firmusSseOrderCount! >= 1,
      undefined,
      { timeout: 60_000 },
    );

    const clientUrlBefore = clientPage.url();
    const lawyerUrlBefore = lawyerPage.url();

    // ---- 4. Lawyer cancels the order ----
    const cancelRes = await lawyerPage.request.post(`/api/orders/${order.id}/cancel`);
    expect(cancelRes.ok()).toBeTruthy();

    // ---- 5. SSE should push the new state to BOTH parties without reload ----
    // Lawyer: rescind button replaced (status no longer REQUESTED → null render).
    await expect(lawyerPage.getByRole("button", { name: /Rescind order/i })).toBeHidden({ timeout: 10_000 });
    // Client: Fund order button gone. Status badge flips to "cancelled".
    await expect(clientPage.getByRole("button", { name: /Fund order/i })).toBeHidden({ timeout: 10_000 });
    // Both URLs unchanged → no full-page navigation happened.
    expect(clientPage.url()).toBe(clientUrlBefore);
    expect(lawyerPage.url()).toBe(lawyerUrlBefore);
  } finally {
    // Cleanup synthetic engagement + the order so it doesn't leak.
    await prisma.order.deleteMany({ where: { engagementId: engagement.id } });
    await prisma.engagement.delete({ where: { id: engagement.id } });
    await prisma.$disconnect();
    await clientCtx.close();
    await lawyerCtx.close();
  }
});
