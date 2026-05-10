// Verify the new client invoice UX:
//   1. Lawyer sends Sarah an invoice
//   2. Sarah sees Invoices tab + "Awaiting your approval" row + Approve/Decline on detail page
//   3. Approve → Funds in escrow → Release funds button
//   4. Decline path also works (separate booking)

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "/tmp/firmus-invoice-verify";
const SARAH = "0x2222000000000000000000000000000000000001";
const MARIA = "0x1111000000000000000000000000000000000001";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const log = [];
const note = (m) => { console.log(m); log.push(m); };
const shoot = (n) => page.screenshot({ path: `${OUT}-${n}.png`, fullPage: true }).then(() => note(`shot: ${OUT}-${n}.png`));

const devSignIn = async (wallet, role) => {
  const dest = role === "lawyer" ? "/lawyer/dashboard" : "/client/home";
  await page.goto(`${BASE}/dev/sign-in?wallet=${wallet}&role=${role}&redirect=${encodeURIComponent(dest)}`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(new RegExp(dest.replaceAll("/", "\\/")), { timeout: 10_000 });
  await page.waitForTimeout(400);
};

const lawyerSendInvoice = async (caseDescription, lineItems = [{ id: "li-1", title: "60-min consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 }]) => {
  const cookie = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const r = await fetch(`${BASE}/api/lawyer/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({
      clientWalletAddress: SARAH,
      scheduledAt: new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString(),
      durationMinutes: 60,
      practiceArea: "Family",
      caseDescription,
      lineItems,
      deliverables: [{ id: "d-1", title: "Live consultation" }],
    }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(`invoice POST failed ${r.status}: ${JSON.stringify(body)}`);
  return body.booking.id;
};

try {
  // Send TWO invoices as Maria — one for approve path, one for decline.
  await devSignIn(MARIA, "lawyer");
  const approveBooking = await lawyerSendInvoice("VERIFY: invoice the client will approve");
  note(`created approve-path booking: ${approveBooking}`);
  const declineBooking = await lawyerSendInvoice("VERIFY: invoice the client will decline");
  note(`created decline-path booking: ${declineBooking}`);

  // Switch to Sarah
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(SARAH, "client");

  // Top-bar shows Invoices tab now
  const tabs = await page.$$eval("nav a", (as) => as.map((a) => a.textContent?.trim()));
  note(`top-bar tabs (client): ${JSON.stringify(tabs)}`);
  if (!tabs.includes("Invoices")) note("!! MISSING: Invoices tab");

  // /client/invoices list
  await page.goto(`${BASE}/client/invoices`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await shoot("01-invoices-list");
  const awaitingCount = await page.getByText(/Awaiting your approval/i).count();
  const releaseRowCount = await page.getByText(/Release funds/).count();
  note(`'Awaiting your approval' row count: ${awaitingCount}`);
  note(`'Release funds' affordances visible on list: ${releaseRowCount}`);

  // Open the approve booking detail
  await page.goto(`${BASE}/client/cases/${approveBooking}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await shoot("02-detail-awaiting");
  const phase = await page.getByTestId("invoice-action-panel").getAttribute("data-phase");
  note(`detail phase: ${phase}`);
  const approveVisible = await page.getByTestId("approve-invoice").isVisible();
  const declineVisible = await page.getByTestId("decline-invoice").isVisible();
  note(`approve button visible: ${approveVisible}`);
  note(`decline button visible: ${declineVisible}`);

  // Click approve → confirm dialog → submit
  await page.getByTestId("approve-invoice").click();
  await page.waitForSelector("[role=dialog]", { timeout: 3_000 });
  await shoot("03-approve-dialog");
  await page.getByRole("button", { name: /Approve & fund/i }).click();
  await page.waitForTimeout(3_000); // escrow mock takes 2s
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
  await page.goto(`${BASE}/client/cases/${approveBooking}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await shoot("04-detail-in-escrow");
  const phaseAfter = await page.getByTestId("invoice-action-panel").getAttribute("data-phase");
  note(`detail phase after approve: ${phaseAfter}`);
  const releaseVisible = await page.getByTestId("release-funds").isVisible().catch(() => false);
  note(`release-funds button visible after approve: ${releaseVisible}`);

  // Click release → confirm
  await page.getByTestId("release-funds").click();
  await page.waitForSelector("[role=dialog]", { timeout: 3_000 });
  await shoot("05-release-dialog");
  await page.getByRole("button", { name: /Release €|Release \$/ }).click();
  await page.waitForTimeout(2500);
  await page.goto(`${BASE}/client/cases/${approveBooking}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await shoot("06-detail-released");
  const phaseReleased = await page.getByTestId("invoice-action-panel").getAttribute("data-phase");
  note(`detail phase after release: ${phaseReleased}`);

  // Decline path on the second booking
  await page.goto(`${BASE}/client/cases/${declineBooking}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await page.getByTestId("decline-invoice").click();
  await page.waitForSelector("[role=dialog]", { timeout: 3_000 });
  await shoot("07-decline-dialog");
  await page.getByRole("button", { name: /Decline invoice/i }).click();
  await page.waitForTimeout(1200);
  await page.goto(`${BASE}/client/cases/${declineBooking}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await shoot("08-detail-declined");
  const phaseDeclined = await page.getByTestId("invoice-action-panel").getAttribute("data-phase");
  note(`detail phase after decline: ${phaseDeclined}`);

  // Final invoices list
  await page.goto(`${BASE}/client/invoices`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  await shoot("09-invoices-list-final");
} catch (err) {
  note(`ERROR: ${err.message}\n${err.stack}`);
  await shoot("err");
} finally {
  const fs = await import("node:fs");
  fs.writeFileSync(`${OUT}-log.txt`, log.join("\n"));
  await browser.close();
  note(`log: ${OUT}-log.txt`);
}
