import { chromium } from "@playwright/test";
const BASE = "http://localhost:3000";
const SARAH = "0x2222000000000000000000000000000000000001";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.goto(`${BASE}/dev/sign-in?wallet=${SARAH}&role=client&redirect=/client/messages`, { waitUntil: "domcontentloaded" });
await page.waitForURL(/messages/, { timeout: 10_000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/firmus-messages.png", fullPage: false });

// Also zoom in on the chat header (avatar with verified seal)
const header = await page.locator("header").nth(1);
if (await header.count()) {
  await header.first().screenshot({ path: "/tmp/firmus-messages-header.png" });
}
// And zoom in on first message author bubble
const firstAvatar = page.locator(".overflow-y-auto").locator(".relative.shrink-0").first();
await firstAvatar.screenshot({ path: "/tmp/firmus-messages-thread-avatar.png" }).catch(() => {});
await browser.close();
console.log("done");
