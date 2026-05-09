import { execSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { devSignIn, SEEDED } from "./_helpers";

/**
 * Regression — when the database is re-seeded (e.g. by another developer or a
 * different Playwright run) the JWT in the browser cookie holds a `user.id`
 * that no longer references a row in `User`. Without `getCurrentUser()`'s
 * walletAddress lookup, the next mutating call (POST /api/bookings, etc.)
 * fails with "Foreign key constraint violated on Booking_clientId_fkey" and
 * the UI shows "Could not create booking".
 *
 * The test signs in, reseeds the DB out from under the cookie, and then
 * exercises the mutating endpoints. They must self-heal.
 */
test("Stale cookie after DB reseed — POST /api/bookings still succeeds", async ({ page }) => {
  await devSignIn(page, { wallet: SEEDED.client1, role: "client" });

  // Reseed: every row in the User table is replaced with a new cuid. The
  // browser's cookie still holds the previous session JWT.
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore" });

  // Pick a lawyer + drive the booking POST as the booking-form would.
  const lawyersRes = await page.request.get("/api/lawyers");
  const { lawyers } = (await lawyersRes.json()) as { lawyers: Array<{ id: string }> };
  expect(lawyers.length).toBeGreaterThan(0);

  const r = await page.request.post("/api/bookings", {
    data: {
      lawyerProfileId: lawyers[0].id,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
      durationMinutes: 60,
      practiceArea: "Family",
      caseDescription: "Stale-cookie regression check.",
      lineItems: [{ id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 }],
      deliverables: [{ id: "d-1", title: "Live consultation" }],
    },
  });
  expect(r.status()).toBe(200);
  const data = (await r.json()) as { booking: { status: string } };
  expect(data.booking.status).toBe("REQUESTED");
});

test("Stale cookie after DB reseed — POST /api/messages still succeeds", async ({ page }) => {
  await devSignIn(page, { wallet: SEEDED.client1, role: "client" });

  // Reseed first; the cookie now references a removed user.id.
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore" });

  // Fetch Sarah's (recreated) bookings + a conversation. /api/bookings still
  // works because the route handler resolves the user fresh by walletAddress.
  const list = await page.request.get("/api/bookings");
  expect(list.status()).toBe(200);
  const { bookings } = (await list.json()) as { bookings: Array<{ id: string }> };
  if (!bookings.length) {
    test.skip();
    return;
  }
  const detail = await page.request.get(`/api/bookings/${bookings[0].id}`);
  expect(detail.status()).toBe(200);
  const { booking } = (await detail.json()) as { booking: { conversation?: { id: string } | null } };
  if (!booking.conversation) {
    test.skip();
    return;
  }

  const r = await page.request.post("/api/messages", {
    data: { conversationId: booking.conversation.id, content: "Surviving the reseed." },
  });
  expect(r.status()).toBe(200);
});
