---
description: "Task list for feature 001-verified-legal-engagement"
---

# Tasks: Verified Legal Engagement

**Input**: Design documents from `/specs/001-verified-legal-engagement/`
**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)
**Workflow**: trunk-only — every commit lands on `main`. No feature branches.

**Tests**: Test tasks are included for the contract layer (Foundry — non-negotiable since the asymmetric mechanism is constitutional) and for the golden Playwright flows (sign-in, directory filter, paid consultation end-to-end, multi-proposal, dispute resolution). Per-feature unit tests are listed but kept lean.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: `[US1]`–`[US8]` — Setup / Foundational / Polish phases carry no story label
- Every task description includes its target file path(s)

## Path Conventions

This is a pnpm-workspace monorepo with three runtime processes:

- `apps/platform/` — the application (Next.js, port 3010)
- `apps/issuer/` — the credential issuer (Next.js, port 3001)
- `apps/proxy/` — the path-routed reverse proxy (Node, port 3000)
- `packages/{crypto,dcql,sd-jwt,oid4vci,db-toolkit}/` — shared TypeScript libraries
- `contracts/` — Foundry project
- `circuits/` — Noir (production trajectory only)

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: workspace + tooling so every other task can land cleanly.

- [X] T001 Initialize pnpm workspace at the repo root with `pnpm-workspace.yaml`, `package.json`, and `.npmrc`. List the four app/package directories.
- [X] T002 [P] Create the `apps/platform/`, `apps/issuer/`, `apps/proxy/` skeleton directories with stub `package.json` files referencing pnpm workspace deps.
- [X] T003 [P] Create `packages/{crypto,dcql,sd-jwt,oid4vci,db-toolkit}/` skeleton directories with stub `package.json` and `index.ts` exports.
- [X] T004 [P] Initialize Foundry at `contracts/` (`forge init --no-git`); add `foundry.toml` with `solc = "0.8.28"`, `optimizer = true`, `optimizer_runs = 200`.
- [X] T005 [P] Pin OpenZeppelin Contracts v5.2.0 in `contracts/foundry.toml` remappings; install via `forge install OpenZeppelin/openzeppelin-contracts@v5.2.0 --no-commit`.
- [X] T006 [P] Create `circuits/` skeleton with `Nargo.toml` and `src/main.nr` placeholder. Document under `circuits/README.md` that the Noir circuit is production trajectory only.
- [X] T007 Configure root TypeScript at `tsconfig.base.json` (strict mode, `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "bundler"`); each app extends with its own `tsconfig.json`.
- [X] T008 [P] Configure root ESLint at `.eslintrc.cjs` (Next.js + TypeScript strict + import-cycles plugin). Each app inherits.
- [X] T009 [P] Configure root Prettier at `.prettierrc.json` (2 spaces, single quotes, no trailing commas in JSON).
- [X] T010 Add Tailwind v3 to both `apps/platform/` and `apps/issuer/`; copy `design/css/tokens.css` into each app's `app/globals.css` as the `@theme` block.
- [X] T011 [P] Install `sharp`, `jose`, `siwe@2`, `wagmi@2`, `viem@2`, `better-sqlite3`, `zod`, `react-hook-form`, `@hookform/resolvers`, `lucide-react`, `class-variance-authority`, `tailwind-merge` in `apps/platform/`.
- [X] T012 [P] Install `jose`, `siwe@2`, `better-sqlite3`, `zod` in `apps/issuer/`.
- [X] T013 [P] Install `@ethereum-attestation-service/eas-sdk` in `apps/platform/`.
- [X] T014 Add `madge` and `dependency-cruiser` as workspace dev-deps for the modularity gate (Constitution Inv 7).
- [ ] T015 [P] Set up Playwright in `apps/platform/` (`playwright.config.ts`); browsers via `pnpm exec playwright install chromium firefox`.
- [ ] T016 [P] Set up vitest in `apps/platform/` (`vitest.config.ts`) plus `@vitest/web-worker` for crypto-path unit tests.
- [X] T017 Create `.env.example` at the repo root listing every env var the workspace consumes (DATABASE paths, OPERATOR_PRIVATE_KEY, NEXT_PUBLIC_RPC_URL, NEXT_PUBLIC_CHAIN_ID, NGROK_HOSTNAME, PUBLIC_URL, DEV_BYPASS_EUDI). Document which are dev-only.
- [X] T018 [P] Add `.gitignore` lines for `apps/*/data/`, `apps/*/.next/`, `node_modules/`, `dist/`, `cache/`, `out/`, `broadcast/`, `circuits/target/`.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST exist before any user story phase begins. This includes the contracts, the chain bindings, the SIWE auth substrate, the SQLite schemas, the indexer, the design system, the dev-bypass scaffolding, and the CI gates that enforce constitutional invariants.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Solidity contracts

- [X] T019 Implement `contracts/src/AttestationManager.sol` with `attestVerifiedLawyer`, `attestVerifiedClient`, `revokeCapability`, `hasCapability`, the `onlyOperator` modifier, and the `Attested`/`Revoked` events per [contracts/solidity-surface.md](./contracts/solidity-surface.md#attestationmanagersol).
- [X] T020 Implement `contracts/src/StubZKConflictVerifier.sol` with `verifyProof` returning `true` and a `TODO(production)` comment block referencing the bb-generated swap.
- [X] T021 Implement `contracts/src/LegalEngagementEscrow.sol`: `Engagement`/`Proposal` structs, all state machines from data-model.md, `openFreeEngagement`, `openPaidEngagementAndFundConsultation`, `fundProposal` (verifies lawyer signature on chain), `markDelivered`, `releaseProposal`, `disputeProposal`, `escalateProposal` (with `cooldownElapsed` modifier), `resolveDispute` (sum-equality require), `mutualRefundProposal` (verifies both signatures), `closeEngagement`, `anchorTranscript`, `setConflictRoot`, `lawyerConflictRoot`, all events.
- [X] T022 Define interface contract `contracts/src/interfaces/IZKConflictVerifier.sol` and import it from `LegalEngagementEscrow.sol`.
- [X] T023 Write `contracts/script/Deploy.s.sol`: deploy `AttestationManager` (operator = msg.sender), register the two EAS schemas, deploy `StubZKConflictVerifier`, deploy `LegalEngagementEscrow(attestationManager, verifier, operator)`, print all addresses + EAS UIDs as JSON to `apps/platform/lib/chain/addresses.ts`.
- [X] T024 [P] Foundry test `contracts/test/AsymmetricMechanism.t.sol`: client may dispute Funded or Delivered without cooldown; lawyer escalation reverts at `delivered+30days-1` and succeeds at `+0`. (Constitution Inv 6.)
- [X] T025 [P] Foundry test `contracts/test/EscrowFlow.t.sol`: full proposal lifecycle Funded → Delivered → Released; release on Funded (no markDelivered) succeeds; double-release reverts; `closeEngagement` requires every proposal terminal.
- [X] T026 [P] Foundry test `contracts/test/CapabilityChecks.t.sol`: `openPaidEngagementAndFundConsultation` reverts if client lacks `verified_client` or lawyer lacks `verified_lawyer`; non-operator `resolveDispute` reverts.
- [X] T027 [P] Foundry test `contracts/test/MutualRefund.t.sol`: refund requires BOTH signatures; refund of a Delivered proposal reverts (must use dispute path); unilateral refund unconditionally reverts.
- [X] T028 [P] Foundry test `contracts/test/ResolveSplit.t.sol`: `resolveDispute` requires `amountToLawyer + amountToClient == proposal.amount` to the wei.
- [X] T029 [P] Foundry test `contracts/test/ConcurrentTransitions.t.sol`: when two transactions race to advance the same proposal, the first succeeds and the second reverts (FR-058 chain-as-arbiter rule).

### Chain bindings + viem

- [X] T030 Create `apps/platform/lib/chain/client.ts`: viem clients for `publicClient` and `walletClient` (operator key from env). Owner spec: 001 — top-of-file comment.
- [X] T031 [P] Create `apps/platform/lib/chain/contracts.ts`: typed bindings for `AttestationManager`, `LegalEngagementEscrow`, generated from the deployed addresses in `addresses.ts`.
- [X] T032 [P] Create `apps/platform/lib/chain/eas.ts`: helpers for the two EAS schema UIDs (`SCHEMA_LAWYER`, `SCHEMA_CLIENT`).
- [X] T033 Implement `apps/platform/app/api/chain-health/route.ts`: GET handler that probes `eth_blockNumber` with a 5-second cache; returns `{healthy, lastBlock?, lastChecked}` (FR-060).
- [X] T034 Implement `apps/platform/lib/chain/indexer.ts`: viem `watchContractEvent` daemon that listens for `EngagementOpened`, `Proposal*`, `TranscriptAnchored`, `EngagementClosed`, `Attested`, `Revoked`; reconciles the off-chain SQLite mirrors. Resilient to chain unavailability (FR-061).

### SIWE + nonces (both apps)

- [X] T035 Create `apps/platform/lib/siwe/nonce.ts`: nonce generation, persist to `nonces` table, mark used on consume.
- [X] T036 [P] Create `apps/platform/lib/siwe/verify.ts`: SIWE message + signature verification using the `siwe` lib; rejects reused nonces.
- [X] T037 [P] Implement `apps/platform/app/api/auth/siwe/{nonce,verify,logout}/route.ts`: GET nonce, POST verify (sets session cookie), POST logout.
- [X] T038 [P] Mirror `apps/issuer/app/api/issuer/auth/siwe/{nonce,verify}/route.ts` with the issuer's separate session cookie domain.
- [X] T039 Create `apps/platform/middleware.ts`: role-gated routing for `/client/*`, `/lawyer/*`, `/operator/*`, `/verify-lawyer`. 404 (not 403) on role mismatch to avoid leaking path existence.

### Issuer SQLite schema + seed

- [ ] T040 Create `apps/issuer/lib/db/schema.ts`: `subjects`, `issuer_pre_auth_codes`, `issuer_access_tokens`, `credential_offers` tables per [data-model.md](./data-model.md#issuer-db--subjects). Migration runs on app boot.
- [ ] T041 Implement `apps/issuer/scripts/seed.ts`: populates `subjects` with five lawyers (anvil indices 1–5, both PID + bar rows) and one client (anvil index 6, PID only). Owner spec: 001.
- [ ] T042 Implement `apps/issuer/lib/keys.ts`: at first boot, generate `pid-signing-key.jwk` and `bar-signing-key.jwk` as ES256 P-256 JWKs at `apps/issuer/data/`. Idempotent: skips if files exist.

### Platform SQLite schema

- [X] T043 Create `apps/platform/lib/db/client.ts`: better-sqlite3 wrapper with WAL mode and foreign keys ON. Owner spec: 001.
- [X] T044 Create `apps/platform/lib/db/schema.ts`: `verified_users`, `lawyer_profiles`, `engagements_off_chain`, `consultations`, `proposals_off_chain`, `messages`, `mutual_refund_authorizations`, `disputes_off_chain`, `nonces`, `verifier_states` per [data-model.md](./data-model.md#platform-db--verified_users). Migrations run on boot.
- [X] T045 [P] Create `apps/platform/lib/db/verified-users.ts`: per-feature data access for `verified_users` (composite PK on `(eth_address, attested_role)`). Owner spec: 001.
- [X] T046 [P] Create `apps/platform/lib/db/lawyer-profiles.ts`: per-feature data access for `lawyer_profiles`. Owner spec: 001.
- [X] T047 [P] Create `apps/platform/lib/db/engagements.ts`: data access for `engagements_off_chain`. Owner spec: 001.
- [X] T048 [P] Create `apps/platform/lib/db/consultations.ts`: data access for `consultations` (state machine helpers + `expires_at` computation, FR-015a). Owner spec: 001.
- [X] T049 [P] Create `apps/platform/lib/db/proposals.ts`: data access for `proposals_off_chain`. Owner spec: 001.
- [X] T050 [P] Create `apps/platform/lib/db/messages.ts`: data access for `messages`; rejects any insert with a top-level `plaintext` field (FR-036).
- [X] T051 [P] Create `apps/platform/lib/db/disputes.ts`: data access for `disputes_off_chain`. Owner spec: 001.

### Reverse proxy

- [X] T052 Implement `apps/proxy/src/index.ts`: Node HTTP server on port 3000 routing `/api/issuer/*` and `/issuer/*` → `http://localhost:3001`, everything else → `http://localhost:3010`. Forwards X-Forwarded-* headers correctly so SIWE verification works.

### Design system + UI primitives

- [X] T053 [P] Create `apps/platform/components/ui/button.tsx`, `input.tsx`, `card.tsx`, `tabs.tsx`, `chip.tsx` per `design/components.md`. Tokens-only (Constitution IX, item 4).
- [X] T054 [P] Create `apps/platform/components/firmus/avatar-bubble.tsx`: renders initials over slate-50 by default; if `imageUrl` prop is set, renders the image; gold verified ring at 2-px outline. Sizes: 32 / 56 / 64 / 80 / 96 px.
- [X] T055 [P] Create `apps/platform/components/firmus/ebsi-badge.tsx`: gold pill with the lucide `ShieldCheck` icon and the truncated EAS attestation UID; clicking opens a panel with the full UID and a chain-explorer link.
- [X] T056 [P] Create `apps/platform/components/firmus/lawyer-card.tsx`: directory + recently-joined card per `design/components.md` §LawyerCard. No business logic imports — props-driven.
- [X] T057 [P] Create `apps/platform/components/firmus/pricing-badge.tsx`, `stars.tsx`, `escrow-status-indicator.tsx`, `chain-unavailable-banner.tsx` (FR-060), `dev-mode-banner.tsx` (FR-D03).
- [X] T058 [P] Create `apps/platform/lib/format/eth.ts`: `formatETH(wei: bigint): string` truncates to 4 decimal places, never produces scientific notation. Forbid `formatEUR`.
- [X] T059 [P] Create `apps/platform/lib/format/address.ts`: `truncateAddress(addr: string): string` produces `0x4f02…2c1a`.
- [X] T060 [P] Create `apps/platform/lib/anonymize/client-id.ts`: `anonymousClientId(walletAddress: string): string` returns `anon-XXXX` (first 4 hex chars of `keccak256("platform" || walletAddress)`).

### Crypto primitives (browser-only)

- [X] T061 Create `packages/crypto/src/ecdh.ts`: ECDH P-256 key generation and shared-secret derivation via WebCrypto. ALL exports are browser-only.
- [X] T062 [P] Create `packages/crypto/src/aes-gcm.ts`: AES-GCM-256 encrypt / decrypt with HKDF-SHA-256 key derivation.
- [X] T063 [P] Create `packages/crypto/src/ecdsa.ts`: ECDSA P-256 sign / verify.
- [X] T064 [P] Create `packages/crypto/src/merkle.ts`: incremental Merkle tree (depth 16) with SHA-256 leaves; `appendLeaf` returns new root.
- [X] T065 Create `apps/platform/lib/crypto/client/index.ts`: re-exports from `packages/crypto/`. The `apps/platform/lib/crypto/server/` directory MUST NOT exist (no server-side decryption helpers — Constitution Inv 1).

### Operator + dev-bypass scaffolding

- [X] T066 Create `apps/platform/lib/operator.ts`: loads `OPERATOR_PRIVATE_KEY` from `.env.local`; refuses to load if `NODE_ENV='production'` AND the key is the demo anvil[0] value. Provides a viem `walletClient` for writing EAS attestations.
- [X] T067 Create `apps/platform/lib/dev/persona-fixtures.ts`: TypeScript const with the six personas (anvil indices 1–6); each carries `walletAddress`, `displayName`, `roles[]`, `disclosed_attrs.client`, `disclosed_attrs.lawyer?`, `messageKeyPair: {pub, priv}` (P-256), `lawyerProfile?` fixture. Top-of-file comment forbids imports from any module under `apps/platform/lib/` outside `lib/dev/`.
- [X] T068 [P] Create `apps/platform/lib/dev/bypass-guard.ts`: `assertBypassActive()` throws unless `process.env.DEV_BYPASS_EUDI === '1'`; also refuses to start if `NODE_ENV === 'production'` (FR-D01).
- [X] T069 Implement `apps/platform/app/api/dev/login/route.ts`: POST `{persona}` performs the seeding flow per FR-D06; idempotent. 404 unless bypass is active.
- [X] T070 [P] Implement `apps/platform/app/api/dev/reset/route.ts`: clears all platform DB rows; reverts the Anvil chain via `evm_revert` to a fresh snapshot. 404 unless bypass is active.
- [X] T071 [P] Implement `apps/platform/app/api/dev/skip-time/route.ts`: POST `{seconds}` calls `evm_increaseTime` + `evm_mine` on Anvil. 404 unless bypass is active.
- [X] T072 Implement `apps/platform/app/dev/personas/page.tsx`: persona picker UI listing fixture personas with cleartext name, role, truncated address. 404 unless bypass is active.

### CI invariant gates

- [ ] T073 Create `scripts/check-isolation.sh`: starts the issuer alone, posts a credential offer, then starts the platform alone, verifies the platform can fetch the issuer's `.well-known/jwks.json` over HTTP. Exits non-zero on failure.
- [X] T074 [P] Create `scripts/check-feature-isolation.sh`: greps `apps/platform/app/(client|lawyer|operator)/**` for cross-feature imports between siblings; exits non-zero on any direct sibling-feature import.
- [X] T075 [P] Create `scripts/check-brand-mentions.sh`: confirms exactly one mention of the public brand name in spec / plan title lines, zero mentions in spec body, zero mentions of the alternative names from prior drafts in the entire repo.
- [X] T076 [P] Create `scripts/check-no-server-decryption.sh`: greps `apps/platform/lib/` (excluding `lib/crypto/client/` and `lib/dev/`) for AES-GCM-decrypt or ECDH-derive imports; exits non-zero on any match (Constitution Inv 1).
- [ ] T077 [P] Add `.github/workflows/ci.yml` running: `forge test`, `pnpm test` (vitest), `pnpm madge --circular apps/platform/`, `scripts/check-feature-isolation.sh`, `scripts/check-brand-mentions.sh`, `scripts/check-no-server-decryption.sh`, `scripts/check-isolation.sh`.

**Checkpoint**: foundation ready — user story implementation can now begin in parallel.

---

## Phase 3: User Story 1 — Visitor finds a verified lawyer (Priority: P1) 🎯 MVP

**Goal**: a public visitor lands on the marketing surface, browses the directory, narrows by filters, and reads a lawyer's full profile. The verification badge resolves to a live on-chain capability check.

**Independent Test**: visit `/` unauthenticated → see hero + How It Works + recently-joined cards → click "Find a Lawyer" → directory loads → apply specialty filter → result narrows → click a lawyer card → profile renders with About / Credentials / Reviews / Availability tabs and the verification badge UID resolves on click.

- [X] T078 [P] [US1] Create `apps/platform/app/(marketing)/layout.tsx`: marketing nav + footer chrome.
- [X] T079 [P] [US1] Create `apps/platform/app/(marketing)/page.tsx`: landing page with hero ("Verified Legal Counsel, On-Chain."), three "How It Works" steps (lucide `MessageSquare`, `ShieldCheck`, `Lock`), trust strip, recently-joined `LawyerCard` × 3 (per [design/pages.md §1](../../design/pages.md)).
- [X] T080 [US1] Create `apps/platform/app/(marketing)/lawyers/page.tsx`: directory page with sticky filters bar (Specialty / Language / Pricing / Sort) and `LawyerCard` grid.
- [X] T081 [US1] Create `apps/platform/app/(marketing)/lawyers/directory-filters.tsx`: client component for filter chips; debounced URL-param updates.
- [X] T082 [US1] Create `apps/platform/app/(marketing)/lawyers/[id]/page.tsx`: lawyer profile with profile header (avatar, name, specialty · city, stars, EBSI badge), two-column grid with tabs and sticky booking sidebar (per [design/pages.md §3](../../design/pages.md)).
- [X] T083 [P] [US1] Create `apps/platform/app/(marketing)/lawyers/[id]/about-tab.tsx`, `credentials-tab.tsx`, `reviews-tab.tsx` (empty-state placeholder), `availability-tab.tsx`.
- [X] T084 [US1] Implement `apps/platform/app/api/lawyers/route.ts`: GET handler joining `verified_users` (where `attested_role='lawyer' AND revoked_at IS NULL AND validUntil >= now`) with `lawyer_profiles`. Filters from query params. ORDER BY `attested_at DESC` for default sort.
- [X] T085 [US1] Implement `apps/platform/app/api/lawyers/[id]/route.ts`: GET handler returning the LawyerDirectoryRow shape per [spec.md Key Entities](./spec.md#key-entities). 404 if attestation revoked/expired/missing.
- [X] T086 [P] [US1] Add live `hasCapability` check on the EBSI badge click (calls `viem.readContract(AttestationManager.hasCapability)`); displays the UID + chain-explorer link.
- [X] T087 [P] [US1] Add `LawyerCard` empty-state for the zero-results filter case ("No matching counsel. Try removing a filter." with `Clear filters` CTA).
- [ ] T088 [P] [US1] Add Playwright E2E `apps/platform/__tests__/us1-discovery.spec.ts`: load `/`, scroll, click `/lawyers`, apply a filter, click a card, verify profile renders. Uses `DEV_BYPASS_EUDI=1` to seed three verified lawyers via `/api/dev/login`.

**Checkpoint**: US1 ships an MVP discovery surface independently of any onboarding work.

---

## Phase 4: User Story 2 — Lawyer onboards (Priority: P1) 🎯 MVP

**Goal**: a lawyer wallet on the issuer's bar roster connects, signs in, mints both PID + bar credentials, returns to the platform, presents both, fills profile data, and lands in the public directory.

**Independent Test**: from a wallet that the issuer has on both rosters, complete connect → SIWE → mint PID at issuer → return → present PID → mint bar at issuer → return → present bar → fill profile fields → save → see the lawyer in `/lawyers`.

### Issuer side (OID4VCI for both credential types)

- [ ] T089 [US2] Implement `apps/issuer/app/api/issuer/pid/.well-known/openid-credential-issuer/route.ts`: GET handler returning issuer metadata for `urn:eudi:pid:1`. Sends `Cache-Control: no-store`.
- [ ] T090 [P] [US2] Implement `apps/issuer/app/api/issuer/pid/.well-known/jwks.json/route.ts`: returns the PID public key from `pid-signing-key.jwk`.
- [ ] T091 [US2] Implement `apps/issuer/app/api/issuer/pid/credential-offer/route.ts`: POST creates a pre-auth code, stores the offer JSON at `credential_offer_uri`, returns the HTTPS handoff URL `https://demo.wwwallet.org/cb?credential_offer_uri=<encoded>`.
- [ ] T092 [P] [US2] Implement `apps/issuer/app/api/issuer/pid/token/route.ts`: OID4VCI token endpoint (pre-authorized code grant + DPoP).
- [ ] T093 [US2] Implement `apps/issuer/app/api/issuer/pid/credential/route.ts`: issues SD-JWT VC `urn:eudi:pid:1` signed with `pid-signing-key.jwk`. `iss` claim is the issuer's HTTPS hostname (NOT did:key).
- [ ] T094 [P] [US2] Mirror PID routes for the bar credential at `apps/issuer/app/api/issuer/bar/{.well-known/openid-credential-issuer,.well-known/jwks.json,credential-offer,token,credential}/route.ts`. Bar credential offer gates on `subjects WHERE eth_address=<wallet> AND credential_type='bar'`; 403 if not on the bar roster.
- [ ] T095 [US2] Implement `apps/issuer/app/(issuer)/page.tsx`: credential picker UI. Shows tiles for PID and bar; bar tile is greyed out when the SIWE-bound wallet is not on the bar roster.
- [ ] T096 [P] [US2] Add E2E test (vitest, against the live spike) verifying both credential issuances complete end-to-end.

### Platform side (OID4VP verifier)

- [ ] T097 [US2] Implement `apps/platform/lib/verifier/x509-cert.ts`: at boot, generate a self-signed RSA cert with CN = `process.env.NGROK_HOSTNAME`. Persist to `apps/platform/data/verifier-cert.pem`.
- [ ] T098 [US2] Implement `apps/platform/app/api/verifier/x509-cert.pem/route.ts`: serves the cert.
- [ ] T099 [P] [US2] Create `packages/dcql/src/builders.ts`: DCQL query builders for PID and bar presentations per [contracts/credential-shapes.md](./contracts/credential-shapes.md).
- [ ] T100 [P] [US2] Create `packages/sd-jwt/src/{parse,verify,sign}.ts`: SD-JWT VC parse + verify (against issuer JWKS over HTTP) + sign helpers.
- [ ] T101 [US2] Implement `apps/platform/app/api/verifier/request/route.ts`: POST creates a presentation request (kind ∈ `{pid, bar}`); stores the signed JWS request object (with `typ=oauth-authz-req+jwt` and `x5c` header chain); returns the HTTPS handoff URL `https://demo.wwwallet.org/cb?client_id=...&request_uri=...`.
- [ ] T102 [P] [US2] Implement `apps/platform/app/api/verifier/request/[state]/object/route.ts`: GET returns the signed JWS request object.
- [ ] T103 [US2] Implement `apps/platform/app/api/verifier/response/[state]/route.ts`: POST receives `vp_token` (parses BOTH string and array shapes — wwWallet quirk). Verifies SD-JWT VC against issuer JWKS, holder binding (KB-JWT signed by `cnf.jwk`; binding key matches SIWE address), validity end-date. On success, writes the appropriate EAS attestation via `AttestationManager.attestVerifiedClient` or `attestVerifiedLawyer` from the operator key; persists `verified_users` row.
- [ ] T104 [P] [US2] Implement `apps/platform/app/api/verifier/result/[state]/route.ts`: polled by browser; returns 200 + verified attribute subset, 202 (pending), or 4xx with reason.

### Platform side (lawyer onboarding flow + profile editor)

- [X] T105 [US2] Implement `apps/platform/app/connect/page.tsx`: role chooser (client / lawyer). Honors `?returnTo=` for post-onboarding redirects.
- [ ] T106 [US2] Implement `apps/platform/app/connect/lawyer-stepper.tsx`: three-stage stepper (Authenticate → Verify identity → Verify profession) per [design/pages.md §4](../../design/pages.md). Uses HTTPS handoff URLs (`target="wwwallet"` anchors); never surfaces native-scheme deep links.
- [ ] T107 [US2] Implement `apps/platform/app/verify-lawyer/page.tsx`: post-onboarding profile-data form. Pre-fills credential-derived fields (read-only). Editable: city, headline, bio (≥ 40 chars), specialties multi-select, languages, jurisdictions, years experience, hourly rate, pricing kind, pricing headline, consultation rate 30 / 60, pricing items (when non-HOURLY), tags, availability, consultation type (FREE/PAID).
- [ ] T108 [P] [US2] Implement `apps/platform/app/verify-lawyer/verify-lawyer-form.tsx`: zod-validated form; rejects unknown fields server-side (FR-046).
- [ ] T109 [US2] Implement `apps/platform/app/api/lawyer/profile/route.ts`: PATCH endpoint. Server re-checks `hasCapability(walletAddress, SCHEMA_LAWYER)` before persisting (FR-006-style ownership). zod schema rejects credential-derived fields.
- [ ] T110 [P] [US2] Add Playwright E2E `apps/platform/__tests__/us2-lawyer-onboarding.spec.ts`: full lawyer onboarding via dev-bypass `POST /api/dev/login` (writes both EAS attestations + lawyer_profiles fixture row); verify the lawyer appears in `/lawyers`.

**Checkpoint**: lawyers can fully self-onboard. Combined with US1, the directory is no longer empty.

---

## Phase 5: User Story 3 — Client onboards and books a consultation (Priority: P1) 🎯 MVP

**Goal**: a client wallet onboards (PID-only presentation), picks a lawyer, books a consultation. PAID consultations fund escrow; FREE ones do not.

**Independent Test**: as a client wallet holding a freshly-minted PID, complete connect → SIWE → present PID → land at `/client/home` → pick a lawyer → submit consultation request with date / duration / practice area / case description ≥ 20 chars. For PAID, sign one funding transaction. Land in the consultation workspace; the engagement and conversation rows exist.

- [X] T111 [US3] Implement `apps/platform/app/connect/client-stepper.tsx`: two-stage stepper (Authenticate → Verify identity). Honors `?returnTo=`.
- [X] T112 [P] [US3] Implement `apps/platform/app/(client)/layout.tsx`: client-role chrome and `requireClient()` server-side check.
- [X] T113 [US3] Implement `apps/platform/app/(client)/home/page.tsx`: greeting + practice-area categories (8 canonical) + Active consultation card (if any) + recommended-lawyers grid.
- [X] T114 [US3] Implement `apps/platform/app/(client)/book/[lawyerId]/page.tsx`: booking form. Snapshots the lawyer's `consultation_kind` (FREE / PAID). For PAID, displays the rate.
- [X] T115 [P] [US3] Implement `apps/platform/app/(client)/book/[lawyerId]/booking-form.tsx`: zod-validated; date/time picker, duration radio (30 / 60), practice area picker, case description ≥ 20 chars, fee summary panel.
- [X] T116 [US3] Implement `apps/platform/app/api/consultations/route.ts`: POST creates the consultation + engagement records. For PAID, builds calldata for `openPaidEngagementAndFundConsultation` and returns it for the wallet to broadcast. For FREE, builds calldata for `openFreeEngagement` (zero ETH) for the wallet to sign.
- [X] T117 [P] [US3] Implement `apps/platform/app/api/consultations/[id]/route.ts`: GET reads one consultation including the paired engagement and conversation. Auth-gated to engagement parties.
- [X] T118 [US3] On successful tx confirmation (indexer hears `EngagementOpened`), the platform creates the `conversations` row and inserts the matter description into `engagements_off_chain.matter_description`.
- [X] T119 [P] [US3] Add chain-health gate (`/api/chain-health`) to the booking-form Confirm button: disable + show `<ChainUnavailableBanner>` when the chain is unreachable (FR-060).
- [ ] T120 [P] [US3] Add Playwright E2E `apps/platform/__tests__/us3-client-booking.spec.ts`: dev-bypass login as client; book paid + free consultation; verify both engagement rows exist; verify the PAID one has a non-null `escrow_funding_tx_hash`.

**Checkpoint**: clients can fully self-onboard and create engagements. The on-chain escrow holds parked funds for PAID consultations.

---

## Phase 6: User Story 4 — Lawyer accepts or declines (Priority: P1) 🎯 MVP

**Goal**: the lawyer reviews the request (anonymous client identifier), accepts or declines. Decline triggers the mutual-refund authorization flow for PAID consultations.

**Independent Test**: as a lawyer with one pending REQUESTED consultation, open `/lawyer/dashboard`, see the request in the recent-requests panel showing `anon-XXXX`, click into `/lawyer/requests/[id]`, click Accept; verify the consultation status flips to ACCEPTED.

- [X] T121 [P] [US4] Implement `apps/platform/app/(lawyer)/layout.tsx`: lawyer-role chrome and `requireLawyer()` server-side check.
- [X] T122 [US4] Implement `apps/platform/app/(lawyer)/dashboard/page.tsx`: minimal dashboard for US4 (full version in US8). Shows pending-requests count + the recent-requests panel listing 5 most recent REQUESTED consultations.
- [X] T123 [US4] Implement `apps/platform/app/(lawyer)/requests/[id]/page.tsx`: request review page with anonymized client identifier, practice area, jurisdiction (DE), scheduled time, duration, case description, fee breakdown (consultation fee, platform fee, lawyer's net).
- [X] T124 [P] [US4] Implement `apps/platform/app/(lawyer)/requests/[id]/request-actions.tsx`: Accept and Decline buttons (teal primary + ghost).
- [X] T125 [US4] Implement `apps/platform/app/api/consultations/[id]/accept/route.ts`: POST verifies booking ownership (`booking.lawyer_profile.user_id === session.user.id`); off-chain transition REQUESTED → ACCEPTED.
- [X] T126 [US4] Implement `apps/platform/app/api/consultations/[id]/decline/route.ts`: POST verifies ownership; transitions to DECLINED. For PAID, initiates `MutualRefundAuthorization` flow (lawyer signs server-side stub for now; actual signing happens in the lawyer's wallet).
- [X] T127 [P] [US4] Implement `apps/platform/app/api/consultations/[id]/cancel/route.ts`: POST verifies client ownership; transitions to CANCELLED. For PAID, initiates the mutual-refund flow (FR-015b).
- [X] T128 [P] [US4] Implement `apps/platform/lib/db/consultations.ts` helper `expireStale()`: scheduled job (cron-style or per-request lazy) auto-transitions `status='REQUESTED'` rows whose `expires_at < now` to `EXPIRED`. For PAID, initiates mutual-refund flow (FR-015a).
- [ ] T129 [P] [US4] Add Playwright E2E `apps/platform/__tests__/us4-accept-decline.spec.ts`: dev-bypass login as both personas; verify the anonymous identifier shows pre-accept; accept and confirm the dashboard's pending count drops.

**Checkpoint**: the lawyer side of the supply funnel is complete. End-to-end happy path now requires only the consultation room to ship.

---

## Phase 7: User Story 5 — Consultation, E2EE chat, mark complete (Priority: P1) 🎯 MVP

**Goal**: both parties enter the consultation workspace, exchange ciphertext-only chat messages, and the client marks complete to release escrow. The transcript Merkle root anchors on chain at release.

**Independent Test**: with an accepted PAID consultation, open `/client/consultation/[id]` and `/lawyer/consultation/[id]`; send a chat message from one side, see it within 5 s on the other; click Mark Complete from the client side; sign one tx; verify `ProposalReleased` and `TranscriptAnchored` events fire and the consultation status flips to COMPLETED.

- [X] T130 [US5] Generate per-engagement P-256 keypair on first onboarding (client + lawyer): generated by `packages/crypto/src/ecdh.ts` in the browser; private half persisted to wallet-managed storage; public half registered via PATCH to `verified_users.message_pubkey`.
- [X] T131 [P] [US5] Implement `apps/platform/components/firmus/consultation-room.tsx`: dark-mode (`bg-navy-950`) shared workspace with video stub canvas, four controls (mute / camera / screen-share / hang-up — keyboard-reachable), chat panel on right, proposals panel on left, booking metadata strip top.
- [X] T132 [US5] Implement `apps/platform/app/(client)/consultation/[bookingId]/page.tsx` and `apps/platform/app/(lawyer)/consultation/[bookingId]/page.tsx`: thin wrappers around `consultation-room.tsx`. Server-side ownership check 404 on mismatch.
- [X] T133 [US5] Implement `apps/platform/app/api/messages/route.ts`: POST accepts ONLY `{conversationId, ciphertext_b64, iv_b64, salt_b64, signature, sender}` (zod schema rejects `plaintext`). Verifies signature against `sender`'s address. Verifies sender is a participant. Inserts ciphertext into `messages` with `transcript_leaf_hash`. GET `?conversationId=...` returns ciphertext envelopes.
- [X] T134 [P] [US5] Implement `apps/platform/components/firmus/chat-panel.tsx`: 5-second polling; client-side decrypt via ECDH-derived AES-GCM keys. Shows "Connect your wallet to view this conversation" when keys are unavailable (FR-040).
- [X] T135 [US5] Implement `apps/platform/components/firmus/proposals-panel.tsx`: per-proposal pill (state + ETH amount); action buttons keyed off state and role. For US5, only "Mark Complete" (client) is wired; other buttons reserved for US6+.
- [X] T136 [US5] Implement `apps/platform/app/api/consultations/[id]/complete/route.ts`: returns calldata for `releaseProposal(engagementId, 0)`. Idempotent on already-COMPLETED.
- [X] T137 [P] [US5] Indexer wires `ProposalReleased` for proposalIndex=0 → consultation status COMPLETED + `escrow_release_tx_hash`. `TranscriptAnchored` updates `engagements_off_chain.last_anchor_block`.
- [ ] T138 [P] [US5] Add Playwright E2E `apps/platform/__tests__/us5-consultation.spec.ts`: dev-bypass logins for both personas; send a message; verify it appears on the other side within 6 s; mark complete; verify status COMPLETED on both sides.
- [ ] T139 [P] [US5] Add vitest unit test `apps/platform/__tests__/messages-api.spec.ts`: server rejects POST with a `plaintext` field; server rejects POST from non-participant; server verifies signature mismatch.

**Checkpoint**: the full happy-path MVP slice (US1+US2+US3+US4+US5) ships. A demo can run end-to-end.

---

## Phase 8: User Story 6 — Lawyer sends a follow-up proposal (Priority: P1)

**Goal**: after the consultation (proposal index 0) releases, the lawyer issues additional **proposals** with line items and deliverables. Each proposal funds, delivers, and releases independently.

**Independent Test**: with an active engagement whose consultation has released, the lawyer fills line items + deliverables, signs the proposal, submits; client funds with one tx; lawyer marks delivered; client releases. Each transition is its own on-chain event.

- [ ] T140 [P] [US6] Implement `apps/platform/app/(lawyer)/proposals/[id]/page.tsx`: send-proposal form scoped to an active engagement. Line-item editor (each: hourly OR fixed; computes subtotal). Deliverables list editor. Computes total + 5% platform-fee preview.
- [ ] T141 [US6] Implement `apps/platform/app/api/proposals/route.ts`: POST `{engagementId, lineItems, deliverables, lawyerSignature, nonce}`. Verifies signature against engagement.lawyer; persists into `proposals_off_chain` with `kind='PROPOSAL'`. Inserts a system-bot message into the engagement's chat (signed by platform key, NOT E2EE — informational only).
- [ ] T142 [P] [US6] Implement `apps/platform/app/api/proposals/[engagementId]/[proposalIndex]/fund/route.ts`: returns calldata for `fundProposal(...)`. The lawyer's signed offer artifact is included in the calldata.
- [ ] T143 [P] [US6] Implement `apps/platform/app/api/proposals/[engagementId]/[proposalIndex]/mark-delivered/route.ts`: returns calldata for `markDelivered(...)`. Lawyer-only.
- [ ] T144 [P] [US6] Implement `apps/platform/app/api/proposals/[engagementId]/[proposalIndex]/release/route.ts`: returns calldata for `releaseProposal(...)`. Client-only.
- [ ] T145 [P] [US6] Update `proposals-panel.tsx` to render Accept-and-fund / Counter / Decline (client-side actions) + Mark Delivered (lawyer-side) + Release / Dispute (client-side). Buttons keyed by state and role per [data-model.md](./data-model.md#proposalsoff_chain).
- [ ] T146 [US6] Implement mutual-refund flow: `apps/platform/app/api/proposals/[engagementId]/[proposalIndex]/mutual-refund/initiate/route.ts` (records one party's signature) and `.../broadcast/route.ts` (returns calldata once both signatures are present, client OR lawyer broadcasts).
- [ ] T147 [P] [US6] Indexer wires `ProposalFunded`, `ProposalDelivered`, `ProposalReleased`, `ProposalRefunded` events → `proposals_off_chain` mirror updates.
- [ ] T148 [P] [US6] Add Playwright E2E `apps/platform/__tests__/us6-multi-proposal.spec.ts`: full proposal lifecycle Issued → Funded → Delivered → Released. Then a second proposal funded + mutually refunded.

**Checkpoint**: the multi-proposal narrative ships. Demos can show ongoing engagements with multiple billable units.

---

## Phase 9: User Story 7 — Operator resolves a dispute (Priority: P2)

**Goal**: the operator queues, reviews, and resolves disputed proposals with a contract-checked split.

**Independent Test**: produce a DISPUTED proposal (via either client-immediate dispute OR lawyer-cooldown-then-escalate); sign in as operator; open `/operator/disputes`; pick the row; enter a split that sums to the parked amount; sign resolve; verify funds move per the split.

- [X] T149 [US7] Implement `apps/platform/app/(operator)/layout.tsx`: gates `/operator/*` to `session.user.address === LegalEngagementEscrow.operator()`. 404 (not 403) on mismatch.
- [X] T150 [US7] Implement `apps/platform/app/(operator)/disputes/page.tsx`: queue table of all current `Disputed` proposals (engagement, proposal index, parked amount, filed by, filed at).
- [X] T151 [US7] Implement `apps/platform/app/(operator)/disputes/[engagementId]/[proposalIndex]/page.tsx`: detail view per spec US7 acceptance scenario 2. Resolution form (two ETH inputs with sum-equality client-side validation; explicit "Evidence section" line).
- [X] T152 [P] [US7] Implement `apps/platform/app/api/disputes/[engagementId]/[proposalIndex]/file/route.ts`: returns calldata for `disputeProposal(...)`. Client-only.
- [X] T153 [P] [US7] Implement `apps/platform/app/api/disputes/[engagementId]/[proposalIndex]/escalate/route.ts`: returns calldata for `escalateProposal(...)`. Lawyer-only. UI must show countdown until cooldown elapses.
- [X] T154 [P] [US7] Implement `apps/platform/app/api/operator/disputes/route.ts`: GET lists all disputed proposals; gated to operator address.
- [X] T155 [P] [US7] Implement `apps/platform/app/api/operator/disputes/[engagementId]/[proposalIndex]/resolve/route.ts`: returns calldata for `resolveDispute(...)`. The form pre-validates sum-equality before broadcast; the contract enforces too.
- [ ] T156 [P] [US7] Indexer wires `ProposalDisputed`, `ProposalResolved` events → `disputes_off_chain` mirror updates.
- [ ] T157 [P] [US7] Add Playwright E2E `apps/platform/__tests__/us7-dispute.spec.ts`: client-immediate dispute path; operator resolves with 50/50 split; assert funds moved. Lawyer-cooldown path uses `POST /api/dev/skip-time` to advance Anvil 30 days, then escalate, then resolve.

**Checkpoint**: the asymmetric mechanism is demonstrably end-to-end. Funds are never stranded.

---

## Phase 10: User Story 8 — Lawyer self-service: dashboard + profile editor (Priority: P2)

**Goal**: lawyers manage their dashboard (4 stats + today's schedule + recent requests + active disputes when > 0) and edit their public profile with a live preview, including an avatar image upload.

**Independent Test**: as a verified lawyer, open `/lawyer/dashboard`; verify the four stat cards render; open `/lawyer/profile/edit`; change a field; verify the live preview updates without saving; click Save; reload the public profile; verify the change is live; upload an avatar image; verify it appears at the correct sizes on the dashboard, profile, and directory card.

- [ ] T158 [US8] Expand `apps/platform/app/(lawyer)/dashboard/page.tsx` with the full four-stat-card layout + today's-schedule strip + recent-requests panel + (conditional) active-disputes card. Computes stats in one parallel `Promise.all` per FR-048.
- [ ] T159 [US8] Implement `apps/platform/app/(lawyer)/profile/edit/page.tsx`: tabbed editor (Basics / Pricing / Specialties & Languages / Availability / Tags) + live preview pane mirroring `/lawyers/[id]` for editable fields. Sticky save bar.
- [ ] T160 [P] [US8] Implement `apps/platform/app/(lawyer)/profile/edit/profile-editor.tsx`: client component holding form state; live preview is a child component re-rendering on form-state change.
- [ ] T161 [US8] Implement avatar widget on the editor's About tab: drag-and-drop file picker with content-type + size validation (≤ 5 MB; JPG / PNG / WebP).
- [ ] T162 [US8] Implement `apps/platform/app/api/lawyer/avatar/route.ts`: POST multipart upload. Validates `content-type` ∈ allow-list, size ≤ 5 MB, owner check, `hasCapability` re-check. Transcodes via `sharp` to two WebP variants (480 px / 192 px square, center-cropped, quality 85). Stores at `apps/platform/data/uploads/avatars/<userId>/<contentHash>-{profile,card}.webp`. Updates `lawyer_profiles.avatar_url`. DELETE clears it.
- [ ] T163 [P] [US8] Implement `apps/platform/app/uploads/avatars/[userId]/[filename]/route.ts`: public-readable serve with `Content-Type: image/webp`, `Cache-Control: public, max-age=86400`.
- [ ] T164 [P] [US8] Update `AvatarBubble` (T054) to read `imageUrl` from the lawyer's `avatar_url` and append the variant suffix based on the `size` prop.
- [ ] T165 [P] [US8] Add Playwright E2E `apps/platform/__tests__/us8-self-service.spec.ts`: dev-bypass login as a lawyer; edit the bio; save; verify the public profile updates. Upload an avatar; verify it appears on the directory grid + the profile page.

**Checkpoint**: lawyers can self-serve. The directory has personalized profiles end-to-end.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: production-trajectory affordances, error handling, accessibility, demo polish.

- [ ] T166 [P] Implement `<ChainUnavailableBanner>` rendering on every funds-touching surface when `/api/chain-health` returns `healthy: false` (FR-060). Banner copy: "Secure payment network is temporarily unavailable — please try again in a moment."
- [ ] T167 [P] Implement state-changed handler for tx-revert-due-to-stale-state: parse the contract revert reason; surface "state changed — please reload" instead of a generic failure (FR-059).
- [ ] T168 [P] Add ARIA attributes + keyboard navigation tests across the consultation room, the role stepper, and the operator dispute detail (Constitution VI accessibility rule + spec SCs).
- [X] T169 [P] Add the persistent "Dev mode" banner component to the platform's root layout when `DEV_BYPASS_EUDI=1` (FR-D03). Gold pill, never dismissable.
- [ ] T170 [P] Implement `scripts/deploy.sh`: orchestrates `forge script` deployment to local Anvil + writes `apps/platform/lib/chain/addresses.ts`.
- [ ] T171 [P] Implement `scripts/seed.sh`: shells out to `apps/issuer/scripts/seed.ts`.
- [ ] T172 [P] Implement `scripts/start-all.sh` and `scripts/start-all-ngrok.sh`: orchestrate Anvil + the three apps + (optionally) ngrok in one terminal.
- [ ] T173 [P] Add a brand-mention CI gate run on every PR; document its allow-list in `scripts/check-brand-mentions.sh` source.
- [ ] T174 [P] Document quickstart troubleshooting at the bottom of `quickstart.md` for each common failure mode (already drafted; verify after implementation lands).
- [ ] T175 [P] Add empty-state copy across the platform: empty directory ("No matching counsel."), empty inbox ("No pending requests."), empty conversation ("No messages yet — start with a hello."), empty dispute queue ("No active disputes — the platform is healthy.").
- [ ] T176 [P] Verify constitutional brand discipline post-implementation: run `scripts/check-brand-mentions.sh` and ensure exactly one mention of the public brand name in user-visible places (only spec / plan title lines).
- [ ] T177 [P] Re-run all CI gates locally: `forge test`, `pnpm test`, `pnpm madge --circular apps/platform/`, `scripts/check-feature-isolation.sh`, `scripts/check-no-server-decryption.sh`, `scripts/check-isolation.sh`. All must pass.
- [ ] T178 Update `README.md` at the repo root with the project overview, the quickstart link, the CLAUDE.md pointer, and the "trunk-only branching" note.

---

## Dependencies

### Blocking

- **Phase 1 (Setup)** blocks **everything**.
- **Phase 2 (Foundational)** blocks every user-story phase. Within Phase 2:
  - T019 → T021 → T023 (contracts before deploy script)
  - T030, T031 → T033, T034 (chain bindings before health probe + indexer)
  - T040, T042 → T041 (issuer schema + keys before seed)
  - T044 → T045–T051 (platform schema before per-feature data access)
  - T067 → T068 → T069–T072 (persona fixtures before bypass guard before bypass routes)

### Story Order

- **US1, US2 are independently developable after Phase 2.** US1 can ship with just the directory; US2 ships the lawyer-side onboarding. They exercise different code paths (read-only vs. write-heavy).
- **US3 depends on US2** (a verified lawyer must exist before a client can book one). In practice both teams develop in parallel using dev-bypass to seed the other side.
- **US4 depends on US3** (must have a REQUESTED consultation to accept).
- **US5 depends on US4** (must have an ACCEPTED consultation to release).
- **US6 depends on US5** (proposals only meaningful inside an active engagement).
- **US7 is independent of US6** (disputes can fire on the consultation proposal directly). Functionally depends on US3 (a fundable consultation).
- **US8 is independent of US3–US7** (lawyer dashboard + profile editor only require US2). Can be developed in parallel with US3–US7.

### Within-Story Parallelism

Inside each user-story phase, tasks marked `[P]` can run concurrently because they touch distinct files. Examples:

- US1: T078, T079, T083, T086, T087, T088 are all [P] — different components / tests.
- US2: T090, T092, T094, T096 (issuer side); T099, T100, T102, T104 (verifier side) — independent files.
- US5: T131, T134, T135, T138, T139 are [P] — UI components and tests.
- US8: T160, T163, T164, T165 are [P] — different files.

## Parallel Execution Examples

**MVP slice (US1 + US2 + US3 + US4 + US5) sprint cadence**:

After Phase 2 completes, two devs can run in parallel:

- Dev A: US1 (T078–T088) → US3 client side (T111–T120) → US5 client side (T130, T132, T134, T136)
- Dev B: US2 lawyer onboarding (T089–T110) → US4 (T121–T129) → US5 lawyer side (T131, T135, T137)

Final merge before US5 happens at T138/T139 (E2E tests touch both sides).

**Independent parallel streams** (after MVP slice ships):

- Stream X: US6 multi-proposal (T140–T148)
- Stream Y: US7 dispute resolution (T149–T157) — uses US3's funded consultations as test fixtures
- Stream Z: US8 self-service (T158–T165)

These three streams touch independent feature directories and can land in any order.

## Implementation Strategy

**MVP first (Phases 1–7, US1–US5)**: a client onboards, books and pays for a consultation with a verified lawyer, both meet in the encrypted workspace, the client marks complete and funds release. This is the demo's primary narrative arc and exercises every constitutional invariant once.

**Increment 1 (Phase 8, US6)**: multi-proposal demo. After the consultation, the lawyer issues additional billable proposals — the client funds each, the lawyer delivers, the client releases. Surfaces the platform's "ongoing relationship" story.

**Increment 2 (Phase 9, US7)**: dispute resolution. The asymmetric mechanism becomes visible end-to-end — client immediate dispute, lawyer 30-day cooldown (using anvil time-skip on stage), operator-as-arbiter resolves with a contract-checked split.

**Increment 3 (Phase 10, US8)**: lawyer self-service polish. Dashboard stats, profile editor with live preview, avatar upload. Independent of the engagement engine; can ship anywhere after Phase 2.

**Polish (Phase 11)**: error handling, accessibility, dev banner, scripts, README. Lands as PRs roll in across the increments.

## Format validation

All 178 tasks follow the strict checklist format:

- ✅ Every task starts with `- [ ]`.
- ✅ Every task has a sequential ID (T001..T178) in execution order.
- ✅ `[P]` markers are present on parallelizable tasks (different files, no incomplete dependencies).
- ✅ `[USx]` story labels are present for all Phase 3–10 tasks; absent for Phase 1, 2, 11.
- ✅ Every description names the target file path or directory.

## Suggested MVP Scope

**Phases 1 + 2 + 3 + 4 + 5 + 6 + 7** (Setup + Foundational + US1 + US2 + US3 + US4 + US5).

This is everything from project init through the full happy-path arc: a client onboards, books a paid consultation, the lawyer accepts, both meet in the E2EE workspace, the client marks complete, escrow releases. ~138 tasks. Demo-complete at this checkpoint.

US6 (multi-proposal), US7 (disputes), US8 (self-service polish) are increments on top.
