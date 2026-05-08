# Implementation Plan: Verified Legal Engagement

**Branch**: `001-verified-legal-engagement` (working trunk-only on `main` per project workflow)
**Date**: 2026-05-08
**Spec**: [spec.md](./spec.md)
**Constitution**: [`.specify/memory/constitution.md`](../../.specify/memory/constitution.md) (v1.1.0)
**Input**: Feature specification from `/specs/001-verified-legal-engagement/spec.md`

## Summary

The platform is a verified-pseudonymous legal-engagement marketplace. A
client signs in with their wallet, presents an EU resident credential
(disclosing only `age_equal_or_over.18` and `address.country`), and
sends a consultation request to a verified lawyer. Consultations are
free or paid (lawyer-set); paid consultations fund escrow on the same
user action that creates the request. After the consultation, the
lawyer can send wallet-signed **proposals** for additional work
(line items + deliverables); each proposal funds independently in
escrow before the lawyer marks delivered and the client releases. The
asymmetric dispute mechanism (client immediate, lawyer 30-day
contract-enforced cooldown) is preserved verbatim. Messages are end-to-
end encrypted with browser-derived ECDH keys; the platform stores
ciphertext only and anchors transcript Merkle roots on chain at every
funds-touching event.

The system runs as **two separate Next.js OS processes** behind a
path-routed reverse proxy: `apps/issuer` (issues PID + bar credentials,
two distinct signing keys, OID4VCI only) and `apps/platform`
(verification via OID4VP, application surface, contracts integration).
Both reach wwWallet on a single ngrok hostname per the free-tier
constraint. The `apps/proxy` Node service routes `/api/issuer/*` to the
issuer and everything else to the platform.

Three on-chain artifacts back the trust story:
`AttestationManager.sol` (thin EAS wrapper exposing
`hasCapability(address, schemaId)`), `LegalEngagementEscrow.sol`
(consultation + proposal escrow with the asymmetric dispute mechanism
and on-chain transcript anchoring), and `StubZKConflictVerifier.sol`
(conflict-of-interest verifier interface; returns `true` until the
production Noir verifier replaces it).

Spec clarifications from Session 2026-05-08 are wired in: chain-as-
arbiter for concurrent state mutations (FR-058 / FR-059), health-
checked-and-eventually-consistent chain availability behavior
(FR-060 / FR-061), English-only UI (FR-055a), 7-day consultation
auto-expire and client cancel-with-co-sign-refund (FR-015a / FR-015b),
and account deletion explicitly out of scope (Out of Scope section).

## Technical Context

**Language/Version**: TypeScript 5.7 (strict) on Node 20+. Solidity 0.8.28 (Foundry). Noir 1.0.0-beta.20+ (production trajectory only — the MVP deploys `StubZKConflictVerifier.sol`).

**Primary Dependencies**:

- `next@14.x` (App Router, server actions, route handlers) — both apps.
- `react@18.x`.
- `tailwindcss@3.x` with the design system's `@theme` block from `design/css/tokens.css`.
- shadcn-style primitives on Radix + `class-variance-authority` + `tailwind-merge`.
- `wagmi@2.x` + `viem@2.x` for wallet + chain interaction.
- `siwe@2.x` for SIWE auth on both apps.
- `better-sqlite3` for synchronous SQLite from Next.js route handlers.
- `jose` for SD-JWT VC parsing and JWS signing.
- `@ethereum-attestation-service/eas-sdk` for EAS schema + attestation tooling.
- Foundry (forge, anvil, cast) for contract dev / test / local-chain.
- `react-hook-form@7` + `zod@3` + `@hookform/resolvers`.
- `lucide-react` (icons; no emoji as UI elements per Constitution VI).
- `Inter` (UI) + `Fraunces` (hero / page titles).
- `sharp` for server-side avatar transcoding.
- `madge` (CI gate for import cycles per Invariant 7).

**Storage**: Two SQLite databases, one per process — `apps/issuer/data/db.sqlite` (subjects roster + OID4VCI flow state) and `apps/platform/data/db.sqlite` (verified_users, lawyer_profiles, engagements, consultations, proposals, conversations, messages-as-ciphertext, nonces, transcript_leaves, disputes_off_chain). The two-database partition is load-bearing: each process can read only its own DB.

**Testing**:

- `forge test` — asymmetric dispute invariants, escrow flow, capability checks, refund / release semantics, transcript anchor invariants.
- `vitest` (+ `@vitest/web-worker`) — TypeScript unit tests for crypto / credential code paths in the browser bundle.
- Playwright E2E on the golden flows: discovery → onboarding → paid consultation → mark complete → follow-up proposal → dispute → operator resolution. Suites use `DEV_BYPASS_EUDI=1` and `POST /api/dev/login` per FR-056 to skip the EUDI ceremony.

**Target Platform**: Modern desktop browsers (Chromium / Firefox / Safari). Mobile-responsive but desktop is the primary form factor for the consultation room demo. Server runtime: Node 20+ on Linux/macOS dev machines; production-trajectory deploys against a low-fee L2 testnet (Base Sepolia recommended).

**Project Type**: Two-app monorepo (pnpm workspace). Solidity contracts and the Noir circuit are sibling packages with their own toolchains.

**Performance Goals** (per spec SCs):

- Onboarding (lawyer or client) wall-clock under 3 minutes (SC-002).
- Client landing → funded paid consultation under 5 minutes excluding lawyer wall-clock (SC-001).
- Lawyer dashboard renders all four stat cards + today's schedule in under 1.2 seconds (SC-012).
- Chat message round-trip under 6 seconds (5-second poll + render budget; SC-009).
- Dev-bypass persona-pick to role home in under 4 seconds (SC-011).

**Constraints**:

- **Privilege boundary** (Constitution I + Inv 1): no key material on the server capable of decrypting messages, unsealing PID, or forging capability attestations. Server-bundle imports of any decryption helper are forbidden by the modularity gate (Inv 7).
- **Two-process boundary** (Constitution VII + Inv 4): platform never reads issuer signing keys. Validation only via HTTPS JWKS.
- **wwWallet metadata caching**: every issuer / verifier metadata response MUST send `Cache-Control: no-store` (validated wwWallet quirk).
- **Wallet handoff via HTTPS** (FR-014 implicit, spec body): credential offers and presentations are conveyed via `https://demo.wwwallet.org/cb?credential_offer_uri=...` and `?client_id=...&request_uri=...` URLs (web-wallet pattern). Native-scheme `openid4vp://` deep links are NOT the primary user affordance.
- **WCAG AA contrast everywhere** (Constitution VI).
- **Two accent colors only** — teal `#14B8A6`, gold `#C9A961` — gold under 5% visual weight.
- **Wallet addresses always truncated and monospaced** (FR-054).
- **No "smart contract escrow" copy** — use "secure payment held until your consultation completes" (FR-054).
- **Trunk-only branching**: commits land on `main`. No feature branches.
- **Brand name appears once** in user-visible places (only the title of spec.md and the title of this plan.md). Body uses neutral language.
- **Canonical glossary**: the structured payment artifact is named **proposal**. Alternative names from prior drafts MUST NOT appear in code, schema, contract function names, test names, or user-facing copy. The `scripts/check-brand-mentions.sh` CI gate enforces this; the gate's allow-list of detection terms is in the script source, not duplicated here.

**Scale/Scope**:

- Pre-staged personas at the issuer (anvil indices 1–6): five lawyers covering five EU jurisdictions (DE×2, ES, IT, CZ); one client. Anvil index 0 = platform operator (and MVP arbiter). Indices 7–9 reserved for second-client / multi-engagement scenarios.
- ≤ 100 engagements, ≤ 200 proposals, ≤ 5,000 messages across the demo lifetime — well within SQLite's comfort range.

## Constitution Check

*GATE: must pass before Phase 0 research. Re-checked after Phase 1 design.*

| Principle / Invariant | Status | Evidence |
|---|---|---|
| I. Privilege as Cryptography (NON-NEGOTIABLE) | PASS | All decryption keys derive from wallet ECDH in the browser via `apps/platform/lib/crypto/client/`; the platform server has no decryption path. Server bundle imports of `lib/crypto/decrypt*` are forbidden by the modularity gate. (Spec FR-035..FR-040.) |
| II. Pseudonymous by Default (NON-NEGOTIABLE) | PASS | The verifier's DCQL asks for *only* `age_equal_or_over.18` + `address.country` for clients; the platform's `verified_users.disclosed_attrs` is schema-validated to those two keys plus the wallet address. (Spec FR-002, FR-049, FR-051.) |
| III. Asymmetric Mechanisms | PASS | All asymmetry encoded in `LegalEngagementEscrow.sol` modifiers: client dispute is unconditional; lawyer escalate has `require(block.timestamp >= delivery + 30 days)`. (Spec FR-024, FR-025.) |
| IV. Standards-Compliance | PASS | OID4VCI / OID4VP+DCQL / SD-JWT VC / EAS / SIWE / WebCrypto / Noir+UltraHonk (production trajectory). No novel cryptography. |
| V. Quiet Web3, Loud Trust | PASS | A copy-review gate runs before every PR: it maps "smart contract" / "blockchain" / "escrow" out of user copy; ETH amounts displayed via a `formatETH(weiAmount)` helper paired with "secure payment" framing. Wallet addresses via `truncateAddress()` in monospace. (Spec FR-054, FR-055.) |
| VI. Design Tokens (NON-NEGOTIABLE) | PASS | Tailwind `@theme` block in `apps/platform/app/globals.css` from `design/css/tokens.css` is the source of truth. No hardcoded hex values outside the theme block; lucide-react is the only icon set. |
| VII. Two-Process Trust Boundary (NON-NEGOTIABLE) | PASS | `apps/issuer` and `apps/platform` are separate Next.js OS processes with their own DBs and signing keys; `apps/proxy` routes path prefixes. Platform code path has no `fs.readFile` against `apps/issuer/data/`. Spec FR-007, FR-008. |
| VIII. Real Persistence, Stubbed Seams | PASS | Stubs are isolated under `apps/platform/components/consultation/video-stub.tsx`, `apps/platform/app/api/uploads/route.ts`, and `contracts/src/StubZKConflictVerifier.sol`, each with a `TODO(production)` comment block describing the swap. |
| IX. Modularity for Iteration | PASS | Project tree (Project Structure below) maps each FR group to a contiguous module. CI runs `madge --circular apps/platform/`; static-analysis gate documented in this plan and in spec FR-058 / Inv 7. |
| Inv 1: No platform-held decryption keys | PASS | Server-side code paths have no decryption capability. |
| Inv 2: EAS attestations are the on-chain handshake | PASS | `AttestationManager.sol` wraps EAS; capability gates in `LegalEngagementEscrow.sol` read EAS via `hasCapability`. |
| Inv 3: Asymmetric capabilities, single identity | PASS | Per-action capability checks via modifiers (`onlyVerifiedClient`, `onlyVerifiedLawyer`); a single address may hold any subset. Lawyers explicitly hold both. |
| Inv 4: Issuer–Platform separation | PASS | Two processes, two DBs, two signing-key files on disk; the platform process can't read the issuer's signing keys (filesystem owner check). |
| Inv 5: Per-engagement message transcripts tamper-evident | PASS | Each message hash leaves a leaf in the per-engagement Merkle tree; root committed on chain at every fund / release / dispute / resolve / refund / close event via `LegalEngagementEscrow.anchorTranscript`. |
| Inv 6: Cooldowns are contract-enforced | PASS | `require(block.timestamp >= proposal.deliveredAt + LAWYER_DISPUTE_COOLDOWN)` in `escalateProposal`. |
| Inv 7: Bounded module ownership; no import cycles | PASS | CI gate via `madge --circular apps/platform/`. Sibling-feature import ban verified by static-analysis script `scripts/check-feature-isolation.sh`. Each module's owning spec ID declared in top-of-file comments. |

**Verdict**: Constitution Check passes pre-research and pre-design. No violations to track. Complexity Tracking section below is empty.

## Project Structure

### Documentation (this feature)

```text
specs/001-verified-legal-engagement/
├── plan.md              # this file
├── spec.md              # feature specification (user-facing requirements)
├── research.md          # Phase 0 — protocol/library decisions (this run)
├── data-model.md        # Phase 1 — entity definitions (this run)
├── quickstart.md        # Phase 1 — bring-up the demo in 10 minutes (this run)
├── contracts/           # Phase 1 — interface contracts (this run)
│   ├── solidity-surface.md       # LegalEngagementEscrow + AttestationManager
│   ├── api-routes.md             # Next.js route handlers
│   ├── eas-schemas.md            # EAS schema definitions
│   ├── credential-shapes.md      # SD-JWT VC payloads
│   └── messaging-shape.md        # encrypted message envelope + transcript
├── checklists/
│   └── requirements.md  # spec-quality checklist (created by /speckit-specify)
└── tasks.md             # Phase 2 (created by /speckit-tasks, NOT here)
```

### Source Code (repository root)

```text
firmus-novus/                            # pnpm workspace root
├── apps/
│   ├── platform/                        # the platform application (Next.js, port 3010)
│   │   ├── app/
│   │   │   ├── (marketing)/             # landing, directory, lawyer profile         — spec US1 / FR-041..FR-044
│   │   │   ├── connect/                 # SIWE + presentation orchestration           — spec US2/US3 / FR-001..FR-010
│   │   │   ├── verify-lawyer/           # lawyer profile-data form (first-time)       — spec US2 / FR-045 onboarding handoff
│   │   │   ├── (client)/                # gated to role=CLIENT
│   │   │   │   ├── home/                # client home                                  — spec US1/US3
│   │   │   │   ├── book/[lawyerId]/     # consultation request                          — spec US3 / FR-011..FR-014
│   │   │   │   ├── consultation/[id]/   # consultation room (client side)              — spec US5 / FR-035..FR-040
│   │   │   │   └── messages/            # messages list                                — spec US5
│   │   │   ├── (lawyer)/                # gated to role=LAWYER
│   │   │   │   ├── dashboard/           # dashboard                                    — spec US8 / FR-048
│   │   │   │   ├── requests/[id]/       # request review                               — spec US4 / FR-015
│   │   │   │   ├── profile/edit/        # profile editor + avatar upload               — spec US8 / FR-045..FR-047
│   │   │   │   ├── consultation/[id]/   # mirror of consultation room                  — spec US5
│   │   │   │   ├── proposals/[id]/      # send-proposal form, mark-delivered actions   — spec US6 / FR-016..FR-023
│   │   │   │   └── messages/            # messages list (mirror)                       — spec US5
│   │   │   ├── (operator)/              # gated to operator address
│   │   │   │   └── disputes/            # dispute queue + resolve                      — spec US7 / FR-027..FR-030
│   │   │   ├── dev/                     # dev-bypass persona picker                    — spec FR-056
│   │   │   └── api/
│   │   │       ├── auth/siwe/           # SIWE nonce + verify                          — spec FR-001
│   │   │       ├── verifier/            # OID4VP request / response (DCQL)             — spec FR-002..FR-009
│   │   │       ├── lawyers/             # directory data                               — spec FR-041..FR-043
│   │   │       ├── lawyer/profile/      # PATCH own profile                            — spec FR-045..FR-046
│   │   │       ├── lawyer/avatar/       # avatar upload + remove                       — spec FR-047
│   │   │       ├── consultations/       # consultation request, accept, decline, sign  — spec FR-011..FR-015b
│   │   │       ├── proposals/           # propose, fund, mark delivered, release       — spec FR-016..FR-023
│   │   │       ├── disputes/            # dispute, escalate, resolve calldata          — spec FR-024..FR-030
│   │   │       ├── messages/            # POST + poll (ciphertext only)                — spec FR-035..FR-040
│   │   │       ├── chain-health/        # RPC liveness probe for FR-060                — spec FR-060
│   │   │       └── dev/                 # /api/dev/login + /api/dev/reset              — spec FR-056
│   │   ├── components/
│   │   │   ├── ui/                      # tokens-only design primitives (Button, etc.)
│   │   │   └── firmus/                  # platform components (LawyerCard, AvatarBubble, EBSIBadge, …)
│   │   ├── lib/
│   │   │   ├── chain/                   # viem clients, contract bindings, EAS helpers
│   │   │   ├── verifier/                # x509_san_dns cert, DCQL request build, JWKS fetch
│   │   │   ├── db/                      # better-sqlite3 schema, per-feature data-access modules
│   │   │   ├── crypto/client/           # ECDH, AES-GCM, ECDSA — BROWSER bundle ONLY
│   │   │   ├── siwe/                    # SIWE nonce + message helpers
│   │   │   ├── format/                  # truncateAddress, formatETH (no formatEUR)
│   │   │   ├── anonymize/               # anonymousClientId(walletAddress) helper
│   │   │   └── dev/                     # persona-fixtures.ts (dev-bypass only)
│   │   ├── data/                        # platform DB + uploads (gitignored)
│   │   └── __tests__/                   # vitest specs, organized by feature module
│   ├── issuer/                          # credential issuer (Next.js, port 3001)
│   │   ├── app/
│   │   │   ├── (issuer)/                # SIWE + credential picker UI
│   │   │   └── api/issuer/
│   │   │       ├── pid/                 # OID4VCI flow for PID                          — spec FR-007..FR-008
│   │   │       │   ├── .well-known/{openid-credential-issuer,jwks.json}
│   │   │       │   ├── credential-offer/
│   │   │       │   ├── token/
│   │   │       │   └── credential/
│   │   │       └── bar/                 # OID4VCI flow for bar credential               — spec FR-007..FR-008
│   │   │           ├── .well-known/{openid-credential-issuer,jwks.json}
│   │   │           ├── credential-offer/
│   │   │           ├── token/
│   │   │           └── credential/
│   │   ├── lib/db/                      # issuer SQLite schema (subjects + flow)
│   │   ├── scripts/seed.ts              # populates lawyer + client roster + signing keys
│   │   └── data/                        # issuer DB + signing-key.jwk files (gitignored)
│   └── proxy/                           # path-routed reverse proxy (Node, port 3000)
│       └── src/index.ts                 # /api/issuer/* → 3001; * → 3010
├── packages/                            # shared TypeScript libraries (no feature business logic)
│   ├── crypto/                          # WebCrypto helpers (ECDH, AES-GCM, ECDSA, Merkle)
│   ├── dcql/                            # DCQL builders + vp_token shape helpers
│   ├── sd-jwt/                          # SD-JWT VC parse / verify / issue
│   ├── oid4vci/                         # pre-auth code state, token, holder-proof verify
│   └── db-toolkit/                      # better-sqlite3 wrapper with per-path migrations
├── contracts/                           # Foundry project
│   ├── src/{LegalEngagementEscrow,AttestationManager,StubZKConflictVerifier}.sol
│   ├── script/Deploy.s.sol
│   ├── test/                            # forge tests for asymmetric mechanism, escrow flow
│   └── foundry.toml
├── circuits/                            # Noir (production trajectory only in the MVP)
│   ├── src/main.nr
│   └── Nargo.toml
├── design/                              # design system (tokens, components.md, pages.md)
├── scripts/                             # cross-service bring-up + isolation gate
│   ├── deploy.sh                        # deploys contracts to Anvil / testnet
│   ├── seed.sh                          # seeds the issuer's subjects table
│   ├── check-isolation.sh               # process-separation test (FR-001a parity)
│   └── check-feature-isolation.sh       # static-analysis sibling-feature import ban
├── pnpm-workspace.yaml
└── specs/001-verified-legal-engagement/ # this feature's planning artifacts
```

**Structure Decision**: pnpm workspace with **three** runtime processes (proxy, issuer, platform) orchestrated under a single ngrok hostname per the free-tier constraint. Constitution Inv 4 ("the issuer and the platform are independent entities") is enforced at the process boundary: the issuer runs in its own Next.js process with its own SQLite DB and two signing JWKs (one per credential type); the platform never imports issuer code or reads issuer keys. The proxy routes path prefixes so the wallet's view of the world stays a single origin. Solidity contracts and the Noir circuit remain sibling packages with their own toolchains.

## Phase 0: Outline & Research

**Output**: [research.md](./research.md)

The user has pinned the major technology choices already (Next.js 14, SQLite, shadcn-style primitives, Solidity, Anvil, ETH-only currency, ngrok hosting, two-process trust boundary, single-wallet SIWE+VC, asymmetric dispute mechanism). Phase 0 documents the *decisions inside that envelope* — wallet handoff specifics, chain selection for testnet path, ZK toolchain (production trajectory only), messaging substrate, transcript anchoring scheme, OID4VCI/OID4VP wire shapes, contract-version pins, dev-bypass key-loading approach, and explicit out-of-scope items.

## Phase 1: Design & Contracts

**Outputs**: [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

- [data-model.md](./data-model.md) — entities from the spec mapped to on-chain storage (capability attestations, engagement state, consultation state, proposal state) vs SQLite tables (verified_users, lawyer_profiles, engagements_off_chain, consultations, proposals_off_chain, conversations, messages-as-ciphertext, transcript_leaves, disputes_off_chain, mutual_refund_authorizations). State machines for proposal (`ISSUED → FUNDED → DELIVERED → RELEASED` plus dispute / refund branches) and consultation (`REQUESTED → ACCEPTED → IN_PROGRESS → COMPLETED` plus DECLINED / DISPUTED / EXPIRED / CANCELLED branches) are codified.
- [contracts/solidity-surface.md](./contracts/solidity-surface.md) — public surface of `LegalEngagementEscrow.sol` and `AttestationManager.sol`, including events, modifiers, the asymmetric dispute mechanism, and the chain-as-arbiter rule (FR-058).
- [contracts/api-routes.md](./contracts/api-routes.md) — Next.js route handlers for issuer (OID4VCI), verifier (OID4VP/DCQL), SIWE auth, consultations / proposals / messages CRUD, dispute queue, and the dev-bypass endpoints.
- [contracts/eas-schemas.md](./contracts/eas-schemas.md) — EAS schema definitions for `verified_lawyer` and `verified_client` and how `LegalEngagementEscrow` reads them.
- [contracts/credential-shapes.md](./contracts/credential-shapes.md) — SD-JWT VC payload shapes for the bar credential (`urn:firmus-novus:LegalProfessionalAccreditation`) and the PID credential (`urn:eudi:pid:1`), including the disclosed-attribute subset enforced at presentation time.
- [contracts/messaging-shape.md](./contracts/messaging-shape.md) — encrypted-message envelope (ECDH-derived AES-GCM), per-engagement Merkle transcript, and anchoring rule.
- [quickstart.md](./quickstart.md) — a 10-minute "from clean repo to demo running" path: install, anvil up, deploy, seed personas, ngrok, run.

### Agent context update

Will update the plan reference between the `<!-- SPECKIT START -->` and `<!-- SPECKIT END -->` markers in `CLAUDE.md` to point to this plan file.

## Complexity Tracking

> Constitution Check passes with no violations to justify. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| — | — | — |
