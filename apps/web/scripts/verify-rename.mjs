// End-to-end verification that the request/invoice → order rename didn't
// break any flow. Walks both client and lawyer through their key pages and
// asserts that key labels render correctly after rename.

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const SARAH = "0x2222000000000000000000000000000000000001";
const MARIA = "0x1111000000000000000000000000000000000001";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const log = [];
const pass = [];
const fail = [];
const note = (m) => { console.log(m); log.push(m); };
const ok = (m) => { pass.push(m); note(`  ✓ ${m}`); };
const ko = (m) => { fail.push(m); note(`  ✗ ${m}`); };
const expect = async (locator, label, options = {}) => {
  try {
    await locator.first().waitFor({ state: "visible", timeout: options.timeout ?? 5000 });
    ok(label);
    return true;
  } catch {
    ko(label);
    return false;
  }
};
const expectNoMatch = async (re, label) => {
  const txt = await page.content();
  if (re.test(txt)) ko(`${label} — found "${re}"`); else ok(label);
};

const devSignIn = async (wallet, role) => {
  const dest = role === "lawyer" ? "/lawyer/dashboard" : "/client/home";
  await page.goto(`${BASE}/dev/sign-in?wallet=${wallet}&role=${role}&redirect=${encodeURIComponent(dest)}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(new RegExp(dest.replaceAll("/", "\\/")), { timeout: 10_000 });
  await page.waitForTimeout(400);
};

const lawyerSendOrder = async (caseDescription) => {
  const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const r = await fetch(`${BASE}/api/lawyer/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      clientWalletAddress: SARAH,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
      durationMinutes: 60,
      practiceArea: "Family",
      caseDescription,
      lineItems: [{ id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 }],
      deliverables: [{ id: "d-1", title: "Live consultation" }],
    }),
  });
  if (!r.ok) throw new Error(`POST /api/lawyer/orders failed ${r.status}: ${await r.text()}`);
  return (await r.json()).booking.id;
};

try {
  // =========================================================================
  // PUBLIC LANDING + ONBOARDING
  // =========================================================================
  note("\n=== PUBLIC LANDING + ONBOARDING ===");
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await expect(page.getByRole("button", { name: /^Sign In$/i }), "Landing has Sign In button");
  await expect(page.getByRole("link", { name: /^Lawyers$/i }).first(), "Landing has Lawyers nav link");
  await expectNoMatch(/For Lawyers/, "Landing nav has no 'For Lawyers' link");

  await page.getByRole("button", { name: /^Sign In$/i }).click();
  await page.waitForURL(/\/connect/, { timeout: 10_000 });
  await expect(page.getByRole("heading", { name: /Welcome to Firmus Novus/i }), "/connect shows role pick");
  await expect(page.getByRole("button", { name: /I need legal help/i }), "/connect has client role card");
  await expect(page.getByRole("button", { name: /I'm a lawyer/i }), "/connect has lawyer role card");
  await expect(page.locator("text=/EUDI wallet/i").first(), "/connect mentions EUDI wallet (not wwwallet)");
  await expectNoMatch(/wwwallet/i, "/connect has no 'wwwallet' references");

  // =========================================================================
  // CLIENT FLOWS
  // =========================================================================
  note("\n=== CLIENT FLOWS ===");
  await devSignIn(SARAH, "client");
  await expect(page.getByRole("heading", { name: /what do you need help with/i }), "/client/home renders");

  // Top-bar tabs
  const clientTabs = await page.locator("nav a").allTextContents();
  const tabLabels = clientTabs.map((s) => s.trim()).filter(Boolean);
  note(`  client top-bar: ${JSON.stringify(tabLabels)}`);
  ["Home", "Cases", "Orders", "Messages"].forEach((t) =>
    tabLabels.includes(t) ? ok(`client tab "${t}" present`) : ko(`client tab "${t}" missing`),
  );
  if (tabLabels.includes("Invoices")) ko("client tab still says 'Invoices'");
  else ok("no 'Invoices' tab on client");

  // Cases page
  await page.goto(`${BASE}/client/cases`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: /Your cases/i }), "/client/cases heading");
  await expectNoMatch(/Invoice |Review & sign invoice/, "/client/cases has no 'Invoice' / 'Review & sign invoice' labels");

  // Orders page (was /client/invoices)
  await page.goto(`${BASE}/client/orders`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: /^Orders$/ }), "/client/orders heading is 'Orders'");
  await expectNoMatch(/^Invoices$/m, "/client/orders heading is not 'Invoices'");

  // Messages
  await page.goto(`${BASE}/client/messages`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: /^Messages$/ }).first(), "/client/messages renders");

  // =========================================================================
  // LAWYER SENDS ORDER → CLIENT REVIEWS → APPROVES → RELEASES
  // =========================================================================
  note("\n=== LAWYER → CLIENT ORDER FLOW ===");
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(MARIA, "lawyer");

  // Lawyer top-bar
  const lawyerTabs = (await page.locator("nav a").allTextContents()).map((s) => s.trim()).filter(Boolean);
  note(`  lawyer top-bar: ${JSON.stringify(lawyerTabs)}`);
  ["Dashboard", "Orders", "Messages", "Profile"].forEach((t) =>
    lawyerTabs.includes(t) ? ok(`lawyer tab "${t}" present`) : ko(`lawyer tab "${t}" missing`),
  );
  if (lawyerTabs.includes("Requests")) ko("lawyer tab still says 'Requests'");
  else ok("no 'Requests' tab on lawyer");

  // Dashboard text
  await expect(page.getByRole("link", { name: /Create an order/i }), "Dashboard has 'Create an order' button");
  await expectNoMatch(/Send an invoice/, "Dashboard has no 'Send an invoice'");
  await expectNoMatch(/Pending Requests/, "Dashboard has no 'Pending Requests' label");
  await expect(page.locator("text=/Pending orders/i").first(), "Dashboard 'Pending orders' stat label visible");

  // Orders list
  await page.goto(`${BASE}/lawyer/orders`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expect(page.getByRole("heading", { name: /Pending orders/i }), "/lawyer/orders heading");
  await expectNoMatch(/Pending requests<\/h1>/i, "/lawyer/orders not titled 'Pending requests'");

  // New order page
  await page.goto(`${BASE}/lawyer/orders/new`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(700);
  await expect(page.getByRole("heading", { name: /Create an order/i }), "/lawyer/orders/new heading");
  await expect(page.locator("text=/Order total/i").first(), "Sidebar says 'Order total'");
  await expect(page.locator("text=/Sign & send order/i").first(), "Submit button label 'Sign & send order'");
  await expectNoMatch(/Sign & send invoice/, "/lawyer/orders/new has no 'Sign & send invoice'");

  // Send a programmatic order, switch to Sarah, drive the action panel
  const bookingId = await lawyerSendOrder("VERIFY-RENAME: Sarah will approve");
  note(`  created order ${bookingId}`);
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(SARAH, "client");

  // Check it appears in /client/orders with right badge
  await page.goto(`${BASE}/client/orders`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expect(page.locator("text=/Awaiting your approval/i").first(), "/client/orders shows 'Awaiting your approval'");

  // Open order detail, find action panel
  await page.goto(`${BASE}/client/cases/${bookingId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const phase = await page.getByTestId("order-action-panel").getAttribute("data-phase").catch(() => null);
  if (phase === "awaiting-client") ok("order-action-panel has data-phase='awaiting-client'");
  else ko(`order-action-panel data-phase='${phase}' (expected 'awaiting-client')`);
  await expect(page.getByTestId("approve-order"), "approve-order button visible");
  await expect(page.getByTestId("decline-order"), "decline-order button visible");

  // Click approve, confirm dialog, submit
  await page.getByTestId("approve-order").click();
  await page.waitForSelector("[role=dialog]", { timeout: 3000 });
  await expect(page.getByRole("button", { name: /Approve & fund/i }), "approve dialog has 'Approve & fund' button");
  await page.getByRole("button", { name: /Approve & fund/i }).click();
  await page.waitForTimeout(3000);
  await page.goto(`${BASE}/client/cases/${bookingId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const phase2 = await page.getByTestId("order-action-panel").getAttribute("data-phase").catch(() => null);
  if (phase2 === "in-escrow") ok("after approve, phase = 'in-escrow'");
  else ko(`after approve, phase='${phase2}'`);
  await expect(page.getByTestId("release-funds"), "release-funds button visible");

  // Release
  await page.getByTestId("release-funds").click();
  await page.waitForSelector("[role=dialog]", { timeout: 3000 });
  await page.getByRole("button", { name: /Release €/ }).click();
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/client/cases/${bookingId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const phase3 = await page.getByTestId("order-action-panel").getAttribute("data-phase").catch(() => null);
  if (phase3 === "released") ok("after release, phase = 'released'");
  else ko(`after release, phase='${phase3}'`);

  // Decline path on a fresh order
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(MARIA, "lawyer");
  const declineId = await lawyerSendOrder("VERIFY-RENAME: Sarah will decline");
  note(`  created decline-target order ${declineId}`);
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(SARAH, "client");
  await page.goto(`${BASE}/client/cases/${declineId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await page.getByTestId("decline-order").click();
  await page.waitForSelector("[role=dialog]", { timeout: 3000 });
  await expect(page.getByRole("button", { name: /Decline order/i }), "decline dialog has 'Decline order' button");
  await page.getByRole("button", { name: /Decline order/i }).click();
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/client/cases/${declineId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  const phase4 = await page.getByTestId("order-action-panel").getAttribute("data-phase").catch(() => null);
  if (phase4 === "declined") ok("after decline, phase = 'declined'");
  else ko(`after decline, phase='${phase4}'`);

  // =========================================================================
  // LAWYER MESSAGES — "Send order" button
  // =========================================================================
  note("\n=== LAWYER MESSAGES ===");
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(MARIA, "lawyer");
  await page.goto(`${BASE}/lawyer/messages`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  // Click first thread
  await page.locator("aside li button").first().click().catch(() => {});
  await page.waitForTimeout(500);
  await expect(page.locator("a:has-text('Send order')").first(), "Lawyer messages has 'Send order' button");
  await expectNoMatch(/Send invoice/, "Lawyer messages no 'Send invoice'");

  // Confirm clicking it goes to /lawyer/orders/new
  const sendOrderHref = await page.locator("a:has-text('Send order')").first().getAttribute("href");
  if (sendOrderHref?.startsWith("/lawyer/orders/new")) ok(`Send order link goes to /lawyer/orders/new (was ${sendOrderHref})`);
  else ko(`Send order href wrong: ${sendOrderHref}`);

  // =========================================================================
  // OLD ROUTES SHOULD 404 NOW
  // =========================================================================
  note("\n=== STALE ROUTES (should 404) ===");
  for (const stale of ["/lawyer/requests", "/lawyer/invoices/new", "/client/invoices"]) {
    const r = await fetch(`${BASE}${stale}`, { redirect: "manual", headers: { cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } });
    if (r.status === 404) ok(`${stale} → 404`);
    else ko(`${stale} → ${r.status} (expected 404)`);
  }

} catch (err) {
  ko(`UNCAUGHT: ${err.message}`);
  console.error(err.stack);
} finally {
  note(`\n=== SUMMARY ===\n  passed: ${pass.length}\n  failed: ${fail.length}`);
  if (fail.length) {
    note(`\nFailures:`);
    for (const f of fail) note(`  - ${f}`);
  }
  const fs = await import("node:fs");
  fs.writeFileSync(`/tmp/firmus-rename-verify.log`, log.join("\n"));
  await browser.close();
  process.exit(fail.length ? 1 : 0);
}
