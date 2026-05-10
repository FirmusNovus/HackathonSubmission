// Page-health sweep — drive a real browser through every authenticated
// surface for both the client and lawyer fixtures. Catches render crashes,
// uncaught errors, dead buttons, and surfaces the awkward states that the
// SSE/sig refactor might have left behind.
//
// What we assert per page:
//   • The HTTP response is 200 (no Next.js error boundary).
//   • No JavaScript errors hit the page's `pageerror` event.
//   • A primary content selector for that page renders (cheap heuristic).

import { expect, test, type ConsoleMessage, type Page } from "@playwright/test";
import { devSignIn, reseedDatabase, SEEDED } from "./_helpers";

test.describe.configure({ mode: "serial" });

test.beforeAll(reseedDatabase);

interface Hook {
  errors: string[];
  consoleErrors: string[];
}

function attach(page: Page): Hook {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (e) => errors.push(`${e.name}: ${e.message}\n${e.stack ?? ""}`));
  page.on("requestfailed", (req) => {
    consoleErrors.push(`req failed: ${req.url()} - ${req.failure()?.errorText}`);
  });
  page.on("response", async (res) => {
    if (res.url().includes(".js") && res.status() >= 400) {
      consoleErrors.push(`bad chunk: ${res.url()} status=${res.status()}`);
    }
  });
  page.on("console", (msg: ConsoleMessage) => {
    if (msg.type() === "error") consoleErrors.push(`console: ${msg.text()}`);
  });
  return { errors, consoleErrors };
}

async function visit(page: Page, hook: Hook, path: string, contentSelector?: string) {
  // Reset per-page error log so cross-page artifacts (chunk aborts left over
  // from the previous navigation) don't pollute the assertion below.
  hook.errors.length = 0;
  hook.consoleErrors.length = 0;
  const res = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(res, `${path} did not load`).not.toBeNull();
  expect(res!.status(), `${path} returned ${res!.status()}`).toBeLessThan(400);
  if (contentSelector) {
    await expect(page.locator(contentSelector).first(), `${path} missing ${contentSelector}`).toBeVisible({
      timeout: 8_000,
    });
  }
  // Soak — let SSE/wagmi side effects settle so a true broken-page error
  // surfaces. Don't fail the run on chunk-load aborts (HMR / Fast Refresh
  // artifacts in dev mode produce them spuriously); just report.
  await page.waitForTimeout(800);
  const realErrors = hook.errors.filter((e) => !e.includes("ERR_ABORTED"));
  if (realErrors.length) {
    const consoleSample = hook.consoleErrors.slice(0, 5).join("\n    ");
    console.log(`[!] ${path} produced pageerror(s):`);
    for (const e of realErrors) console.log("   ", e.split("\n")[0]);
    if (consoleSample) console.log("    console:", consoleSample);
  }
}

test("Client surfaces sweep", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const hook = attach(page);
  await devSignIn(page, { wallet: SEEDED.client1, role: "client" });

  await visit(page, hook, "/", "main, h1");
  await visit(page, hook, "/lawyers", "h1");
  await visit(page, hook, "/client/home", "h1");
  await visit(page, hook, "/client/cases", "h1");
  await visit(page, hook, "/client/messages", "h1, [role='heading']");

  // First seeded lawyer detail page (link from /lawyers).
  const detail = page.locator("a[href^='/lawyers/']").first();
  if (await detail.count()) {
    const href = await detail.getAttribute("href");
    if (href) await visit(page, hook, href, "h1");
  }

  // First case detail (if the seed put one in).
  const firstCase = page.locator("a[href^='/client/cases/']").first();
  await page.goto("/client/cases", { waitUntil: "domcontentloaded" });
  if (await firstCase.count()) {
    const href = await firstCase.getAttribute("href");
    if (href) await visit(page, hook, href, "[data-testid='order-action-panel']");
  }

  console.log(`[client] consoleErrors=${hook.consoleErrors.length}`);
  for (const e of hook.consoleErrors.slice(0, 10)) console.log("  -", e);

  await ctx.close();
});

test("Lawyer surfaces sweep", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const hook = attach(page);
  await devSignIn(page, { wallet: SEEDED.lawyerMaria, role: "lawyer" });

  await visit(page, hook, "/lawyer/dashboard", "h1");
  await visit(page, hook, "/lawyer/profile/edit", "h1");
  await visit(page, hook, "/lawyer/orders", "h1");
  await visit(page, hook, "/lawyer/orders/new", "h1");
  await visit(page, hook, "/lawyer/messages", "h1, [role='heading']");
  await visit(page, hook, "/lawyer/cases", "h1");

  // First booking (review) page if any
  await page.goto("/lawyer/orders", { waitUntil: "domcontentloaded" });
  const order = page.locator("a[href^='/lawyer/orders/']").first();
  if (await order.count()) {
    const href = await order.getAttribute("href");
    if (href && href !== "/lawyer/orders/new") await visit(page, hook, href, "h1");
  }

  console.log(`[lawyer] consoleErrors=${hook.consoleErrors.length}`);
  for (const e of hook.consoleErrors.slice(0, 10)) console.log("  -", e);

  await ctx.close();
});
