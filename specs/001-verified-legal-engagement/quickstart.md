# Quickstart — From Clean Repo to Demo Running

Target: bring up the full stack (issuer + platform + proxy +
local chain + contracts deployed + personas seeded + ngrok tunnel) in
about ten minutes.

## Prerequisites

- Node 20+ and pnpm 9+
- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- An ngrok account (free tier is fine) with auth token configured
  (`ngrok config add-authtoken <token>`)
- A wwWallet instance reachable in a browser
  (https://demo.wwwallet.org)
- macOS or Linux (Windows via WSL2 is fine but untested)

## One-time setup

```bash
# 1. Install dependencies for both apps + packages
pnpm install

# 2. Generate the issuer's two signing keys (idempotent — skips if files exist)
pnpm -F @platform/issuer keys:generate

# 3. Generate the operator's wallet key into .env.local (anvil index 0)
cp .env.example .env.local
# .env.local now has OPERATOR_PRIVATE_KEY pinned to anvil[0]; DO NOT COMMIT
```

## Bring up the local chain + contracts

```bash
# 4. Start Anvil in one terminal — keeps running for the demo's lifetime
anvil --block-time 2

# 5. In another terminal, deploy contracts to the running Anvil
pnpm scripts:deploy:anvil
# Writes apps/platform/lib/chain/addresses.ts with the deployed addresses
# and the EAS schema UIDs.

# 6. Seed the issuer's roster (lawyers + clients) — issuer DB only
pnpm scripts:seed
```

## Bring up the apps

```bash
# 7. Start all three processes in dev mode (concurrently)
pnpm dev
# This launches:
#   apps/issuer    on http://localhost:3001
#   apps/platform  on http://localhost:3010
#   apps/proxy     on http://localhost:3000
# The proxy routes /api/issuer/* -> 3001, everything else -> 3010
```

## Expose the proxy via ngrok

```bash
# 8. In another terminal:
ngrok http 3000

# Note the HTTPS URL ngrok prints — e.g. https://eg-12-34-56-78.ngrok-free.app
# Copy it to .env.local as NGROK_HOSTNAME and PUBLIC_URL.
# Restart pnpm dev so the verifier's x509 cert regenerates with the
# new hostname (validated wwWallet quirk).
```

## Demo it

Open the ngrok URL in a browser. The flow:

1. **Marketing surface**: landing → `/lawyers` directory → click any
   lawyer's profile. The directory will be empty on a fresh deploy
   until at least one lawyer onboards (next step).

2. **Lawyer onboarding** (Anna, anvil index 1):
   1. `/connect?role=lawyer` → connect wallet → SIWE.
   2. Stepper: "Verify identity" → click → wwWallet opens → mint
      PID at the issuer → return to platform → present PID →
      consent dialog asks for ONLY `age_equal_or_over.18` and
      `address.country` → approve.
   3. Stepper: "Verify profession" → mint bar credential at the
      issuer → return → present → approve.
   4. Land at `/verify-lawyer` → fill profile fields (city,
      headline, bio, specialties, languages, jurisdictions, pricing
      kind, pricing headline, hourly rate, 30-min and 60-min
      consultation rates, optionally upload an avatar) → save.
   5. Land at `/lawyer/dashboard` — empty but onboarded.

3. **Client onboarding** (Marta, anvil index 6):
   1. `/connect?role=client` → connect wallet → SIWE.
   2. Stepper: "Verify identity" → mint PID at issuer → return →
      present → approve.
   3. Land at `/client/home` — recommended lawyers (Anna) shown.

4. **Book a consultation**:
   1. From Anna's profile, click "Book a consultation."
   2. Fill the form (date/time, 30 or 60 min, practice area, case
      description ≥ 20 chars). If Anna's `consultation_kind = PAID`
      the form shows the rate; if FREE no escrow funding occurs.
   3. Click "Confirm and fund" → wallet prompts to sign + broadcast
      one transaction (PAID only).
   4. Land in the consultation workspace.

5. **Lawyer accepts**:
   1. Anna sees the request on her dashboard.
   2. Open `/lawyer/requests/[id]` → review (anonymous client
      identifier shown — not Marta's name).
   3. Click Accept.

6. **Consultation happens**:
   1. Both parties open the consultation workspace.
   2. Exchange chat messages — ciphertext flies; the server stores
      opaque bytes only.
   3. Marta clicks "Mark Complete" → wallet signs `releaseProposal`
      → on-chain release fires; transcript root anchored in same
      tx → both panels update; Anna's wallet receives the funds.

7. **Follow-up proposal** (multi-proposal demo):
   1. Anna clicks "Send proposal" inside the workspace.
   2. Adds line items (e.g. "Draft non-compete clause — 3 hours @
      lawyer's hourly rate") and deliverables. Signs the proposal.
   3. Marta sees it; clicks "Accept and fund"; signs the funding
      tx.
   4. Anna marks delivered (optional; starts cooldown clock).
   5. Marta releases.

8. **Dispute path** (asymmetric mechanism demo):
   1. On a different proposal in `Funded` or `Delivered` state,
      Marta clicks "Dispute" → signs → the proposal parks.
   2. Operator (separate browser session as anvil[0]) opens
      `/operator/disputes` → picks the dispute → enters split that
      sums to the parked amount → signs `resolveDispute`.
   3. Funds move per the split; proposal enters terminal `Resolved`.

9. **Lawyer cooldown demo** (uses Anvil time-skip):
   1. Anna marks a `Funded` proposal `Delivered` on chain.
   2. Try `Escalate` immediately → the contract reverts with the
      cooldown's available-at timestamp. UI surfaces it.
   3. From a terminal:
      `cast rpc evm_increaseTime 2592000 && cast rpc evm_mine`.
   4. Try `Escalate` again → succeeds → the proposal enters `Disputed`.

## Dev-bypass mode (for AI iteration / Playwright)

Skip the wwWallet ceremony when iterating locally:

```bash
DEV_BYPASS_EUDI=1 pnpm dev
```

Effects:

- `/connect` becomes a persona picker. Click any persona — server
  seeds rows, writes EAS attestations idempotently via the operator
  key, loads the persona's dev P-256 key into the browser, and
  redirects to the role home.
- `POST /api/dev/login` performs the same seeding programmatically
  for Playwright.
- `POST /api/dev/reset` clears all platform DB rows and reverts the
  Anvil chain to a fresh snapshot.
- `POST /api/dev/skip-time` jumps the chain forward (for the
  cooldown beat in tests).
- A persistent gold "Dev mode" banner appears on every page.
- Refuses to start if `NODE_ENV=production`.

## Tests

```bash
# Solidity invariants (asymmetric mechanism, escrow flow, capability gates)
pnpm -F contracts test

# TypeScript unit tests (crypto, credential parsing, helpers)
pnpm -F @platform/platform vitest

# Playwright E2E (uses dev-bypass; full demo flow)
pnpm -F @platform/platform e2e
```

## Where to look when something goes wrong

- **Wallet won't open the OID4VCI link**: confirm the issuer is
  reachable on the ngrok hostname (try GET on
  `/api/issuer/pid/.well-known/openid-credential-issuer` from a
  different machine). Confirm `Cache-Control: no-store` is in the
  response.
- **OID4VP presentation fails with "missing DCQL"**: the verifier is
  using `presentation_definition` instead of DCQL. Check the
  request-build path uses DCQL (we validated wwWallet requires this).
- **Contract calls revert with unhelpful errors**: run
  `cast call $ESCROW "getEngagement(uint256)" $ID` to read the
  on-chain state directly; compare with the platform's mirror in
  `apps/platform/data/db.sqlite`.
- **The platform's UI shows "secure payment network unavailable"
  when Anvil is running**: the chain-health probe failed. Curl
  `http://localhost:3010/api/chain-health` to see the response.
- **`madge --circular apps/platform/` fails CI**: an import cycle was
  introduced. Run it locally (`pnpm madge --circular apps/platform/`)
  to identify the offending edge. Cycles are forbidden by Inv 7.
