import { chromium } from "@playwright/test";
const SARAH = "0x2222000000000000000000000000000000000001";
const MARIA = "0x1111000000000000000000000000000000000001";
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 200 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const clip = { x: 0, y: 0, width: 1280, height: 64 };

// Logged out
await page.goto("http://localhost:3000/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/nav-1-landing-loggedout.png", clip });
await page.goto("http://localhost:3000/lawyers", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/nav-2-lawyers-loggedout.png", clip });
await page.goto("http://localhost:3000/connect", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/nav-3-connect-loggedout.png", clip });

// Sign in as Sarah → client pages
await page.goto(`http://localhost:3000/dev/sign-in?wallet=${SARAH}&role=client&redirect=/client/home`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/nav-4-client-home.png", clip });
await page.goto("http://localhost:3000/client/cases", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/nav-5-client-cases.png", clip });
await page.goto("http://localhost:3000/lawyers", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/nav-6-lawyers-signed-in.png", clip });

// Lawyer
await page.goto("http://localhost:3000/api/auth/signout"); await page.waitForTimeout(300);
await page.goto(`http://localhost:3000/dev/sign-in?wallet=${MARIA}&role=lawyer&redirect=/lawyer/dashboard`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1500);
await page.screenshot({ path: "/tmp/nav-7-lawyer-dashboard.png", clip });
await page.goto("http://localhost:3000/verify-lawyer", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/nav-8-verify-lawyer.png", clip });

await browser.close();
console.log("done");
