import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const SARAH = "0x2222000000000000000000000000000000000001";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 3 });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/dev/sign-in?wallet=${SARAH}&role=client&redirect=/client/home`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  console.log("after dev sign-in url:", page.url());
  await page.waitForTimeout(1500);
  await page.goto(`${BASE}/client/messages`, { waitUntil: "domcontentloaded" });
  console.log("after messages goto url:", page.url());
  await page.waitForTimeout(2500);
  await page.screenshot({ path: "/tmp/zm-full.png", fullPage: true });
  console.log("full-page shot saved");

  // Click second thread (which had messages in earlier verify run)
  const items = await page.locator("aside li").count();
  console.log("sidebar items:", items);
  await page.locator("aside li button").nth(0).click().catch((e) => console.log("click err:", e.message));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: "/tmp/zm-after-click.png", fullPage: true });

  const headerCount = await page.locator("section > header").count();
  console.log("section>header count:", headerCount);
  if (headerCount) await page.locator("section > header").first().screenshot({ path: "/tmp/zm-header.png" });

  const sidebarCount = await page.locator("aside li button").count();
  if (sidebarCount) await page.locator("aside li button").first().screenshot({ path: "/tmp/zm-sidebar.png" });
} catch (e) {
  console.log("ERR:", e.message);
  await page.screenshot({ path: "/tmp/zm-err.png", fullPage: true }).catch(() => {});
}
await browser.close();
console.log("done");
