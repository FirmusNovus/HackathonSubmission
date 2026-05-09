import { expect, test } from "@playwright/test";

async function waitHydrated(page: import("@playwright/test").Page) {
  await page.waitForLoadState("domcontentloaded");
  // useSession polls /api/auth/session, so networkidle never resolves. A short
  // settle is enough — React handlers attach within a few hundred ms in dev.
  await page.waitForTimeout(800);
}

async function pickDemoIdentity(page: import("@playwright/test").Page, value: "sarah" | "maria" | "new") {
  await page.locator(`input[name=demo-identity][value=${value}]`).check({ force: true });
}

test.describe("Onboarding — connect wallet flow (mocked)", () => {
  test("Returning client wallet skips signup steps and lands on /client/home", async ({ page }) => {
    await page.goto("/connect");
    await waitHydrated(page);
    await expect(page.getByRole("heading", { name: /Sign in with your wallet/i })).toBeVisible();

    // Pick the seeded Sarah identity then connect any Ethereum wallet brand.
    await pickDemoIdentity(page, "sarah");
    await page.getByRole("button", { name: /MetaMask/i }).click();

    // Wallet recognized — straight to the SIWE step. No role picker, no EBSI,
    // no age check.
    await expect(page.getByText(/WALLET RECOGNIZED/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("heading", { name: /Welcome back/i })).toBeVisible();
    await expect(page.getByTestId("wallet-connected")).toBeVisible();
    const siweMessage = page.getByTestId("siwe-message");
    await expect(siweMessage).toContainText(/wants you to sign in with your Ethereum account/i);
    await expect(siweMessage).toContainText(/Sign in to Firmus Novus as a client/i);

    // Sign in → /client/home.
    await page.getByRole("button", { name: /Sign in with Ethereum/i }).click();
    await expect(page.getByTestId("siwe-signing")).toBeVisible({ timeout: 5_000 });
    await page.waitForURL(/\/client\/home/, { timeout: 15_000, waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /what do you need help with/i })).toBeVisible({ timeout: 10_000 });
  });

  test("Returning lawyer wallet skips signup steps and lands on /lawyer/dashboard", async ({ page }) => {
    await page.goto("/connect");
    await waitHydrated(page);
    await pickDemoIdentity(page, "maria");
    await page.getByRole("button", { name: /WalletConnect/i }).click();

    await expect(page.getByText(/WALLET RECOGNIZED/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId("siwe-message")).toContainText(/Sign in to Firmus Novus as a lawyer/i);

    await page.getByRole("button", { name: /Sign in with Ethereum/i }).click();
    await page.waitForURL(/\/lawyer\/dashboard/, { timeout: 15_000, waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /Good morning/i })).toBeVisible();
  });

  test("New visitor → client signup: role → EBSI → age → sign → /client/home", async ({ page }) => {
    await page.goto("/connect");
    await waitHydrated(page);

    // Default demo identity is "new" — connect any wallet to spawn a fresh address.
    await pickDemoIdentity(page, "new");
    await page.getByRole("button", { name: /MetaMask/i }).click();

    // Role picker shows up because the wallet has no profile.
    await expect(page.getByRole("heading", { name: /Welcome to Firmus Novus/i })).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/No profile is linked to this wallet yet/i)).toBeVisible();

    await page.getByRole("button", { name: /I need legal help/i }).click();
    await expect(page.getByRole("heading", { name: /Connect your identity wallet/i })).toBeVisible();

    // Single EUDI wallet button — production users would see a real OID4VC
    // handshake; the demo shortcut runs the same simulated flow.
    await page.getByRole("button", { name: /^Connect EUDI wallet$/i }).click();
    await expect(page.getByRole("heading", { name: /Verify you're 18 or older/i })).toBeVisible();

    await page.getByRole("button", { name: /Share Over18 credential/i }).click();
    await expect(page.getByRole("button", { name: /^Continue$/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^Continue$/ }).click();

    // Sign-in step — wallet not yet recognized, so the heading is the new-user one.
    await expect(page.getByRole("heading", { name: /Sign in with Ethereum/i })).toBeVisible();
    await expect(page.getByTestId("siwe-message")).toContainText(/Sign in to Firmus Novus as a client/i);

    await page.getByRole("button", { name: /Sign in with Ethereum/i }).click();
    await page.waitForURL(/\/client\/home/, { timeout: 15_000, waitUntil: "domcontentloaded" });
  });

  test("New visitor → lawyer signup: role → EBSI → sign → /verify-lawyer", async ({ page }) => {
    await page.goto("/connect");
    await waitHydrated(page);
    await pickDemoIdentity(page, "new");
    await page.getByRole("button", { name: /Coinbase Wallet/i }).click();

    await expect(page.getByRole("heading", { name: /Welcome to Firmus Novus/i })).toBeVisible({ timeout: 5_000 });
    await page.getByRole("button", { name: /I'm a lawyer/i }).click();

    // Lawyer flow skips the age check. Use the dev-only demo shortcut to skip
    // the (mocked) OID4VC handshake.
    await expect(page.getByRole("heading", { name: /Connect your identity wallet/i })).toBeVisible();
    await page.getByTestId("ebsi-demo-shortcut").click();

    await expect(page.getByRole("heading", { name: /Sign in with Ethereum/i })).toBeVisible();
    await expect(page.getByTestId("siwe-message")).toContainText(/Sign in to Firmus Novus as a lawyer/i);

    await page.getByRole("button", { name: /Sign in with Ethereum/i }).click();
    // New lawyers land on /verify-lawyer to upload bar credentials.
    await page.waitForURL(/\/verify-lawyer/, { timeout: 15_000, waitUntil: "domcontentloaded" });
  });

  test("Disconnect from sign-in step returns to wallet picker", async ({ page }) => {
    await page.goto("/connect");
    await waitHydrated(page);
    await pickDemoIdentity(page, "sarah");
    await page.getByRole("button", { name: /MetaMask/i }).click();
    await expect(page.getByTestId("wallet-connected")).toBeVisible({ timeout: 5_000 });

    await page.getByRole("button", { name: /^Disconnect$/ }).click();
    await expect(page.getByRole("heading", { name: /Sign in with your wallet/i })).toBeVisible();
    await expect(page.getByRole("button", { name: /MetaMask/i })).toBeVisible();
  });
});
