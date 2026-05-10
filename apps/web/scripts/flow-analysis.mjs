// Walks through the new sign-in flow against http://localhost:3000 and dumps
// what's on screen at each stage + screenshots. Used for IS-state analysis
// only. Not committed to the suite.

import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "/tmp/firmus-flow";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

const log = [];
const note = (msg) => {
  console.log(msg);
  log.push(msg);
};

const shoot = async (name) => {
  await page.screenshot({ path: `${OUT}-${name}.png`, fullPage: true });
  note(`screenshot: ${OUT}-${name}.png`);
};

const dumpButtons = async (label) => {
  const btns = await page.$$eval("button, a", (els) =>
    els.map((el) => ({
      tag: el.tagName.toLowerCase(),
      text: (el.innerText || "").trim().slice(0, 80),
      href: el.getAttribute("href") || undefined,
      role: el.getAttribute("role") || undefined,
      testid: el.getAttribute("data-testid") || undefined,
      disabled: el.hasAttribute("disabled") || undefined,
    })),
  );
  const filtered = btns.filter((b) => b.text);
  note(`-- ${label} -- (${filtered.length} controls)`);
  for (const b of filtered) {
    note(`  ${b.tag}${b.testid ? `[data-testid=${b.testid}]` : ""}${b.disabled ? " [disabled]" : ""}: "${b.text}"${b.href ? ` -> ${b.href}` : ""}`);
  }
};

try {
  // 1. Landing
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  note(`URL: ${page.url()}`);
  await dumpButtons("landing");
  await shoot("01-landing");

  // 2. Click Sign In (navbar) — should spin then route to /connect
  const signIn = page.getByRole("button", { name: /^Sign In$/i }).first();
  await signIn.click();
  await page.waitForURL(/\/connect/, { timeout: 5_000, waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  note(`URL: ${page.url()}`);
  await dumpButtons("connect-role");
  await shoot("02-connect-role");

  // 3. Pick CLIENT and continue
  await page.getByRole("button", { name: /I need legal help/i }).click();
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.waitForTimeout(400);
  note(`URL: ${page.url()}`);
  await dumpButtons("connect-pid-client");
  await shoot("03-connect-pid-client");

  // Look for back button presence on this stage
  const backBtns = await page.getByRole("button", { name: /^Back$/i }).count();
  note(`back-button count on PID stage (client): ${backBtns}`);

  // 4. Present PID via wwwallet
  const pidBtn = page.getByTestId("present-pid");
  await pidBtn.click();
  await page.waitForTimeout(200);
  await shoot("04-pid-spinning");
  await page.waitForSelector("[data-testid=pid-attested]", { timeout: 8_000 });
  await dumpButtons("connect-pid-attested-client");
  await shoot("05-pid-attested-client");

  // Don't finish — just verify the next CTA reads correctly
  const enter = await page.getByRole("button", { name: /Enter Firmus Novus/i }).count();
  note(`"Enter Firmus Novus" button visible (client): ${enter}`);

  // 5. Now test LAWYER side.
  await page.goto(`${BASE}/connect?role=lawyer`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(600);
  await dumpButtons("connect-role-lawyer");
  await page.getByRole("button", { name: /I'm a lawyer/i }).click();
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.waitForTimeout(400);
  await dumpButtons("connect-pid-lawyer");
  await shoot("06-connect-pid-lawyer");

  const lawyerBackOnPid = await page.getByRole("button", { name: /^Back$/i }).count();
  note(`back-button count on PID stage (lawyer): ${lawyerBackOnPid}`);

  await page.getByTestId("present-pid").click();
  await page.waitForSelector("[data-testid=pid-attested]", { timeout: 8_000 });
  await page.getByRole("button", { name: /^Continue$/ }).click();
  await page.waitForTimeout(400);
  await dumpButtons("connect-lawyer-cred");
  await shoot("07-connect-lawyer-cred");

  const lawyerBackOnLc = await page.getByRole("button", { name: /^Back$/i }).count();
  note(`back-button count on LAWYER-CRED stage: ${lawyerBackOnLc}`);

  await page.getByTestId("present-lawyer-cred").click();
  await page.waitForSelector("[data-testid=lawyer-cred-attested]", { timeout: 8_000 });
  await dumpButtons("connect-lawyer-cred-attested");
  await shoot("08-lawyer-cred-attested");

  // Cancel link in top-right?
  const cancel = await page.getByRole("link", { name: /^Cancel$/i }).count();
  note(`Cancel link count (lawyer-cred stage): ${cancel}`);

} catch (err) {
  note(`ERROR: ${err.message}`);
  await shoot("err");
} finally {
  writeFileSync(`${OUT}-log.txt`, log.join("\n"));
  await browser.close();
  note(`log: ${OUT}-log.txt`);
}
