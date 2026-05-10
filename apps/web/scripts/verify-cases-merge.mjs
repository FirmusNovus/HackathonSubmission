// Verify the Cases/Orders merge:
//   1. Client top-bar has no Orders tab; /client/orders → 404 (with auth).
//   2. /client/cases shows phase pill + contextual primary CTA per row.
//   3. Lawyer top-bar has Cases tab; /lawyer/cases lists post-signing work.
//   4. Dashboard "Active Cases" stat is now a link to /lawyer/cases.
//   5. Action panel still works on detail page (approve flow).
//
// Run: node scripts/verify-cases-merge.mjs

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
const ok = (m) => { pass.push(m); console.log(`  ✓ ${m}`); log.push(`OK ${m}`); };
const ko = (m) => { fail.push(m); console.log(`  ✗ ${m}`); log.push(`FAIL ${m}`); };
const expectVisible = async (locator, label) => {
  try { await locator.first().waitFor({ state: "visible", timeout: 5000 }); ok(label); return true; } catch { ko(label); return false; }
};
const expectNotInPage = async (re, label) => {
  if (re.test(await page.content())) ko(`${label} — found ${re}`); else ok(label);
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
  if (!r.ok) throw new Error(`POST /api/lawyer/orders failed ${r.status}`);
  return (await r.json()).booking.id;
};

try {
  console.log("\n=== CLIENT: cases is canonical, no Orders tab ===");
  await devSignIn(SARAH, "client");
  const tabs = (await page.locator("nav a").allTextContents()).map((s) => s.trim()).filter(Boolean);
  console.log(`  client tabs: ${JSON.stringify(tabs)}`);
  ["Home", "Cases", "Messages"].forEach((t) => tabs.includes(t) ? ok(`tab "${t}" present`) : ko(`tab "${t}" missing`));
  if (tabs.includes("Orders")) ko("Orders tab still on client"); else ok("Orders tab dropped from client");

  // /client/orders should 404 since the directory is gone
  const r = await fetch(`${BASE}/client/orders`, { redirect: "manual", headers: { cookie: (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } });
  if (r.status === 404) ok("/client/orders → 404 (page gone)");
  else ko(`/client/orders → ${r.status} (expected 404)`);

  // Visit /client/cases — verify phase pill renders
  await page.goto(`${BASE}/client/cases`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expectVisible(page.getByRole("heading", { name: /Your cases/i }), "/client/cases heading");
  await expectVisible(page.locator("text=/Approve orders to fund escrow/i").first(), "subtitle mentions approve+release");

  // Need to send a fresh order so we have an actionable row
  console.log("\n=== send order from Maria, expect actionable row in Cases ===");
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(MARIA, "lawyer");
  const newId = await lawyerSendOrder("VERIFY-MERGE: Sarah will see actionable phase");
  console.log(`  created order ${newId}`);
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(SARAH, "client");

  await page.goto(`${BASE}/client/cases`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expectVisible(page.locator("text=/Awaiting your approval/i").first(), "row shows 'Awaiting your approval' phase");
  await expectVisible(page.locator("a:has-text('Review & approve')").first(), "row shows 'Review & approve' primary CTA");
  await expectNotInPage(/Both parties signed · funds in escrow/, "old caption gone");

  // Click the primary CTA → detail page → approve dialog still works
  await page.locator("a:has-text('Review & approve')").first().click();
  await page.waitForURL(/\/client\/cases\/[a-z0-9]+/, { timeout: 5000 });
  await page.waitForTimeout(400);
  await expectVisible(page.getByTestId("order-action-panel"), "case detail still shows order-action-panel");
  await expectVisible(page.getByTestId("approve-order"), "approve-order button on detail");

  console.log("\n=== LAWYER: Cases tab + dashboard stat link ===");
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(MARIA, "lawyer");
  const lawyerTabs = (await page.locator("nav a").allTextContents()).map((s) => s.trim()).filter(Boolean);
  console.log(`  lawyer tabs: ${JSON.stringify(lawyerTabs)}`);
  ["Dashboard", "Orders", "Cases", "Messages", "Profile"].forEach((t) => lawyerTabs.includes(t) ? ok(`tab "${t}"`) : ko(`tab "${t}" missing`));

  // Dashboard stat is now a link
  const activeCasesStat = page.locator("a", { hasText: /Active Cases/i }).first();
  await expectVisible(activeCasesStat, "Active Cases stat is clickable");
  const href = await activeCasesStat.getAttribute("href");
  if (href === "/lawyer/cases") ok("Active Cases stat → /lawyer/cases");
  else ko(`Active Cases stat href='${href}'`);
  const pendingStat = page.locator("a", { hasText: /Pending orders/i }).first();
  const pendingHref = await pendingStat.getAttribute("href");
  if (pendingHref === "/lawyer/orders") ok("Pending orders stat → /lawyer/orders");
  else ko(`Pending orders stat href='${pendingHref}'`);

  // /lawyer/cases page renders with seeded ACCEPTED bookings
  await page.goto(`${BASE}/lawyer/cases`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expectVisible(page.getByRole("heading", { name: /Your cases/i }), "/lawyer/cases heading");
  await expectVisible(page.locator("text=/Manage/").first(), "lawyer cases row has Manage button");

  // /lawyer/orders is still the pending-orders inbox
  await page.goto(`${BASE}/lawyer/orders`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await expectVisible(page.getByRole("heading", { name: /Pending orders/i }), "/lawyer/orders heading still 'Pending orders'");

} catch (err) {
  ko(`UNCAUGHT: ${err.message}`);
  console.error(err.stack);
} finally {
  console.log(`\n=== SUMMARY ===\n  passed: ${pass.length}\n  failed: ${fail.length}`);
  if (fail.length) for (const f of fail) console.log(`  - ${f}`);
  await browser.close();
  process.exit(fail.length ? 1 : 0);
}
