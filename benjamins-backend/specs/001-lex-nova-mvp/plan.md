# Implementation Plan: Lex Nova MVP — Verified-Pseudonymous Legal Engagement

**Branch**: `001-lex-nova-mvp` (working on `main`; branch creation hook unavailable in this environment) | **Date**: 2026-05-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/001-lex-nova-mvp/spec.md`

## Summary

Build the Lex Nova MVP end-to-end as a single Next.js 14 application bound to a local Anvil chain, validated against the wallet-integration spike at [docs/spike/wallet-integration/](../../docs/spike/wallet-integration/). The app collapses three conceptually distinct entities (bar credential issuer, EU resident credential issuer, platform operator) into one process for hackathon convenience while keeping their cryptographic separation intact. Off-chain state (matters, engagement records, encrypted message blobs, transcript tree state) lives in SQLite via better-sqlite3. Smart contracts (Solidity 0.8.28, Foundry, EAS-anchored attestations) encode the asymmetric dispute mechanism and milestone escrow. The UI uses shadcn/ui (Radix + Tailwind) on Next.js App Router; wallet/contract interaction via wagmi + viem; client-side cryptography via WebCrypto (ECDH P-256, AES-GCM, ECDSA). A Noir + UltraHonk circuit handles the conflict-of-interest non-membership proof. Testnet deployment path targets Base Sepolia (EAS deployed; gas trivial) without code changes — the only swap is the contract addresses and the issuer's HTTPS hostname.

The five P1/P2/P3 user stories from the spec map cleanly onto five technical surfaces: (1) capability-attestation contract + OID4VP onboarding routes, (2) milestone escrow contract + engagement-handshake state machine, (3) asymmetric dispute mechanism + first-claim arbiter UX, (4) Noir circuit + lawyer-published commitment, (5) operator capability admin page.

## Technical Context

**Language/Version**:
- TypeScript 5.x (Next.js 14, App Router) for the application
- Solidity 0.8.28 for smart contracts (Foundry)
- Noir 1.0.0-beta.20+ for the conflict-of-interest circuit (UltraHonk backend)

**Primary Dependencies**:
- `next@14.x` (App Router, server actions, route handlers)
- `react@18.x`, `tailwindcss@3.x`, `shadcn/ui` (Radix primitives + Tailwind, copy-in components)
- `wagmi@2.x` + `viem@2.x` for wallet + chain interaction
- `siwe@2.x` for Sign-In-With-Ethereum auth
- `better-sqlite3` for synchronous SQLite access from Next.js route handlers
- `jose` for SD-JWT VC parsing and JWS signing
- `@noir-lang/noir_js` + `@aztec/bb.js` (UltraHonk) for ZK prove/verify
- `@ethereum-attestation-service/eas-sdk` for EAS schema + attestation tooling
- Foundry (forge, anvil, cast) for contract dev/test/local-chain
- OpenZeppelin Contracts v5.2.0 (constitution-mandated specific version)

**Storage**:
- SQLite (one file per service: `apps/platform/data/lexnova.db`, `apps/bar-issuer/data/db.sqlite`, `apps/pid-issuer/data/db.sqlite`) via better-sqlite3 — synchronous, single-process per file, perfect for hackathon scope. Constitution Inv-4 makes the partition load-bearing: no service can read another's DB.
- On-chain state for: capability attestations, engagement records, milestone state, transcript-root commitments, conflict-of-interest commitment refs

**Testing**:
- `forge test` for Solidity (asymmetric-mechanism invariants, escrow flow, capability checks)
- `vitest` + `@vitest/web-worker` for TypeScript unit tests of the crypto/credential code paths
- The spike at [docs/spike/wallet-integration/](../../docs/spike/wallet-integration/) acts as the integration-test substrate for the OID4VCI/OID4VP wire shapes — its `self-test.mjs` continues to validate end-to-end issuance + presentation against a real wwWallet

**Target Platform**:
- Local: Linux/macOS dev machine running Node 20+, Foundry, and a wwWallet instance reachable over `https://` (via ngrok in dev)
- Testnet: Base Sepolia for the contract layer; Vercel or similar for the Next.js app; the issuer/verifier endpoints stay on the same Next.js instance

**Project Type**: Web application (single Next.js process serving issuer, verifier, platform UI, and platform API; one Solidity package; one Noir package). Not a polyrepo split.

**Performance Goals** (per spec SCs):
- Onboarding (lawyer or client): < 3 minutes wall-clock from connect to attestation visible
- Client landing → funded first milestone: < 5 minutes (excluding lawyer response wall-clock)
- Conflict-of-interest check: < 5 seconds added to engagement-creation flow
- Page render: standard Next.js targets (TTFB < 500ms on dev hardware); no specific p95 SLO at hackathon scope

**Constraints**:
- Privilege boundary: no key material on the server capable of decrypting messages, unsealing PID, or forging capability attestations (Constitution principle I, invariants 1 + 4)
- Single shared Next.js process, but bar issuer (`did:key` A), PID issuer (`did:key` B), and platform operator (Ethereum address) MUST stay conceptually distinct in code paths and key storage (invariant 4)
- Demo runs on a single Anvil instance with `evm_increaseTime` available for the cooldown beat
- wwWallet metadata caching: every issuer/verifier metadata response MUST send `Cache-Control: no-store` (validated wwWallet quirk)

**Scale/Scope**:
- 6 personas registered with the issuer-side stand-ins: 5 lawyers in the bar-issuer's roster (anvil indices 1–5) and 6 natural persons in the pid-issuer's roster (the same 5 lawyers plus 1 client at index 6). Each issuer's seed is independent — `pnpm -F @lex-nova/bar-issuer seed` and `pnpm -F @lex-nova/pid-issuer seed`, both run by `pnpm scripts:seed`. The platform itself starts empty: each persona must onboard via the real OID4VP flow to land in the platform's verified-user surface and on chain. Eva's `verified_arbiter` capability is granted by the operator on stage during the demo, after she has completed lawyer onboarding. Anvil ships 10 default accounts so capacity is not a concern.
- ≤ 100 matters, ≤ 200 milestones, ≤ 5000 messages across the demo lifetime — well below SQLite's comfort range
- Conflict-of-interest commitment: N=8 client-set entries per lawyer (Pedersen-hashed, kept enumerable for the demo per spec assumption)

## Constitution Check

*Gate: must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle / Invariant | Status | Evidence |
|---|---|---|
| I. Privilege as Cryptography (NON-NEGOTIABLE) | PASS | All decryption keys derive from wallet ECDH in the browser via `lib/crypto/`; server has no decryption path. SQLite stores ciphertext blobs only. See [research.md](research.md#decision-2-end-to-end-encrypted-messaging-substrate) and [contracts/messaging-shape.md](contracts/messaging-shape.md). |
| II. Pseudonymous by Default | PASS | Only the disclosed attribute set is persisted (`given_name`, `family_name`, `nationalities`, `age_equal_or_over.18`, `address.country` for clients; practising attributes for lawyers). Schema enforces this — see [data-model.md](data-model.md). Identity unsealing not implemented (matches assumption in spec.md). |
| III. Asymmetric Mechanisms for Asymmetric Stakes | PASS | All asymmetry encoded in `LegalEngagementEscrow.sol` modifiers: `clientDispute()` is unconditional; `lawyerEscalate()` has `require(block.timestamp >= delivery + 30 days)`. See [contracts/solidity-surface.md](contracts/solidity-surface.md). |
| IV. Standards-Compliance Over Novelty | PASS | OID4VCI (issuance), OID4VP + DCQL (presentation, x509_san_dns Draft-23), SD-JWT VC (`vc+sd-jwt`), SIWE (auth), EAS (attestations), WebCrypto (ECDH P-256 / AES-GCM / ECDSA), Noir + UltraHonk (ZK). No novel cryptography. wwWallet quirks documented as adaptations. See [research.md](research.md#decision-1-wallet-integration-protocols). |
| V. Spike-Validated Before Specced | PASS | OID4VCI/OID4VP code paths derive from [docs/spike/wallet-integration/](../../docs/spike/wallet-integration/) which validates them against real wwWallet. Diagnostic logs in spike retained (per memory:`feedback_keep_debug_logs.md`). |
| VI. Honest Framing of Demo vs. Production | PASS | The plan keeps slide-only items as slide-only: TIR runtime lookup, threshold crypto, multi-sig arbiters, ERC-5564, QES, full XMTP. See [research.md](research.md#decision-9-explicitly-out-of-scope). |
| Invariant 1: No platform-held decryption keys | PASS | Server-side code paths have no decryption capability; verified by absence of decryption helpers on server side and presence in `lib/crypto/` only. |
| Invariant 2: EAS attestations are the on-chain handshake | PASS | `AttestationManager.sol` wraps EAS `SchemaRegistry` + `EAS` contracts; capability gates in `LegalEngagementEscrow.sol` read EAS. |
| Invariant 3: Asymmetric capabilities, single identity | PASS | Per-action capability checks via modifiers (`onlyVerifiedClient`, `onlyVerifiedLawyer`, `onlyVerifiedArbiter`); a single address may hold any subset. |
| Invariant 4: Three-entity separation | PASS | `apps/bar-issuer` and `apps/pid-issuer` run as separate Next.js processes with their own SQLite DB and signing JWK on disk; the platform process can't read either. The platform operator address is a separate `process.env.OPERATOR_PRIVATE_KEY`. None can forge another's signatures. |
| Invariant 5: Per-engagement message transcripts tamper-evident | PASS | Each message hash leaves a leaf in the per-engagement Merkle tree; root is committed on chain at every fund/release/dispute/resolve/close event via `LegalEngagementEscrow.anchorTranscript`. |
| Invariant 6: Cooldowns are contract-enforced | PASS | `require(block.timestamp >= milestone.deliveredAt + LAWYER_DISPUTE_COOLDOWN, "cooldown not elapsed")` in `escalateMilestone`. |

**Verdict**: Constitution Check passes pre-research and pre-design. No violations to track.

### Constitution housekeeping (out of scope for this plan)

- The constitution at `.specify/memory/constitution.md` references `../../spike/wallet-integration/` but the spike has been relocated to `docs/spike/wallet-integration/`. This is a stale path in the constitution, not in this plan. A future PATCH bump on the constitution should fix it. Logging here so it isn't lost.

## Project Structure

### Documentation (this feature)

```text
specs/001-lex-nova-mvp/
├── plan.md              # this file
├── research.md          # Phase 0 — protocol/library decisions
├── data-model.md        # Phase 1 — entity definitions (on-chain + SQLite)
├── quickstart.md        # Phase 1 — bring-up the demo in 10 minutes
├── contracts/           # Phase 1 — interface contracts
│   ├── solidity-surface.md       # LegalEngagementEscrow + AttestationManager
│   ├── api-routes.md             # Next.js route handlers
│   ├── eas-schemas.md            # EAS schema definitions
│   ├── credential-shapes.md      # SD-JWT VC payloads
│   └── messaging-shape.md        # encrypted message envelope + transcript
├── checklists/
│   └── requirements.md  # spec-quality checklist (already present)
└── tasks.md             # Phase 2 (created by /speckit.tasks, NOT here)
```

### Source Code (repository root)

```text
lex-nova/                                # pnpm workspace
├── apps/
│   ├── platform/                        # the lex-nova product (Next.js, port 3010)
│   │   ├── app/
│   │   │   ├── (public)/                # landing, lawyer directory, post-matter
│   │   │   ├── (client)/                # client dashboard, engagement view, messaging
│   │   │   ├── (lawyer)/                # lawyer dashboard, inbox, engagement view
│   │   │   ├── (arbiter)/               # arbiter dispute queue, claim + resolve
│   │   │   ├── (operator)/capabilities/ # capability admin page
│   │   │   ├── onboarding/lawyer/       # OID4VP bar credential presentation flow
│   │   │   ├── onboarding/client/       # OID4VP PID presentation flow
│   │   │   └── api/
│   │   │       ├── verifier/            # OID4VP request/response endpoints (DCQL)
│   │   │       ├── auth/siwe/           # SIWE nonce + verify
│   │   │       ├── matters/             # CRUD for matters
│   │   │       ├── engagements/         # request/proposal/counter/fund flow helpers
│   │   │       ├── messages/            # ciphertext storage + transcript anchor helpers
│   │   │       └── arbiter/disputes/    # arbiter claim queue
│   │   ├── lib/
│   │   │   ├── chain/                   # viem clients, contract bindings, EAS helpers
│   │   │   ├── verifier/                # x509_san_dns cert, DCQL request build,
│   │   │   │                            # JWKS fetcher (HTTP, not in-process)
│   │   │   ├── db/                      # SQLite schema for *platform-only* state
│   │   │   ├── zk/                      # Noir circuit harness (prove/verify)
│   │   │   └── siwe/                    # SIWE message + nonce helpers
│   │   └── data/                        # platform DB (gitignored)
│   ├── bar-issuer/                      # stand-in bar association (Next.js, port 3001)
│   │   ├── app/api/issuer/bar/          # OID4VCI metadata + offer + token + credential
│   │   ├── lib/db/                      # bar-issuer SQLite (subjects + flow state)
│   │   ├── scripts/seed.ts              # populates lawyer roster + signing key
│   │   └── data/                        # bar-issuer DB + signing-key.jwk (gitignored)
│   ├── pid-issuer/                      # stand-in EU PID provider (Next.js, port 3002)
│   │   ├── app/api/issuer/pid/          # OID4VCI metadata + offer + token + credential
│   │   ├── lib/db/                      # pid-issuer SQLite (subjects + flow state)
│   │   ├── scripts/seed.ts              # populates citizen roster + signing key
│   │   └── data/                        # pid-issuer DB + signing-key.jwk (gitignored)
│   └── proxy/                           # path-routed reverse proxy (Node, port 3000)
│       └── src/index.ts                 # /api/issuer/bar/* → 3001, …/pid/* → 3002, * → 3010
├── packages/                            # shared TypeScript libraries
│   ├── crypto/                          # WebCrypto (ECDH, AES-GCM, ECDSA), Merkle helpers
│   ├── dcql/                            # DCQL builders + vp_token shape helpers
│   ├── sd-jwt/                          # SD-JWT VC parse/verify + issue
│   ├── oid4vci/                         # pre-auth code state, token, holder-proof verify
│   └── db-toolkit/                      # better-sqlite3 wrapper with per-path migrations
├── contracts/                           # Foundry project
│   ├── src/{LegalEngagementEscrow,AttestationManager}.sol
│   ├── script/Deploy.s.sol
│   ├── test/                            # forge tests
│   └── foundry.toml
├── circuits/                            # Noir
│   ├── src/main.nr                      # non-membership over N=8 Pedersen-hashed commitments
│   ├── Nargo.toml
│   └── target/                          # generated proving/verifying keys
├── scripts/                             # cross-service bring-up (deploy, check-attestations)
├── docs/                                # existing v3 docs + spike reference impl
│   └── spike/wallet-integration/
├── pnpm-workspace.yaml
└── specs/001-lex-nova-mvp/              # this feature's planning artifacts
```

**Structure Decision**: pnpm workspace with **four** runtime processes orchestrated under a single ngrok hostname. Constitution invariant 4 ("the bar issuer, PID issuer, and lex-nova platform are independent entities") is enforced at the process boundary: each issuer runs in its own Next.js process with its own SQLite DB and signing key; the platform never imports issuer code or reads issuer keys. The proxy (port 3000) routes path prefixes to the appropriate backend so the wallet's view of the world stays a single origin (required because ngrok free tier doesn't ship subdomains). Solidity contracts and the Noir circuit remain sibling packages with their own toolchains.

## Phase 0: Outline & Research

**Output**: [research.md](research.md)

The user's plan input pins the major technology choices (Next.js, SQLite, shadcn, Solidity, anvil, testnet path), so no `NEEDS CLARIFICATION` markers remain. Phase 0 documents the *decisions inside that envelope* — testnet selection, ZK toolchain, messaging substrate, transcript anchoring scheme, OID4VCI/OID4VP wire shapes (which the spike already validated), and explicit out-of-scope items.

## Phase 1: Design & Contracts

**Outputs**: [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

- [data-model.md](data-model.md): entities from the spec mapped to on-chain storage (capability attestations, engagement state, milestone state) vs SQLite tables (matters, ciphertext blobs, transcript leaves, signed proposals/counters, persona registry). State transitions for milestone (proposed → funded → delivered → released | disputed → claimed-by-arbiter → resolved) and engagement (active → closed) are codified.
- [contracts/solidity-surface.md](contracts/solidity-surface.md): the public surface of `LegalEngagementEscrow.sol` and `AttestationManager.sol`, including events, modifiers, and the asymmetric dispute mechanism.
- [contracts/api-routes.md](contracts/api-routes.md): Next.js route handlers for issuer (OID4VCI), verifier (OID4VP/DCQL), SIWE auth, matters/engagements/messages CRUD, and the arbiter dispute queue.
- [contracts/eas-schemas.md](contracts/eas-schemas.md): EAS schema definitions for `verified_lawyer`, `verified_client`, `verified_arbiter` and how `LegalEngagementEscrow` reads them.
- [contracts/credential-shapes.md](contracts/credential-shapes.md): the SD-JWT VC payload shapes for the bar credential (`urn:lex-nova:LegalProfessionalAccreditation`) and the PID credential (`urn:eudi:pid:1`), including the disclosed-attribute subset enforced at presentation time.
- [contracts/messaging-shape.md](contracts/messaging-shape.md): the encrypted-message envelope (ECDH-derived AES-GCM), the per-engagement Merkle transcript, and the anchoring rule.
- [quickstart.md](quickstart.md): a 10-minute "from clean repo to demo running" path: install, anvil up, deploy, seed personas, ngrok, run.

### Agent context update

The `update-agent-context.sh` script depends on the same feature-branch precondition that's blocked in this environment. Skipping the automated update; the existing `CLAUDE.md`-equivalent guidance in `.specify/memory/constitution.md` already captures the constraints that would have been added.

## Complexity Tracking

> Constitution Check passes with no violations to justify. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
