# Phase 0 Research — Verified Legal Engagement

This document captures the technical decisions that fall *inside* the
user-pinned envelope (Next.js 14, SQLite, shadcn-style primitives,
Solidity, Anvil, ETH-only currency, ngrok hosting, two-process trust
boundary, single-wallet SIWE+VC, asymmetric dispute mechanism). It also
records what was rejected and why, so the plan can be replayed.

No `NEEDS CLARIFICATION` markers remain after the spec's Session
2026-05-08 clarifications.

## Decision 1: Wallet handoff pattern

**Decision**: HTTPS handoff URLs to a web wallet (validated against
`https://demo.wwwallet.org/cb`), using OID4VCI's `credential_offer_uri`
mode and OID4VP's `request_uri` mode. The user-clickable button is an
HTTPS anchor with `target="wwwallet"`; native-scheme `openid4vp://` and
`openid-credential-offer://` URIs are NOT the primary user
affordance.

**Rationale**: wwWallet is a web wallet, not a native app handler.
Validated wwWallet quirks (confirmed by integration testing against
the live wallet):

- `credential_offer_uri` (NOT inline `credential_offer`) is required
  because wwWallet caches inline offers and falls back to the
  auth-code path; the URI form forces a fresh pre-auth flow on every
  click.
- `request_uri` (NOT inline params) is required because wwWallet's
  URL handler triggers only when both `client_id` AND `request_uri`
  are present.
- The signed JWS request object served at `request_uri` carries
  `typ=oauth-authz-req+jwt` and an `x5c` header chain.
- Issuer / verifier metadata responses MUST send
  `Cache-Control: no-store` (wwWallet caches metadata for 30 days
  otherwise).
- The `iss` claim in issued credentials MUST be an HTTPS URL, not a
  `did:key`.
- `client_id` for the verifier uses `x509_san_dns:<hostname>`
  Draft-23 syntax.
- The `vp_token` returned from a presentation is a JSON-stringified
  object whose value can be string OR array — code MUST handle both.

**Alternatives considered**:

- Native `openid4vp://` deep-link only — fails against web wallets;
  rejected.
- QR codes for desktop scan-to-mobile — adds a second device to the
  demo flow; orthogonal to the demo narrative.

## Decision 2: End-to-end-encrypted messaging substrate

**Decision**: WebCrypto in the browser. ECDH P-256 between the two
parties' wallet keys derives a shared secret; HKDF-SHA-256 derives
per-message AES-GCM keys; ECDSA P-256 signs each message envelope.
Ciphertext blobs are stored in SQLite as opaque bytes; the server has
no key path to plaintext. Transport is HTTP POST/GET against the
platform's API for the MVP — XMTP / Waku is documented production
trajectory only.

**Rationale**: WebCrypto is browser-native (no extra deps, audited by
the platform), and Constitution Inv 1 forbids any server-side
decryption capability. Storing ciphertext in the same SQLite file as
everything else is the simplest substrate that keeps the platform's
promise of "subpoena returns ciphertext."

**Alternatives considered**:

- libsodium / `tweetnacl` — adds a JS dep with no win over WebCrypto
  on modern browsers.
- XMTP integration — meaningful production substrate but multi-day
  dev cost; no privilege improvement over the local-stub for the
  demo.
- Storing messages on chain (in calldata) — gas explodes; pointless
  when the server can store ciphertext at zero risk to the privilege
  boundary.

## Decision 3: Per-engagement transcript anchoring

**Decision**: Each message hash (SHA-256 of the signed envelope) is
appended as a leaf in a per-engagement incremental Merkle tree (depth
16 supports 65,536 messages, more than enough). The Merkle root is
committed on chain via `LegalEngagementEscrow.anchorTranscript(...)` at
every funds-touching event (consultation funding, proposal fund / mark
delivered / release / refund / resolve / close). Between events, the
off-chain root is the latest leaf-derived root; on-chain commits make
ranges of history tamper-evident.

**Rationale**: Constitution Inv 5 requires per-engagement
tamper-evidence anchored on chain. Anchoring at every funds-touching
event gives the demo natural beats to show "this is now immutable."
Using SHA-256 instead of Poseidon keeps the off-chain math cheap; we
don't need ZK over the transcript.

**Alternatives considered**:

- Anchor every message — too many transactions, demo-disrupting gas.
- Anchor only at engagement close — leaves long mid-engagement
  windows unanchored; weakens the audit story.
- Use Poseidon for compatibility with the conflict-of-interest
  circuit (production trajectory) — overkill; the transcript and the
  conflict circuit don't share inputs.

## Decision 4: Conflict-of-interest ZK toolchain (production trajectory only)

**Decision**: For the MVP, deploy `StubZKConflictVerifier.sol` that returns
`true` unconditionally. The contract surface (the `IZKConflictVerifier`
interface invoked by `LegalEngagementEscrow.openEngagementAndFundFirstProposal`
and by the consultation-funding path) is preserved so production drops
in the bb-generated verifier without contract redeployment. The Noir
circuit (`circuits/src/main.nr`) is checked into the repo as a future
target but is NOT exercised by MVP tests or the demo.

**Rationale**: spec FR-058 / production-trajectory both flag this as
out-of-scope for the MVP. Keeping the verifier interface in the contract
means production swap is a single-file change at the deployed verifier
address.

**Alternatives considered**:

- Skip the verifier entirely and add it later — would force a
  contract redeployment when production lands.
- Implement the Noir circuit + browser-side proof generation in the MVP
  — multi-week dev cost on a non-narrative beat.

## Decision 5: Smart-contract design

**Decision**:

- `LegalEngagementEscrow.sol` holds consultation + proposal escrow
  state and is the trust anchor for the asymmetric dispute mechanism.
  It reads capability attestations from EAS via a thin
  `AttestationManager.sol` wrapper exposing
  `hasCapability(address, bytes32)`.
- `AttestationManager.sol` registers two EAS schemas
  (`verified_lawyer`, `verified_client`) at deploy time and exposes
  write functions gated by the operator address.
- `IZKConflictVerifier.sol` is the auto-generated Noir verifier
  interface; the MVP ships `StubZKConflictVerifier.sol` returning `true`.
- All cooldown and capability checks are in modifiers on
  `LegalEngagementEscrow` itself — never enforced off-chain
  (Constitution Inv 6).
- Proposal funds denominated in the chain's native asset (ETH on the
  demo chain) per Constitution V. The contract surface is shaped so
  a future ERC-20 variant deploys alongside without changing the API
  visible to clients / lawyers / arbiters (a sibling
  `LegalEngagementEscrowERC20.sol` is the documented production
  trajectory).
- Concurrent state mutations are resolved by the contract's `require`
  checks alone (FR-058 chain-as-arbiter rule). The platform does NOT
  hold server-side locks; the loser's UI surfaces "state changed"
  after observing the on-chain event.

**Rationale**: three small contracts with clear seams. Foundry tests
cover the asymmetric invariants explicitly. EAS gives the on-chain
handshake (Constitution Inv 2) and is already deployed on Base Sepolia,
removing one chunk of deployment work for testnet path.

**Alternatives considered**:

- Single monolithic contract — harder to test, harder to upgrade
  just one piece.
- Diamond / proxy pattern — overkill for a hackathon.
- ERC-20 stablecoin from day one — adds approve flow + token contract
  for zero MVP value (and conflicts with the ETH-only convention).

## Decision 6: Contract version pins

**Decision**: Solidity 0.8.28, OpenZeppelin Contracts v5.2.0
specifically.

**Rationale**: prior spike work pins OZ v5.2.0; later patch versions
have changed access-control surfaces. Solidity 0.8.28 is the latest
stable at planning time and includes the fixes we need around custom
errors.

## Decision 7: Local chain + testnet path

**Decision**:

- Local development: Anvil with the default 10 funded accounts.
  `evm_increaseTime` available for the cooldown demo beat.
- Testnet path: Base Sepolia. EAS is canonically deployed; gas is
  trivial; chain is fast.
- Deployment is a `forge script Deploy.s.sol --rpc-url $RPC --broadcast`
  away from working on either. The only application-side change is
  `NEXT_PUBLIC_RPC_URL` and the deployed-contract address constants.
- Chain availability is checked via a lightweight `eth_blockNumber`
  RPC probe at `/api/chain-health`; the platform UI disables
  funds-touching actions when the probe fails (FR-060). The probe's
  result is cached for 5 seconds to avoid hammering the RPC.

**Rationale**: Anvil is what the user named explicitly. Base Sepolia
is the cheapest L2 testnet with EAS already deployed; using it as the
production-trajectory target avoids reinventing schema deployment.

**Alternatives considered**:

- Sepolia (L1) — gas higher, slower, no native L2 story.
- Optimism Sepolia — EAS deployed, equivalent to Base. Either works;
  pick Base because the wider EUDI/EAS demos in 2026 trend Base-first.
- Hardhat instead of Anvil — slower; the user pinned Anvil.

## Decision 8: Auth, persona staging, and the operator role

**Decision**:

- SIWE (EIP-4361) for app auth. After credential presentation, the
  SIWE-bound address is the user's identity; the credential never
  re-presents.
- Six anvil accounts get *issuer-side knowledge* registered at boot
  via `apps/issuer/scripts/seed.ts`: indices 1–5 = lawyers (with
  both PID and bar entries), index 6 = client (PID only). Each seed
  writes only into the issuer's data dir; the platform's DB stays
  empty. Personas must complete the real OID4VP onboarding flow on
  stage to land on the platform's verified-user surface and on
  chain.
- Index 0 = platform operator (and MVP arbiter). The operator's
  private key loads from `.env.local` (never committed). The
  operator can revoke any capability. The operator MUST NOT be able
  to grant `verified_lawyer` or `verified_client` directly; those
  originate only from completed credential presentations (spec
  FR-006 + Constitution III).

**Rationale**: SIWE is the named auth standard. Pre-staging is the
simplest path to a demo where personas have credentials before the
stage starts.

**Alternatives considered**:

- WalletConnect modal for arbitrary wallets — fine for production,
  friction for a demo.
- OAuth proxy — sidesteps SIWE, breaks Standards-Compliance.

## Decision 9: Dev-bypass mode

**Decision**: An environment variable `DEV_BYPASS_EUDI=1` activates a
bypass at the platform process. When active:

1. Platform refuses to boot if `NODE_ENV='production'` (FR-D01
   parity).
2. `/connect` renders a persona picker instead of the role chooser.
3. Picking a persona idempotently:
   - Inserts the relevant `verified_users` row(s) for that persona.
   - Calls `AttestationManager.attestVerifiedClient(...)` and
     (for lawyers) `attestVerifiedLawyer(...)` from the operator key
     — only if the on-chain attestation isn't already present.
   - For lawyer personas without a `lawyer_profiles` row, inserts a
     fixture profile.
   - Loads the persona's per-engagement P-256 private key from
     `apps/platform/lib/dev/persona-fixtures.ts` into a dev-only
     browser store so client-side ECDH and message decryption work.
   - Sets the platform session cookie.
   - Redirects to the role-appropriate home.
4. Posts to `POST /api/dev/login` perform the same flow programmatically
   for Playwright.
5. A persistent gold "Dev mode" banner surfaces on every page so the
   user can never confuse a bypass session with a production one.
6. The persona-fixtures file is forbidden from being imported anywhere
   under `apps/platform/lib/` outside `lib/dev/` (verified by
   `scripts/check-feature-isolation.sh`).
7. The dev-only message private keys live ONLY in the persona fixture
   file and the dev-only browser store; they MUST NOT be readable by
   any production code path.

**Rationale**: spec FR-056 makes the dev bypass a P2 user story
because Playwright suites and AI iteration loops depend on it.
Constitution I (Privilege as Cryptography) is preserved because the
fixture's per-persona P-256 private key is loaded into the BROWSER,
not the server — it's the platform's normal pattern (the key lives
client-side), just with a dev-only seeding path.

**Alternatives considered**:

- Mock the wallet round-trip end-to-end (no real chain writes) —
  diverges too far from production behavior; tests would pass on
  paths that wouldn't work against a real chain.
- Skip dev bypass entirely; require wwWallet for every test —
  Playwright cannot drive wwWallet headlessly; tests would have to
  be manual.

## Decision 10: Demo time-skip mechanism

**Decision**: For the lawyer-cooldown beat, the demo issues `cast rpc
evm_increaseTime <secs> && cast rpc evm_mine` against the running
Anvil to skip past 30 days. The platform UI reads `block.timestamp`
via viem and the chain-health probe; the workspace's countdown updates
automatically as the indexer observes the time-jump.

**Rationale**: spec assumption explicitly allows a time-skip
mechanism. Anvil exposes the standard Hardhat-compatible
`evm_increaseTime`; viem polls `eth_blockNumber` so the UI updates
without manual refresh. The cooldown duration in the contract stays
the real 30 days — the demo skips the chain forward, the demo does
not shorten the cooldown.

**Alternatives considered**:

- Make the cooldown configurable to a few seconds for the demo —
  rejected because the asymmetric mechanism's *meaning* changes on
  stage; honest framing prefers visible time-skip over "the cooldown
  is 5 seconds for the demo."

## Decision 11: Ngrok hosting

**Decision**: Free-tier ngrok with a single hostname. The
`apps/proxy` reverse proxy splits the path namespace: `/api/issuer/*`
and `/issuer/*` reach the issuer app on port 3001; everything else
reaches the platform app on port 3010. wwWallet sees a single origin.
The platform's `client_id` for OID4VP uses the ngrok hostname via
`x509_san_dns:<hostname>` Draft-23 syntax; the X.509 cert is generated
at boot with the ngrok hostname as the CN.

**Rationale**: free-tier ngrok doesn't ship subdomains, so
single-hostname + path routing is the only way to keep the issuer and
the platform reachable to the same wallet. The X.509 cert generation
on boot is the validated wwWallet pattern.

**Alternatives considered**:

- Paid ngrok with subdomains for issuer / platform / proxy — adds
  cost and operational complexity for a demo.
- Self-hosted reverse tunnel (e.g. cloudflared) — equivalent shape,
  more setup overhead.
- Localhost with browser-based wwWallet bypass — wwWallet requires
  HTTPS for OID4VP; localhost won't work.

## Decision 12: Avatar transcoding

**Decision**: Server-side transcoding via `sharp` to two stored WebP
variants (480 px and 192 px square, center-cropped, quality 85) on
upload. Filenames carry a 12-character content hash for cache-busting.
Stored under `apps/platform/data/uploads/avatars/<userId>/`. Public-
readable on `GET /uploads/avatars/<userId>/<filename>` (no auth check
— avatars are part of the public profile).

**Rationale**: `sharp` is the production-grade Node image library;
its npm install footprint is acceptable. Two variants cover all five
displayed sizes (32 / 56 / 64 / 80 / 96 px) without per-size files.
Public-readable matches the avatar's role as a public-profile asset;
contrast with credential documents (which the merge already removed
in favor of OID4VP).

**Alternatives considered**:

- Client-side resizing — trusts the browser and adds attack surface
  (malformed images uploaded as legitimate JPGs).
- Single-variant storage (just 480 px) — the 64 px `LawyerCard` would
  pay download+resize cost per card; bad for the directory page's
  perf budget.
- Per-displayed-size variants (32 / 56 / 64 / 80 / 96 px each) —
  storage and transcode time inflate; visual gain marginal.

## Decision 13: Explicitly out of scope (slide-only)

The spec's Out-of-Scope section enumerates these; they are repeated
here so Phase 1 design doesn't accidentally pull them back in:

- Trusted issuer registry runtime lookup at attestation time —
  operator review at attestation time satisfies the equivalent gate
  for the demo.
- Conflict-of-interest non-membership proof at first proposal funding
  — `StubZKConflictVerifier.sol` returns `true`; lawyer-side
  conflict-set commitment UI not built.
- Identity unsealing — explicitly NOT IMPLEMENTED; production
  trajectory only.
- Separated arbiter pool — operator-as-arbiter is the MVP arrangement.
- Real-time video transport — placeholder canvas in the MVP.
- Object-storage-backed file storage — local disk in the MVP.
- Decentralized message transport (XMTP / Waku) — HTTP POST/GET in
  the MVP.
- Forward secrecy via Double Ratchet on messaging — not required by
  Constitution I.
- ERC-20 stablecoin escrow variant — ETH-only in the MVP.
- Public reviews / ratings on lawyer profiles — placeholder Reviews
  tab.
- Operator capability administration UI — capability revocation via
  direct contract calls.
- Account deletion / GDPR right-to-erasure — Session 2026-05-08
  clarification: explicitly out of scope; production trajectory
  documents the on-chain immutability carve-out.

All of the above are documented in spec Out-of-Scope. None require
implementation in the MVP.

## Decision 14: CI gates for Constitution Invariants

**Decision**: Two static-analysis gates run in CI on every push to
`main`:

1. `madge --circular apps/platform/` — fails the build on any import
   cycle (Constitution Inv 7).
2. `scripts/check-feature-isolation.sh` — greps for cross-feature
   imports between sibling modules under
   `apps/platform/app/{client,lawyer,operator}/(*)/` and
   `apps/platform/components/firmus/(*)/`. Cross-feature imports
   between two siblings are forbidden; shared logic must move to
   `lib/` or `packages/`.

A third gate verifies brand-mention discipline:

3. `scripts/check-brand-mentions.sh` — confirms exactly one mention
   of the public brand name in the spec and plan title lines, zero
   mentions in the body of any spec file, and zero mentions in the
   repo of the alternative names from prior drafts that the
   canonical glossary retires. The gate's detection allow-list lives
   in the script source so this document does not need to recite the
   retired terms.

**Rationale**: invariants documented but not enforced atrophy.
Putting them in CI makes drift visible immediately rather than at
review time.

**Alternatives considered**:

- Pre-commit hooks only — bypassed by `--no-verify`; less reliable
  than CI.
- Manual reviewer checklist — reviewers miss things; gates that
  return red CI are unmissable.

## Summary of resolved unknowns

| Unknown | Resolution |
|---|---|
| Wallet handoff mechanism for wwWallet | HTTPS handoff URLs with `target="wwwallet"`; `credential_offer_uri` + `request_uri` modes |
| ECDH curve + cipher choice | P-256 / AES-GCM-256 / HKDF-SHA-256 / ECDSA P-256 (WebCrypto-native) |
| Transcript-anchor cadence | At every funds-touching event (consultation fund / proposal fund / deliver / release / refund / resolve / close) |
| Smart-contract topology | Three contracts (escrow + attestation manager + stub conflict verifier); modular, swap-friendly seams |
| Contract version pins | Solidity 0.8.28; OpenZeppelin Contracts v5.2.0 |
| Chain choice for testnet | Base Sepolia (EAS pre-deployed) |
| Chain availability detection | `eth_blockNumber` probe at `/api/chain-health` with 5-second cache (FR-060) |
| Operator key handling | `.env.local` only; never committed; operator MUST NOT directly grant client/lawyer attestations |
| Dev-bypass scope | Bypass writes EAS attestations via operator key; loads dev P-256 keys into the BROWSER only; refuses to boot in production |
| Time-skip mechanism | `cast rpc evm_increaseTime` on Anvil; cooldown duration in contract stays at real 30 days |
| Ngrok routing | Free-tier single hostname; path-routed proxy splits to issuer / platform |
| Avatar transcoding | `sharp` to two WebP variants on upload; content-hash filenames; public-readable serve route |
| CI invariant gates | `madge --circular`, feature-isolation grep script, brand-mention discipline script |

No `NEEDS CLARIFICATION` markers remain.
