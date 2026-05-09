# Quickstart — Bring up the demo in 10 minutes

This is the path from a clean clone to a running demo with all five user stories exercisable. Tasks themselves come from `/speckit.tasks`; this is the runtime bring-up.

## Prerequisites

- Node 20+, pnpm or npm
- Foundry (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- Noir 1.0.0-beta.20+ via `noirup` and barretenberg `bb` (`curl -L https://raw.githubusercontent.com/AztecProtocol/aztec-packages/master/barretenberg/bbup/install | bash && bbup`)
- ngrok (free tier is fine) — needed because wwWallet requires HTTPS for issuer + verifier metadata
- An account on a hosted wwWallet instance reachable from your browser

## 1. Install (1 min)

```bash
pnpm install
cd contracts && forge install && cd ..
cd circuits && nargo --version && cd ..   # confirms the toolchain is present
```

## 2. Compile contracts and circuit (1 min)

```bash
cd contracts && forge build && cd ..
cd circuits && nargo compile && bb write_vk -b ./target/main.json -o ./target/vk \
  && bb contract -k ./target/vk -o ../contracts/src/ZKConflictVerifier.sol \
  && cd ..
cd contracts && forge build && cd ..       # rebuild including the generated verifier
```

## 3. Start the local chain (1 min)

```bash
anvil --block-time 2 --accounts 10 --balance 100
```

Leave running. Default 10 accounts, each with 100 ETH.

## 4. Deploy contracts and stage personas (2 min)

In a second terminal:

```bash
# .env should contain OPERATOR_PRIVATE_KEY (anvil account 0) and the RPC URL.
# pnpm scripts auto-load it via dotenv-cli; no need to source manually.
cp .env.example .env
# edit .env if needed; defaults match anvil

pnpm scripts:deploy   # runs forge script Deploy.s.sol against anvil; writes apps/platform/lib/chain/deployed-addresses.json
pnpm scripts:seed     # bar-issuer + pid-issuer seeds: subjects table, signing JWK, card art SVGs — into each issuer's own data dir
```

After step 4 the platform is **empty**: zero `verified_users` rows, zero on-chain attestations. The seeds only register what each issuer institution knows about its subjects; they do NOT pre-attest anyone, and they only write into `apps/{bar,pid}-issuer/data/` (the platform DB stays untouched). Each persona must complete the real onboarding flow during the demo.

Persona table — this is the *target* state after each persona has onboarded on stage. Capabilities listed are what they will hold after their onboarding step. ETH addresses are derived from anvil's deterministic mnemonic.

| Anvil # | Address (truncated) | Persona | Capability after onboarding | Onboarding step |
|---|---|---|---|---|
| 0 | 0xf39…2266 | Platform operator | operator (constitutional) | none — operator is the wallet that runs the deploy script |
| 1 | 0x7099…79c8 | Anna Schmidt — German employment lawyer | verified_lawyer | OID4VP bar presentation in Story 2 |
| 2 | 0x3C44…293bc | Carlos García — Spanish corporate lawyer | verified_lawyer | OID4VP bar presentation in Story 2 |
| 3 | 0x90F7…b906 | Dieter Müller — German GDPR specialist | verified_lawyer | OID4VP bar presentation in Story 2 |
| 4 | 0x15d3…fa65 | Sofia Rossi — Italian immigration lawyer | verified_lawyer | OID4VP bar presentation in Story 2 |
| 5 | 0x9965…fc1c | Eva Novák — Czech commercial lawyer | verified_lawyer + verified_arbiter | OID4VP bar presentation, then operator promotes via `/operator/capabilities` |
| 6 | 0x976E…ff2dc | Marta Sánchez — Spanish founder | verified_client | OID4VP PID presentation in Story 1 |
| 7-9 | … | reserved for second client / multi-engagement scenarios | — | — |

## 5. Expose the stack over HTTPS (1 min)

In a third terminal:

```bash
ngrok http 3000
```

Port 3000 is the path-routed reverse proxy (`apps/proxy`). It fronts the bar-issuer (3001), pid-issuer (3002), and platform (3010) so the wallet sees one origin. Copy the `https://*.ngrok-free.app` URL into `.env` as `PUBLIC_HOSTNAME=...`. This becomes both `iss` for credential issuance and the SAN for the `x509_san_dns:<hostname>` verifier `client_id`.

## 6. Run all four services (1 min)

```bash
pnpm dev
```

Starts the proxy, platform, bar-issuer, and pid-issuer concurrently with prefixed log output. Open `https://<your-ngrok>.ngrok-free.app/` in the browser that has wwWallet open in another tab.

## 7. Walk the five user stories (3 min)

### Story 2 (lawyer onboarding) — first because it gates Story 1

1. Open `/onboarding/lawyer` as Anna (anvil account #1 connected via wagmi).
2. Click "Get bar credential" — wwWallet receives an `openid-credential-offer://` deep link, completes pre-auth + DPoP token + credential issuance.
3. Click "Present credential to platform" — wwWallet receives an `openid4vp://` deep link, returns the SD-JWT VC.
4. The verifier checks the holder binding, issues an `verified_lawyer` EAS attestation, and Anna appears in the directory at `/`.

Repeat for accounts #2–5. Eva (account #5) additionally gets `verified_arbiter` granted via the operator page (`/operator/capabilities`).

### Story 1 (client engagement happy path)

1. Open `/onboarding/client` as Marta (account #6).
2. Get PID via wwWallet, present it; receive `verified_client` attestation.
3. Land on `/`, post a matter (no amount field).
4. Pick Anna → send engagement request. Note: no amount.
5. Switch to Anna's wallet → see request in `/lawyer/inbox` → propose a first-milestone amount (e.g. 0.5 ETH) with a one-line scoping note.
6. Switch back to Marta → see Anna's signed proposal → fund 0.5 ETH. The browser generates the conflict-of-interest non-membership proof; the funding tx bundles it.
7. Both parties enter the messaging UI on `/engagements/:id`. Send a few messages each side.
8. Anna marks the milestone delivered.
9. Marta releases. Funds move to Anna in a single tx.

### Story 3 — beat 1 (client-immediate dispute)

10. From the active engagement, propose a second milestone via the messaging UI. Marta funds it.
11. Anna marks delivered.
12. Marta clicks "Dispute" — milestone enters Disputed state immediately.
13. Switch to Eva (account #5, holding `verified_arbiter`). On `/arbiter/disputes/queue` she sees the new dispute, claims it, then issues a 0.6/0.4 split.

### Story 3 — beat 2 (lawyer escalation after cooldown)

14. Open another matter / fund another milestone. Anna marks delivered.
15. Confirm Anna's "Escalate" button is disabled with the live countdown.
16. From the terminal: `cast rpc evm_increaseTime 2592000 && cast rpc evm_mine` (skip 30 days + 1 block).
17. Anna's UI updates to show "Escalation now available." She escalates → Disputed.
18. Eva claims and resolves with a different split.

### Story 5 (operator capability admin)

19. Open `/operator/capabilities` as the operator wallet (account #0). Note the table showing all attested wallets.
20. Revoke one of the lawyers' `verified_lawyer` capability. Confirm the directory at `/` no longer shows them and a fresh engagement attempt against them is rejected.
21. Note that there is no button to grant `verified_lawyer` directly — the only grant action is "Promote to arbiter" (which requires the subject to already hold `verified_lawyer`).

## 8. Reset between runs

```bash
pnpm scripts:reset       # wipes all three data/ dirs + deployed-addresses.json, redeploys against anvil, reruns both issuer seeds
```

You're back to step 7 in ~30 seconds.

## Testnet path (Base Sepolia)

When ready to deploy to a public testnet:

1. Get Base Sepolia ETH from a faucet for the operator address.
2. `forge script script/Deploy.s.sol --rpc-url $BASE_SEPOLIA_RPC --broadcast --account operator` — uses the canonical EAS deployment instead of deploying a local copy.
3. Update `.env.production` with the Base Sepolia RPC + deployed addresses.
4. `pnpm build && pnpm start` (or deploy the Next.js app to Vercel; the issuer + verifier endpoints stay on the same instance).
5. `ngrok` is no longer needed — the Vercel domain is the public hostname.

The wallet integration code paths are unchanged. The five stories work identically.

## Troubleshooting

- **"MISSING_DCQL_QUERY"** in wwWallet: you accidentally sent `presentation_definition`. The verifier MUST send DCQL only.
- **Stale credential card art**: wwWallet caches issuer metadata for 30 days unless `Cache-Control: no-store` is set. If your card looks blank, purge the wallet's IndexedDB and re-fetch.
- **"Holder binding failed"**: the KB-JWT's `aud` doesn't match the verifier's `client_id`. Confirm `PUBLIC_HOSTNAME` matches both your ngrok URL and the SAN in the verifier's self-signed cert.
- **`escalateMilestone` reverts after time-skip**: check that `cast rpc evm_mine` ran after `evm_increaseTime` — viem reads `block.timestamp`, which only updates when a new block is mined.
- **Conflict proof rejected**: confirm the lawyer published a non-trivial `lawyerConflictRoot` (the Phase-2 seed step does this; if you skipped it, run `pnpm scripts:seed-conflict-roots`).
