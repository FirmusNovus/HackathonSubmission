import { defineConfig, devices } from "@playwright/test";

// Run E2E tests against a production build (`next start`) on its own port so
// they don't fight with the dev server on :3000. The webServer block makes
// Playwright auto-build/start before tests and tear down after — no JIT
// compile races, no Fast Refresh interruptions.
//
// Set PLAYWRIGHT_TARGET=dev to point the suite at your live `next dev` on
// :3000 instead — useful for catching dev-server stale-bundle regressions
// (e.g. "clientModules" undefined after Fast Refresh). The dev variant skips
// the build webServer and is more flake-prone but reflects what you see in
// the browser.
const TARGET = process.env.PLAYWRIGHT_TARGET === "dev" ? "dev" : "prod";
const TEST_PORT = TARGET === "dev" ? 3000 : 3100;
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${TEST_PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: TARGET === "dev" ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "list" : [["list"]],
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  webServer:
    TARGET === "dev"
      ? undefined
      : {
          command: `npm run build && npm run start -- -p ${TEST_PORT}`,
          env: {
            ENABLE_MOCK_AUTH: "true",
            DEV_AUTO_VERIFY_SECONDS: "0",
            // Override .env's localhost:3000 so Auth.js callbacks loop back to
            // the test server rather than bouncing to a separate dev server.
            NEXTAUTH_URL: BASE_URL,
            AUTH_URL: BASE_URL,
            AUTH_TRUST_HOST: "true",
            // Build into a sibling directory so a concurrent `next dev` on
            // :3000 keeps its own `.next/` and doesn't 404 on its CSS chunks.
            NEXT_DIST_DIR: ".next-test",
          },
          url: BASE_URL,
          timeout: 240_000,
          reuseExistingServer: !process.env.CI,
          stdout: "pipe",
          stderr: "pipe",
        },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
