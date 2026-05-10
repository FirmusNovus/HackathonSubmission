import { expect, test } from "@playwright/test";

async function waitHydrated(page: import("@playwright/test").Page) {
  await page.waitForLoadState("domcontentloaded");
  // useSession polls /api/auth/session, so networkidle never resolves. A short
  // settle is enough — React handlers attach within a few hundred ms in dev.
  await page.waitForTimeout(800);
}

test.describe("Onboarding — connect wallet flow (mocked)", () => {
  // TODO(phase-2): entire connect flow gets rewritten with combined connect+SIWE
  // (single click). The current Role→EBSI→Age→TX wizard goes away.
  test.skip("Client flow: Role → EBSI → Age → TX → /client/home", async ({ page }) => {
    await page.goto("/connect");
    await waitHydrated(page);
    await expect(page.getByRole("heading", { name: /Welcome to Firmus Novus/i })).toBeVisible();

    // Both role cards clickable
    const clientCard = page.getByRole("button", { name: /I need legal help/i });
    const lawyerCard = page.getByRole("button", { name: /I'm a lawyer/i });
    await expect(clientCard).toBeVisible();
    await expect(lawyerCard).toBeVisible();
    await lawyerCard.click();
    await clientCard.click();

    await page.getByRole("button", { name: /^Continue$/ }).click();
    await expect(page.getByRole("heading", { name: /Connect your identity wallet/i })).toBeVisible();

    // Each EBSI wallet option clickable
    for (const name of ["DS Wallet", "eKibisis", "eDiplomas Wallet", "SSI Auth Wallet", "PwC-ID Holder", "IDENTFY", "PrimusMoney"]) {
      await page.getByRole("button", { name: new RegExp(name, "i") }).first().click();
    }

    await page
      .getByRole("button", { name: /Connect (DS Wallet|eKibisis|eDiplomas|SSI Auth|PwC-ID|IDENTFY|PrimusMoney)/i })
      .click();
    await expect(page.getByRole("heading", { name: /Verify you're 18 or older/i })).toBeVisible();

    // Back to EBSI
    await page.getByRole("button", { name: /^Back$/ }).click();
    await expect(page.getByRole("heading", { name: /Connect your identity wallet/i })).toBeVisible();

    // Forward, Share Over18 → Continue → TX stage
    await page
      .getByRole("button", { name: /Connect (DS Wallet|eKibisis|eDiplomas|SSI Auth|PwC-ID|IDENTFY|PrimusMoney)/i })
      .click();
    await page.getByRole("button", { name: /Share Over18 credential/i }).click();
    await expect(page.getByRole("button", { name: /^Continue$/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await expect(page.getByRole("heading", { name: /Connect your transaction wallet/i })).toBeVisible();

    // Pick MetaMask → "connecting" handshake → wallet shows as connected,
    // *not* yet signed in. The SIWE message preview is rendered. The user
    // must click "Sign in with Ethereum" to bind the wallet to a session.
    await page.getByRole("button", { name: /MetaMask/i }).click();
    await expect(page.getByTestId("wallet-connected")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/Not yet signed in/i)).toBeVisible();
    await expect(page.getByRole("heading", { name: /Sign in with Ethereum/i })).toBeVisible();
    const siweMessage = page.getByTestId("siwe-message");
    await expect(siweMessage).toContainText(/wants you to sign in with your Ethereum account/i);
    await expect(siweMessage).toContainText(/Sign in to Firmus Novus as a client/i);
    await expect(siweMessage).toContainText(/Nonce:/);

    // Disconnect rolls back to wallet-brand picker.
    await page.getByRole("button", { name: /^Disconnect$/ }).click();
    await expect(page.getByRole("button", { name: /MetaMask/i })).toBeVisible();

    // Reconnect and sign in — only now do we land on /client/home.
    await page.getByRole("button", { name: /MetaMask/i }).click();
    await expect(page.getByTestId("wallet-connected")).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /Sign in with Ethereum/i }).click();
    await expect(page.getByTestId("siwe-signing")).toBeVisible({ timeout: 5_000 });
    await page.waitForURL(/\/client\/home/, { timeout: 15_000, waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /what do you need help with/i })).toBeVisible({ timeout: 10_000 });
  });

  // TODO(phase-2): same — wizard rewrite. Lawyer credential presentation will
  // be a real OID4VP roundtrip (phase 4) atop the new connect+SIWE step.
  test.skip("Lawyer flow skips age step and lands on /lawyer/dashboard", async ({ page }) => {
    await page.goto("/connect");
    await waitHydrated(page);
    await page.getByRole("button", { name: /I'm a lawyer/i }).click();
    await page.getByRole("button", { name: /^Continue$/ }).click();
    await expect(page.getByText(/STEP 1 OF 2/i)).toBeVisible();
    await page.getByRole("button", { name: /DS Wallet/i }).first().click();
    await page.getByRole("button", { name: /Connect DS Wallet/i }).click();
    await expect(page.getByRole("heading", { name: /Connect your transaction wallet/i })).toBeVisible();

    // Connect → SIWE preview shows the lawyer-flavoured message → sign in.
    await page.getByRole("button", { name: /WalletConnect/i }).click();
    await expect(page.getByTestId("wallet-connected")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("siwe-message")).toContainText(/Sign in to Firmus Novus as a lawyer/i);
    await page.getByRole("button", { name: /Sign in with Ethereum/i }).click();
    await page.waitForURL(/\/lawyer\/dashboard/, { timeout: 15_000, waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Good morning/i })).toBeVisible();
  });
});
