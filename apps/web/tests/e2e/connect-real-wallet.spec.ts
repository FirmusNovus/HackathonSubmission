import { expect, test, type Page } from "@playwright/test";
import { installAnvilWallet } from "./_anvil-wallet";

// These tests exercise the real SIWE path — wagmi `injected()` connector talks
// to a window.ethereum shim backed by an anvil-derived account, and the actual
// SIWE message is signed and verified by next-auth + siwe.
//
// Anvil must be running on the configured RPC URL (defaults to :8545). The
// flow doesn't read on-chain state, so a fresh-but-running anvil is enough.

async function waitHydrated(page: Page) {
  await page.waitForLoadState("domcontentloaded");
  // wagmi + next-auth poll their respective sessions, so networkidle never
  // resolves. A short settle is enough for React handlers to attach.
  await page.waitForTimeout(800);
}

test.describe("Real SIWE — anvil-injected wallet", () => {
  test("Landing-page Connect wallet runs SIWE; first-time visit lands on /connect", async ({ page }) => {
    const { address } = await installAnvilWallet(page, /* accountIndex */ 1);

    await page.goto("/");
    await waitHydrated(page);

    // The new entry point: a single "Connect wallet" button on the marketing
    // nav. Click triggers wagmi connect → SIWE sign → server-side attestation
    // lookup → redirect. Anvil account 1 has no attestations yet, so the
    // redirect lands on /connect (role-pick onboarding).
    await page.getByTestId("connect-wallet").click();
    await page.waitForURL(/\/connect(\?|$)/, { timeout: 20_000, waitUntil: "domcontentloaded" });

    // Session is established server-side; the connect page is rendered for
    // an unattested user, so it shows the role-pick stage.
    await expect(page.getByRole("heading", { name: /Welcome to Firmus Novus/i })).toBeVisible();

    // Session API confirms the address; role defaults to CLIENT until the
    // bar credential onboarding step writes a SCHEMA_LAWYER attestation.
    const sessionRes = await page.request.get("/api/auth/session");
    const session = (await sessionRes.json()) as { user?: { walletAddress?: string; role?: string } };
    expect(session.user?.walletAddress?.toLowerCase()).toBe(address.toLowerCase());
    expect(session.user?.role).toBe("CLIENT");
  });

  test("First-time visitor can pick role and advance to PID stage on /connect", async ({ page }) => {
    await installAnvilWallet(page, /* accountIndex */ 2);

    await page.goto("/");
    await waitHydrated(page);
    await page.getByTestId("connect-wallet").click();
    await page.waitForURL(/\/connect(\?|$)/, { timeout: 20_000, waitUntil: "domcontentloaded" });

    // Pick lawyer, click Continue → role-pick stage advances directly to PID
    // (the wallet stage was retired; it lives in the WalletButton now).
    await page.getByRole("button", { name: /I'm a lawyer/i }).click();
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await expect(page.getByRole("heading", { name: /Present your PID credential/i })).toBeVisible({ timeout: 5_000 });
  });
});
