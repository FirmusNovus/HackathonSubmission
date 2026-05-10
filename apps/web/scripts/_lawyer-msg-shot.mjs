import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const MARIA = "0x1111000000000000000000000000000000000001";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/dev/sign-in?wallet=${MARIA}&role=lawyer&redirect=/lawyer/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForURL(/lawyer\/dashboard/, { timeout: 15_000 });
  await page.waitForTimeout(800);
  await page.goto(`${BASE}/lawyer/messages`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2200);
  console.log("url:", page.url());
  await page.screenshot({ path: "/tmp/lm-full.png", fullPage: false });

  // Click first thread to make sure form is showing
  await page.locator("aside li button").first().click().catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: "/tmp/lm-thread.png", fullPage: false });

  // Snap the form area only
  const form = page.locator("form").first();
  if (await form.count()) await form.screenshot({ path: "/tmp/lm-form.png" });

  // Try various viewports for breakpoint sensitivity
  for (const w of [1100, 1280, 1440, 900]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `/tmp/lm-form-${w}.png`, clip: { x: 0, y: 800, width: w, height: 100 } }).catch(() => {});
  }
} catch (e) {
  console.log("ERR:", e.message);
}
await browser.close();
console.log("done");
