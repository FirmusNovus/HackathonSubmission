// End-to-end UI verification of the SSE-driven booking lifecycle.
//
// What we exercise:
//   1. Client signs in + creates a booking via the API (dev-login bypass
//      means the form's wagmi.signTypedData step is skipped server-side).
//   2. Client opens the case detail page; an EventSource subscribes.
//   3. Lawyer in a separate context opens the order review page; a second
//      EventSource subscribes.
//   4. Lawyer accepts via API.
//   5. BOTH browsers should react via SSE — no router.refresh, no reload —
//      lawyer's accept button gives way to "waiting for client to fund",
//      and the client's panel flips to phase=awaiting-funding.
//
// What we don't exercise (would require MetaMask in the headless browser):
//   - The wagmi `openEngagementAndFundFirstMilestone` tx itself.
//   - The /released path.
// Those are covered by the chain smoke tests (phase{6,7,8}-smoke.mjs).

import { expect, test } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(reseedDatabase);

// 120s — Next.js dev mode can take 30+ seconds to JIT-compile
// /api/bookings/[id]/events on first hit. Production builds compile ahead of
// time and don't have this problem.
test.setTimeout(120_000);

test("SSE: client books → lawyer accepts → both UIs update without reload", async ({ browser }) => {
  // ---- Sign in two contexts ----------------------------------------
  const clientCtx = await browser.newContext();
  const clientPage = await clientCtx.newPage();
  await devSignIn(clientPage, { wallet: SEEDED.client1, role: "client" });

  const lawyerCtx = await browser.newContext();
  const lawyerPage = await lawyerCtx.newPage();
  await devSignIn(lawyerPage, { wallet: SEEDED.lawyerMaria, role: "lawyer" });

  // ---- Resolve Maria's lawyerProfileId via API --------------------
  const lawyersRes = await clientPage.request.get("/api/lawyers");
  const { lawyers } = (await lawyersRes.json()) as {
    lawyers: Array<{ id: string; user: { walletAddress: string } }>;
  };
  const maria = lawyers.find(
    (l) => l.user.walletAddress.toLowerCase() === SEEDED.lawyerMaria.toLowerCase(),
  );
  if (!maria) throw new Error("Maria missing from /api/lawyers — did the seed run?");

  // ---- 1. Client creates a booking (API, dev-login skips sig) -----
  const createRes = await clientPage.request.post("/api/bookings", {
    data: {
      lawyerProfileId: maria.id,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      durationMinutes: 60,
      practiceArea: "Family",
      caseDescription: "E2E SSE test booking — please ignore.",
    },
  });
  expect(createRes.ok()).toBeTruthy();
  const { booking } = (await createRes.json()) as { booking: { id: string } };

  // ---- 2. Client opens case detail; SSE should connect -----------
  await clientPage.goto(`/client/cases/${booking.id}`);
  // Initial phase: client signed at booking time, lawyer hasn't yet.
  await expect(
    clientPage.locator("[data-testid='order-action-panel']"),
  ).toHaveAttribute("data-phase", "awaiting-lawyer", { timeout: 10_000 });

  // ---- 3. Lawyer opens the order review; accept button visible ----
  await lawyerPage.goto(`/lawyer/orders/${booking.id}`);
  const acceptBtn = lawyerPage.getByRole("button", { name: /Sign & accept|Accept order/i });
  await expect(acceptBtn).toBeVisible({ timeout: 10_000 });

  // Wait for the EventSource to actually deliver its first message before
  // mutating — otherwise we race the SSE open against the publish emit.
  // useRealtimeBooking bumps `window.__firmusSseBookingCount` per delivery;
  // we wait for at least one delivery on each side. (Next.js dev mode JIT
  // compiles /api/bookings/[id]/events on first hit, which can take 5+s.)
  await lawyerPage.waitForFunction(
    () => (window as unknown as { __firmusSseBookingCount?: number }).__firmusSseBookingCount! >= 1,
    undefined,
    { timeout: 60_000 },
  );
  await clientPage.waitForFunction(
    () => (window as unknown as { __firmusSseBookingCount?: number }).__firmusSseBookingCount! >= 1,
    undefined,
    { timeout: 60_000 },
  );

  // Snapshot the current URLs so we can assert no reload happened.
  const lawyerUrlBefore = lawyerPage.url();
  const clientUrlBefore = clientPage.url();

  // ---- 4. Lawyer accepts via API --------------------------------
  const acceptRes = await lawyerPage.request.post(
    `/api/bookings/${booking.id}/accept`,
    { data: {} },
  );
  expect(acceptRes.ok()).toBeTruthy();

  // ---- 5. Both pages react via SSE ------------------------------
  // Lawyer side: accept button replaced by waiting-for-client copy.
  await expect(
    lawyerPage.getByText(/Waiting for the client to fund escrow/i),
  ).toBeVisible({ timeout: 10_000 });
  // Hard reload would have reset the tab to URL with a fresh document load —
  // we assert URLs haven't changed and the page never navigated.
  expect(lawyerPage.url()).toBe(lawyerUrlBefore);

  // Client side: panel flips to awaiting-funding (engagementId still null,
  // both signed). The "Fund escrow" button should now be visible.
  await expect(
    clientPage.locator("[data-testid='order-action-panel']"),
  ).toHaveAttribute("data-phase", "awaiting-funding", { timeout: 10_000 });
  await expect(
    clientPage.getByRole("button", { name: /Fund escrow/i }),
  ).toBeVisible({ timeout: 5_000 });
  expect(clientPage.url()).toBe(clientUrlBefore);

  await clientCtx.close();
  await lawyerCtx.close();
});
