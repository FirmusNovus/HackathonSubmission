import { execSync } from "node:child_process";
import { expect, type Locator, type Page } from "@playwright/test";

/** Reset the DB to seed state. Call inside `test.beforeAll` of any spec that
 *  mutates rows, so subsequent tests start from a known baseline. */
export function reseedDatabase() {
  execSync("npx tsx prisma/seed.ts", { stdio: "ignore" });
}

/**
 * Click a control and assert "something happened":
 *   - URL changed, OR
 *   - a network request was issued, OR
 *   - the DOM mutated.
 *
 * If none of those is true, the button is unwired and we fail.
 */
export async function clickAndExpectSideEffect(page: Page, locator: Locator, label: string) {
  await expect(locator, `${label} should be visible`).toBeVisible();
  await expect(locator, `${label} should be enabled`).toBeEnabled();

  const beforeURL = page.url();
  let networkSeen = false;
  const onReq = () => {
    networkSeen = true;
  };
  page.on("request", onReq);

  // Install a one-shot mutation observer
  await page.evaluate(() => {
    (window as unknown as { __mutated?: boolean }).__mutated = false;
    const obs = new MutationObserver(() => {
      (window as unknown as { __mutated?: boolean; __obs?: MutationObserver }).__mutated = true;
    });
    (window as unknown as { __obs?: MutationObserver }).__obs = obs;
    obs.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
  });

  try {
    await locator.click({ trial: false, timeout: 5_000, force: true });
  } finally {
    // give effects a moment, then sample
  }
  await page.waitForTimeout(900);

  const afterURL = page.url();
  const mutated = await page.evaluate(() => Boolean((window as unknown as { __mutated?: boolean }).__mutated));
  page.off("request", onReq);

  // Tear the observer back down for the next test
  await page.evaluate(() => {
    const w = window as unknown as { __obs?: MutationObserver };
    w.__obs?.disconnect();
    w.__obs = undefined;
  });

  if (afterURL === beforeURL && !mutated && !networkSeen) {
    throw new Error(`Button "${label}" appears dead — no navigation, no network, no DOM mutation.`);
  }
}

/** Sign in a seeded user via the dev-only /dev/sign-in helper. */
export async function devSignIn(page: Page, opts: { wallet: string; role: "client" | "lawyer" }) {
  const dest = opts.role === "lawyer" ? "/lawyer/dashboard" : "/client/home";
  const url = `/dev/sign-in?wallet=${encodeURIComponent(opts.wallet)}&role=${opts.role}&redirect=${encodeURIComponent(dest)}`;
  // Retry on ERR_ABORTED — Next.js dev mode sometimes does Fast Refresh full
  // reloads that cancel in-flight navigations.
  let lastErr: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      await page.waitForURL(new RegExp(dest.replaceAll("/", "\\/")), { timeout: 10_000, waitUntil: "domcontentloaded" });
      return;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(800);
    }
  }
  throw lastErr;
}

export const SEEDED = {
  // Client wallets from prisma/seed.ts
  client1: "0x2222000000000000000000000000000000000001", // Sarah Mueller
  client2: "0x2222000000000000000000000000000000000002", // James O'Connor
  client3: "0x2222000000000000000000000000000000000003", // Léa Bernard
  client4: "0x2222000000000000000000000000000000000004", // David Cohen
  // Lawyer wallets — Maria Chen (id 1) is HOURLY/VERIFIED, Stefan Novak (id 12) is PENDING
  lawyerMaria: "0x1111000000000000000000000000000000000001",
  lawyerAnya: "0x1111000000000000000000000000000000000005",
  lawyerStefan: "0x1111000000000000000000000000000000000012",
};
