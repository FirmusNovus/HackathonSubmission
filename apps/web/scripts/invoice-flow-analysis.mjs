// IS-state walk for the client invoice flow.
//   1. lawyer (Maria) sends an invoice to client (Sarah) via /api/lawyer/invoices
//   2. client signs in, we walk /client/home, /client/cases, /client/cases/[id]
//   3. dump every visible button + look for approve/decline/release affordances
//
// Run: pnpm dev (in another shell) then `node scripts/invoice-flow-analysis.mjs`

import { chromium } from "@playwright/test";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "/tmp/firmus-invoice";
const SARAH = "0x2222000000000000000000000000000000000001";
const MARIA = "0x1111000000000000000000000000000000000001";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const log = [];
const note = (m) => { console.log(m); log.push(m); };
const shoot = (n) => page.screenshot({ path: `${OUT}-${n}.png`, fullPage: true }).then(() => note(`shot: ${OUT}-${n}.png`));
const dump = async (label) => {
  const ctrls = await page.$$eval("button, a", (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || "").trim().split("\n")[0].slice(0, 80),
      href: el.getAttribute("href") || undefined,
      testid: el.getAttribute("data-testid") || undefined,
      disabled: el.hasAttribute("disabled") || undefined,
    })),
  );
  const filtered = ctrls.filter((c) => c.text);
  note(`-- ${label} -- (${filtered.length} controls, url=${page.url()})`);
  for (const c of filtered) {
    note(`  ${c.tag}${c.testid ? `[${c.testid}]` : ""}${c.disabled ? "[disabled]" : ""}: "${c.text}"${c.href ? ` -> ${c.href}` : ""}`);
  }
};

const devSignIn = async (wallet, role) => {
  const dest = role === "lawyer" ? "/lawyer/dashboard" : "/client/home";
  await page.goto(`${BASE}/dev/sign-in?wallet=${wallet}&role=${role}&redirect=${encodeURIComponent(dest)}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForURL(new RegExp(dest.replaceAll("/", "\\/")), { timeout: 10_000 });
  await page.waitForTimeout(500);
};

try {
  // 1. Sign in as Maria, post an invoice to Sarah via the API.
  await devSignIn(MARIA, "lawyer");
  note("signed in as Maria (lawyer)");

  const cookieHeader = (await ctx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ");
  const scheduledAt = new Date(Date.now() + 1000 * 60 * 60 * 48).toISOString();
  const resp = await fetch(`${BASE}/api/lawyer/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: cookieHeader },
    body: JSON.stringify({
      clientWalletAddress: SARAH,
      scheduledAt,
      durationMinutes: 60,
      practiceArea: "Family",
      caseDescription: "TEST invoice for IS-analysis — sent by lawyer, awaiting client signature.",
      lineItems: [{ id: "li-test-1", title: "60-minute consultation", kind: "hourly", hours: 1, ratePerHour: 240, subtotal: 240 }],
      deliverables: [{ id: "d-test-1", title: "Live consultation", description: "60-minute video meeting" }],
    }),
  });
  const body = await resp.json();
  if (!resp.ok) {
    note(`!! invoice POST failed: ${resp.status} ${JSON.stringify(body).slice(0, 200)}`);
    throw new Error("invoice creation failed");
  }
  const newBookingId = body.booking.id;
  note(`created lawyer-initiated invoice booking: ${newBookingId}`);

  // 2. Sign out, then sign in as Sarah.
  await page.goto(`${BASE}/api/auth/signout`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(300);
  await devSignIn(SARAH, "client");
  note("signed in as Sarah (client)");

  // /client/home
  await dump("client/home");
  await shoot("01-client-home");

  // /client/cases — list
  await page.goto(`${BASE}/client/cases`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await dump("client/cases (list)");
  await shoot("02-client-cases-list");

  // Look for the new booking specifically
  const reviewBtns = await page.getByRole("link", { name: /Review & sign invoice/i }).count();
  note(`'Review & sign invoice' link count: ${reviewBtns}`);

  // /client/cases/[id] — newly-created lawyer-initiated invoice (awaiting client sig)
  await page.goto(`${BASE}/client/cases/${newBookingId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await dump("client/cases/[id] — awaiting client sig");
  await shoot("03-client-case-awaiting-sign");

  const signBtnCount = await page.getByRole("button", { name: /Sign invoice/i }).count();
  const declineBtnCount = await page.getByRole("button", { name: /Decline/i }).count();
  const releaseBtnCount = await page.getByRole("button", { name: /Release|Mark complete|Release funds/i }).count();
  note(`approve/sign-button count: ${signBtnCount}`);
  note(`decline-button count: ${declineBtnCount}`);
  note(`release/complete-button count: ${releaseBtnCount}`);

  // Check an ACCEPTED booking too — find one from the seed (Sarah -> Maria, ACCEPTED)
  await page.goto(`${BASE}/client/cases`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(400);
  const acceptedHref = await page.getByRole("link", { name: /^Invoice$/ }).first().getAttribute("href");
  if (acceptedHref) {
    await page.goto(`${BASE}${acceptedHref}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(400);
    await dump("client/cases/[id] — ACCEPTED booking");
    await shoot("04-client-case-accepted");

    const completeBtn = await page.getByRole("button", { name: /Release|Mark complete|Release funds/i }).count();
    note(`release-funds button count on ACCEPTED case: ${completeBtn}`);
  }

  // /client/messages — does the invoice show up there?
  await page.goto(`${BASE}/client/messages`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(500);
  await dump("client/messages");
  await shoot("05-client-messages");

  // Top-bar tabs — is there an Invoices tab?
  const tabs = await page.$$eval("nav a", (as) => as.map((a) => a.textContent?.trim()));
  note(`top-bar tabs: ${JSON.stringify(tabs)}`);
} catch (err) {
  note(`ERROR: ${err.message}`);
  await shoot("err");
} finally {
  const fs = await import("node:fs");
  fs.writeFileSync(`${OUT}-log.txt`, log.join("\n"));
  await browser.close();
  note(`log: ${OUT}-log.txt`);
}
