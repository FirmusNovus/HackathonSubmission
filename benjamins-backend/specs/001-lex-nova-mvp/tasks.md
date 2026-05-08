---
description: "Task list for implementation of the Lex Nova MVP"
---

# Tasks: Lex Nova MVP — Verified-Pseudonymous Legal Engagement

**Input**: Design documents from `/specs/001-lex-nova-mvp/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Targeted only — Foundry contract tests for the asymmetric-mechanism invariants the constitution names as testable, plus vitest for the crypto and credential code paths the privilege boundary depends on. No full-TDD across the UI surface.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. The platform starts empty. Phase 3 (US2 lawyer onboarding) gates Phase 4 (US1 client engagement, the MVP demo path) because US1 needs at least one verified lawyer to engage with.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1 / US2 / US3 / US4 / US5)
- File paths are absolute from the repo root

## Path Conventions (per [plan.md](plan.md))

Single Next.js application at the repository root. Solidity contracts live as a sibling Foundry package at `contracts/`. Noir circuit lives at `circuits/`. Spike reference at `docs/spike/wallet-integration/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization. Create skeletons, install toolchains, configure tooling.

- [X] T001 Initialize Next.js 14 project at repo root with App Router + TypeScript + Tailwind. **Note**: `pnpm create next-app .` refused due to `.claude/`, `.specify/`, `specs/` being present; scaffolded manually instead — `package.json`, `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`, `next-env.d.ts`. Verified with `pnpm exec tsc --noEmit` (clean).
- [X] T002 [P] Install shadcn/ui CLI and bootstrap base components. Manually wrote `components.json` + `lib/utils.ts` (`cn()`) so `shadcn add` skipped interactive init. Added 14 components under `components/ui/`: `button card dialog table badge form input label sonner separator avatar skeleton tabs alert`.
- [X] T003 [P] Initialize Foundry project at `contracts/`. Used `forge init contracts --no-git` (the `--no-commit` flag was removed in Foundry 1.7.0; default behaviour is now no-commit). Installed `OpenZeppelin/openzeppelin-contracts@v5.2.0` and `ethereum-attestation-service/eas-contracts@v1.4.0`. Pinned Solidity 0.8.28, EVM `cancun`, optimizer 200 in `contracts/foundry.toml`. Wrote `contracts/remappings.txt`. `forge build` compiles cleanly.
- [X] T004 [P] Initialize Noir circuit at `circuits/` via `nargo new circuits`. Pinned Noir 1.0.0-beta.20 (matches installed `nargo --version`). `nargo check` passes.
- [X] T005 [P] Wrote full runtime + dev dep list into `package.json` and ran `pnpm install` (26.6s). Note: `@noir-lang/noir_js` + `@aztec/bb.js` deferred to Phase 6 (US4) — they pull a ~50 MB WebAssembly artifact that's only needed when the circuit is wired in. Captured in a `comment_zk_deps` field on `package.json`.
- [X] T006 [P] Wrote `.eslintrc.json` (Next.js core-web-vitals + ignores for contracts/circuits/spike/data), `.prettierrc` (with `prettier-plugin-tailwindcss` and `cn`/`clsx`/`cva` tailwind functions), `.prettierignore`, `contracts/.solhint.json` (extends `solhint:recommended`, pins compiler 0.8.28), `contracts/.solhintignore`. `pnpm lint` script already in `package.json`.
- [X] T007 Wrote `.env.example` with all keys (`PUBLIC_HOSTNAME`, `OPERATOR_PRIVATE_KEY` defaulted to anvil account 0, `RPC_URL`, `CHAIN_ID=31337`, `DATABASE_PATH`). Replaced the one-line `.gitignore` (which had only `node_modules`) with the full set covering `.next/`, `contracts/out/`, `contracts/cache/`, `contracts/broadcast/`, `circuits/target/`, `data/`, `lib/chain/deployed-addresses.json`, all `.env*` variants, IDE dirs, and the OS detritus.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Everything every user story needs before any can be implemented — DB schema, viem clients, SIWE auth, Solidity contracts, Foundry tests for the asymmetric mechanism, deploy script, persona seed (issuer-side knowledge only, no on-chain attestations), shared crypto + credential SDK helpers, event indexer.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Database + chain plumbing

- [X] T008 Create SQLite schema migration at `lib/db/migrations/001_initial.sql` defining all tables from [data-model.md § Off-chain entities](data-model.md): `personas`, `bar_credential_attributes`, `pid_attributes`, `verified_users` (with composite PK on `(eth_address, attested_role)`), `matters`, `engagement_proposals`, `engagement_off_chain`, `messages`, `conflict_commitments`. Include all CHECK constraints listed in data-model.md.
- [X] T009 Implement `lib/db/index.ts` exposing a singleton better-sqlite3 connection plus a migration runner that idempotently applies any new SQL files in `lib/db/migrations/` on app boot.
- [X] T010 [P] Implement `lib/chain/clients.ts` (viem `createPublicClient` + factory for `createWalletClient(account)`, both targeting `RPC_URL` / `CHAIN_ID`).
- [X] T011 [P] Implement `lib/chain/addresses.ts` skeleton exporting empty constants for `ATTESTATION_MANAGER_ADDRESS`, `LEGAL_ENGAGEMENT_ESCROW_ADDRESS`, `ZK_VERIFIER_ADDRESS`, `EAS_ADDRESS`, `SCHEMA_REGISTRY_ADDRESS`, `SCHEMA_LAWYER`, `SCHEMA_CLIENT`, `SCHEMA_ARBITER`. Populated by the deploy script in T018.

### Auth (SIWE)

- [X] T012 [P] Implement `lib/siwe/index.ts` — nonce generator (32-byte CSPRNG), SIWE message builder (EIP-4361), signature verifier using `siwe@^2`.
- [X] T013 [P] Implement SIWE route handlers: `app/api/auth/siwe/nonce/route.ts` (GET → `{nonce}`, stores to short-lived cookie), `app/api/auth/siwe/verify/route.ts` (POST → verifies, sets session cookie binding the address), `app/api/auth/siwe/logout/route.ts` (POST → clears cookie). Cookie helpers in `lib/siwe/session.ts`.

### Smart contracts

- [X] T014 Implement `contracts/src/AttestationManager.sol` per [contracts/solidity-surface.md § AttestationManager](contracts/solidity-surface.md). Constructor takes EAS + SchemaRegistry addresses; registers the three schemas from [contracts/eas-schemas.md](contracts/eas-schemas.md) and stores their UIDs in immutable variables. Implement `attestVerifiedLawyer`, `attestVerifiedClient`, `attestVerifiedArbiter` (with `onlyLawyerHolder(subject)` modifier), `revokeCapability`, `hasCapability`. Emit `Attested` and `Revoked` events.
- [X] T015 Implement `contracts/src/LegalEngagementEscrow.sol` per [contracts/solidity-surface.md § LegalEngagementEscrow](contracts/solidity-surface.md). All modifiers wired (`onlyVerifiedClient`, `onlyVerifiedLawyer`, `onlyVerifiedArbiter`, `onlyEngagementClient`, `onlyEngagementLawyer`, `onlyEngagementParty`, `onlyClaimingArbiter`, `cooldownElapsed`). `LAWYER_DISPUTE_COOLDOWN = 30 days` as a constant. Funds movement uses native ETH (per [research.md Decision 5](research.md)). Emit all events from [data-model.md § events](data-model.md). Depends on T014.
- [X] T016 Implement stub `contracts/src/StubZKConflictVerifier.sol` whose `verifyProof` returns `true` unconditionally. Stays in place until US4 replaces it with the bb-generated real verifier. Wire `LegalEngagementEscrow` to use this address from T015's constructor.
- [X] T017 [P] Foundry tests at `contracts/test/AttestationManager.t.sol`: capability grant/revoke flow; `onlyOperator` rejection from non-operator; `onlyLawyerHolder` rejection when promoting an address that lacks `verified_lawyer`; `hasCapability` returns false after revocation.
- [X] T018 [P] Foundry tests at `contracts/test/LegalEngagementEscrow.t.sol` covering the invariants in [contracts/solidity-surface.md § Invariants tested in forge test](contracts/solidity-surface.md): client immediate dispute; lawyer escalation reverts at `cooldown - 1` and succeeds at `cooldown`; non-claiming arbiter cannot resolve a claimed dispute (even if also `verified_arbiter`); `resolveDispute` total equals `milestone.amount` to the wei; operator (no `verified_arbiter`) cannot resolve; refund returns exactly `amount`; `closeEngagement` reverts with non-terminal milestones; post-close calls revert.
- [X] T019 Implement Foundry deploy script at `contracts/script/Deploy.s.sol`: deploys EAS + SchemaRegistry locally on Anvil (or references canonical Base Sepolia addresses when `--rpc-url` is testnet); deploys `AttestationManager`, `StubZKConflictVerifier`, `LegalEngagementEscrow`; registers the three EAS schemas; emits a JSON file at `lib/chain/deployed-addresses.json` with all addresses + UIDs that `lib/chain/addresses.ts` reads at app boot.
- [X] T020 Add `pnpm scripts:deploy` and `pnpm scripts:reset` entries to `package.json`. `scripts:deploy` runs `forge script contracts/script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --private-key $OPERATOR_PRIVATE_KEY`. `scripts:reset` kills anvil, restarts it, redeploys, reseeds personas.

### Persona staging (issuer-side knowledge only — no on-chain attestations)

- [X] T021 Implement `scripts/seed-personas.ts` — derives 10 anvil accounts from the standard mnemonic; inserts persona rows in `personas` + `bar_credential_attributes` + `pid_attributes` (so when, e.g., Anna's wallet asks for a bar credential the issuer knows what attributes to embed); generates per-persona card-art SVGs at `public/card-art/<persona>.svg`; generates `did:key` keypairs for the bar issuer and PID issuer at `data/issuers/bar.jwk` and `data/issuers/pid.jwk`. **The platform starts empty**: no `verified_users` rows are written, no on-chain attestations are issued. Each persona must onboard via the real OID4VP flow (lawyers in Phase 3, clients in Phase 4) to land on the platform's verified-user surface and on chain. Eva's `verified_arbiter` capability is granted via the operator UI in Phase 7 (US5).
- [X] T022 Add `pnpm scripts:seed-personas` entry to `package.json` and document the boot order in `README.md`: anvil → deploy → seed-personas → next dev → onboard each persona one at a time.

### Shared crypto + credentials SDK

- [X] T023 [P] Implement `lib/crypto/ecdh.ts` (browser-targeted; uses WebCrypto). Functions: `generateP256Keypair()`, `deriveSharedSecret(myPriv, theirPub)`, `hkdf(secret, salt, info, length)`, `aesGcmEncrypt(key, iv, plaintext, aad)`, `aesGcmDecrypt(key, iv, ciphertext, aad)`. No corresponding server-side helper — server has no decryption capability (Constitution Inv-1).
- [X] T024 [P] Implement `lib/crypto/merkle.ts` — incremental Merkle tree, depth 16, SHA-256, supports `append(leaf)` and `currentRoot()`. Pure-JS, runs anywhere.
- [X] T025 [P] Implement `lib/crypto/sign.ts` — ECDSA secp256k1 sign + verify helpers wrapping viem's `signMessage` / `verifyMessage`, used to sign engagement proposals/counters and message envelopes.
- [X] T026 [P] Vitest unit tests at `lib/crypto/__tests__/ecdh.test.ts` and `lib/crypto/__tests__/merkle.test.ts` covering ECDH determinism, HKDF vector reproduction, AES-GCM round-trip, and Merkle root determinism.
- [X] T027 [P] Implement `lib/credentials/sd-jwt.ts` — parse SD-JWT VC envelope (header + payload + selective disclosures + KB-JWT); verify JWS via `jose` against issuer JWKS; verify each disclosure digest; verify KB-JWT against `cnf.jwk`; check KB-JWT `aud` matches expected `client_id`. Adapted from the spike's verification code at [docs/spike/wallet-integration/verifier.mjs](../../docs/spike/wallet-integration/verifier.mjs).
- [X] T028 [P] Implement `lib/credentials/dcql.ts` — DCQL query builder + selective-disclosure result extractor. Two named query builders: `buildBarDcql()` and `buildPidDcql()` returning the JSON shapes from [contracts/credential-shapes.md § DCQL queries used by the verifier](contracts/credential-shapes.md).
- [X] T029 [P] Vitest tests at `lib/credentials/__tests__/sd-jwt.test.ts` using fixtures captured from the spike's recorded successful presentations.

### Verifier infrastructure (cert + request_object plumbing, used by both onboarding flows)

- [X] T030 Implement `lib/verifier/x509.ts` — at boot, generates a self-signed RSA cert for `PUBLIC_HOSTNAME` via `openssl` child process if `data/verifier/cert.pem` is absent; persists alongside the private key. Exports the cert fetch helper and the `client_id = x509_san_dns:<PUBLIC_HOSTNAME>` builder.
- [X] T031 Implement `lib/verifier/request-object.ts` — builds the signed JWS `request_object` for an OID4VP request (DCQL inside), with `client_id`, `client_id_scheme="x509_san_dns"`, `response_uri`, `nonce`, embedded `x5c`. Signs with the verifier cert's RSA key.
- [X] T032 Implement `lib/verifier/vp-token.ts` — parses the `vp_token` returned from the wallet, handling both string and array shapes (validated wwWallet quirk). Returns the SD-JWT VC bytes for downstream verification.
- [X] T033 Implement `app/api/verifier/x509-cert.pem/route.ts` (GET serves the cert PEM with `Cache-Control: no-store`).
- [X] T034 Implement `app/api/verifier/request/route.ts` (POST creates a presentation request keyed by `kind ∈ {bar, pid}`, persists state in SQLite, returns the `openid4vp://` deep link).
- [X] T035 Implement `app/api/verifier/request/[state]/object/route.ts` (GET returns the signed `request_object`; sends `Cache-Control: no-store`).
- [X] T036 Implement `app/api/verifier/response/[state]/route.ts` (POST receives the wallet's `vp_token`, parses both shapes, runs SD-JWT VC verification, persists the verified attribute subset, marks the state as ready). Does NOT yet write the EAS attestation — that happens in the story-specific finalization step (T059 for client / T045 for lawyer) so the disclosed-attribute filter for each role can apply.
- [X] T037 Implement `app/api/verifier/result/[state]/route.ts` (GET returns 200+verified attrs / 202 pending / 4xx fail; used by the browser to poll).

### Issuer plumbing (used by both onboarding flows; per-role config in US1 / US2)

- [X] T038 [P] Implement `lib/issuers/common.ts` — shared SD-JWT VC issuance: builds `_sd` digests, signs JWS with the role-specific `did:key`, includes `cnf.jwk` from the wallet's proof. Per [contracts/credential-shapes.md](contracts/credential-shapes.md). `iss` is the HTTPS URL (not the did:key) — validated wwWallet quirk.
- [X] T039 [P] Implement OID4VCI route shells at `app/api/issuer/_lib/` — pre-auth code minting, DPoP nonce + verification, batch credential issuance handler (accepts `proofs.jwt[]`). Concrete per-role mounts come in US1 and US2.

### Event indexer + base layout + wallet UI

- [X] T040 [P] Implement `lib/chain/indexer.ts` — viem `watchContractEvent` listeners for `Attested`, `Revoked`, `EngagementOpened`, `MilestoneFunded/Delivered/Released/Disputed/ClaimedByArbiter/Resolved/Refunded`, `TranscriptAnchored`, `EngagementClosed`. Each handler updates the appropriate SQLite mirror. Started from `app/_indexer/start.ts`, kicked off once at app boot.
- [X] T041 [P] Implement `app/layout.tsx` — root layout with shadcn theme + Tailwind globals + WagmiProvider with anvil chain config. Add `components/ConnectWallet.tsx` exposing a Connect/Disconnect button that opens injected wallet selection.
- [X] T042 Implement `middleware.ts` (Next.js middleware) — redirects unauthenticated requests to gated routes (`/client/*`, `/lawyer/*`, `/arbiter/*`, `/operator/*`, `/onboarding/*`) to `/?connect=true`. Reads the SIWE session cookie set in T013.

**Checkpoint**: Foundation ready. The platform starts with zero attested users. Phase 3 (US2 lawyer onboarding) is the next executable step because Phase 4 (US1 client engagement) needs at least one attested lawyer to engage with.

---

## Phase 3: User Story 2 - Lawyer onboards via verifiable bar credential and is attested on-chain (Priority: P1) — gates Phase 4 (the MVP demo path)

**Goal**: A practicing lawyer connects → fetches a bar credential from the bar-association issuer (stand-in) → presents it from their wallet → receives an on-chain `verified_lawyer` attestation → appears in the directory. Each of the 5 lawyer personas (Anna, Carlos, Dieter, Sofia, Eva) goes through this flow on a clean platform — no pre-staged attestations exist. See [spec.md User Story 2](spec.md#user-story-2---lawyer-onboards-via-verifiable-bar-credential-and-is-attested-on-chain-priority-p1).

**Independent Test**: A fresh wallet (e.g., anvil account 7) with no prior attestation can run end-to-end onboarding (connect → fetch bar credential from the issuer stand-in → present → see the attestation written → see themselves in the directory) without any reference to client-side flows from US1.

### Bar credential issuance

- [X] T043 [P] [US2] Implement bar issuer metadata + token + credential routes: `app/api/issuer/bar/.well-known/openid-credential-issuer/route.ts` (advertising `urn:lex-nova:LegalProfessionalAccreditation` with `batch_credential_issuance.batch_size=5` and `display.background_image.uri=/api/issuer/bar/card-art/[persona].svg`), `app/api/issuer/bar/.well-known/jwks.json/route.ts`, `app/api/issuer/bar/credential-offer/route.ts`, `app/api/issuer/bar/token/route.ts`, `app/api/issuer/bar/credential/route.ts`. All metadata responses include `Cache-Control: no-store`. Persona bar attributes pulled from `bar_credential_attributes`.
- [X] T044 [P] [US2] Implement `app/api/issuer/bar/card-art/[persona]/route.ts` — serves the per-persona SVG generated by the seed step.
- [X] T045 [US2] Implement `app/onboarding/lawyer/page.tsx` — connect → SIWE → "Get bar credential" (issuer pre-auth deep link) → wallet returns → "Present bar credential" (verifier `kind=bar`) → poll `/api/verifier/result/:state`.

### Bar attestation finalization (with operator review step satisfying the TIR-equivalent gate per [research.md Decision 9](research.md))

- [X] T046 [US2] Implement `app/api/onboarding/lawyer/finalize/route.ts` — reads the verified bar disclosure; extracts `(jurisdiction, practiceArea, credential_issued_at, credential_expires_at)`; the route schema rejects any other key; inserts `verified_users` row with `attested_role='lawyer'`; calls `AttestationManager.attestVerifiedLawyer(subject, jurisdiction, practiceArea, issuedAt, expiresAt)` from the operator wallet to write the on-chain attestation.
- [X] T047 [US2] End-to-end smoke test: walk all 5 lawyer personas through the onboarding flow against a freshly-reset platform. Confirm that after each one completes, `hasCapability(<address>, SCHEMA_LAWYER)` returns true on chain and the lawyer appears in the directory. The test is manual at this point (no Playwright); record any consistency issues for a future automated test pass.

### Public lawyer profile pages

- [X] T048 [P] [US2] Implement `app/(public)/lawyers/[address]/page.tsx` — public profile showing only the disclosed practising attributes; lawyers' other engagements + clients are NOT visible (FR-030).

**Checkpoint**: At least one verified lawyer exists in the directory. Phase 4 (US1 client engagement, the MVP demo path) is now unblocked.

---

## Phase 4: User Story 1 - Pseudonymous client engages a verified lawyer with milestone-based escrow (Priority: P1) 🎯 MVP (depends on Phase 3 lawyer onboarding completing first)

**Goal**: Marta (a verified-pseudonymous client) lands → connects → onboards via PID → posts a matter → picks a lawyer (one who has completed Phase 3 onboarding) → sends an engagement request → receives the lawyer's signed first-milestone proposal → funds it → exchanges encrypted messages → accepts delivery → releases. End-to-end happy path of [spec.md User Story 1](spec.md#user-story-1---pseudonymous-client-engages-a-verified-lawyer-with-milestone-based-escrow-priority-p1).

**Independent Test**: With at least one lawyer attested via Phase 3, a fresh client wallet (anvil account 6) can complete the full flow above against a single running instance, ending with funds released to a lawyer account. The lawyer's persisted view of the client contains only the disclosed-attribute subset (FR-029, SC-006).

### Client onboarding (PID issuance + presentation)

- [X] T049 [P] [US1] Implement PID issuer metadata + token + credential routes: `app/api/issuer/pid/.well-known/openid-credential-issuer/route.ts` (advertising `urn:eudi:pid:1`), `app/api/issuer/pid/.well-known/jwks.json/route.ts`, `app/api/issuer/pid/credential-offer/route.ts`, `app/api/issuer/pid/token/route.ts`, `app/api/issuer/pid/credential/route.ts`. All metadata responses include `Cache-Control: no-store`. Persona PID attributes pulled from `pid_attributes` table.
- [X] T050 [US1] Implement `app/onboarding/client/page.tsx` — flow: connect wallet → SIWE → "Get PID" button (triggers PID credential-offer) → wallet returns to platform → "Present PID" button (triggers OID4VP request kind=`pid`) → poll `/api/verifier/result/:state`.
- [X] T051 [US1] Implement client-attestation finalization at `app/api/onboarding/client/finalize/route.ts` — reads the verified PID disclosure, filters to the disclosed-attribute subset (`given_name`, `family_name`, `nationalities`, `age_equal_or_over_18`, `country_of_residence`), inserts a `verified_users` row with `attested_role='client'`, calls `AttestationManager.attestVerifiedClient` from the operator wallet to write the on-chain attestation. Server-side schema validator rejects any extra disclosed key (FR-003).

### Matter posting

- [X] T052 [P] [US1] Implement `app/api/matters/route.ts` (POST creates matter — body validated against zod schema that explicitly rejects an `amount` field per FR-008) and `GET /api/matters/mine` returning the caller's matters.
- [X] T053 [P] [US1] Implement `app/(client)/matters/page.tsx` — list existing matters + "Post new matter" form (description, target jurisdiction, target practice area; no amount field).

### Lawyer directory + engagement request

- [X] T054 [P] [US1] Implement `app/lawyers/page.tsx` — public directory page reading from `verified_users` filtered to `attested_role='lawyer'`. Each lawyer card shows the disclosed practising attributes only — never the underlying credential payload (FR-030). **Pulled forward to Phase 3** because T047's smoke test ("the lawyer appears in the directory") needs the listing. Filter UI for jurisdiction/practice-area deferred to Phase 4 polish.
- [X] T055 [US1] Implement `app/api/engagements/request/route.ts` — POST `{matter_id, lawyer_address}` (no amount, per FR-010). Verifies caller is the matter owner; verifies lawyer holds `verified_lawyer` via `hasCapability`. Creates a row in a new `engagement_requests` table (add migration `lib/db/migrations/002_requests.sql` with columns `id, matter_id, client_address, lawyer_address, status, created_at`).

### Engagement handshake (lawyer-side)

- [X] T056 [P] [US1] Implement `app/(lawyer)/inbox/page.tsx` — lawyer sees pending engagement requests. Each request shows the matter description + the disclosed-attribute subset of the client (no extra info). Actions: Decline / Propose first milestone.
- [X] T057 [US1] Implement lawyer-side propose route `app/api/engagements/[requestId]/propose/route.ts` — accepts `{amount_wei, note?, signature}`. Server verifies the signature against the lawyer's address (using `lib/crypto/sign.ts`) before persisting to `engagement_proposals` (FR-011). Subsequent counters use `app/api/engagements/[requestId]/counter/route.ts` and behave symmetrically.

### Engagement handshake (client-side fund) — uses stub ZK verifier from Foundational

- [X] T058 [US1] Implement `app/(client)/engagements/[requestId]/page.tsx` — client sees the lawyer's signed proposal chain. Actions: Accept (fund) / Counter / Decline. The Accept action submits a transaction via wagmi to `LegalEngagementEscrow.openEngagementAndFundFirstMilestone(...)` with `zkConflictProof = "0x"` and `zkNullifier = bytes32(0)` (stub verifier returns true regardless — replaced by real verifier in US4).
- [X] T059 [US1] Implement `app/api/engagements/[requestId]/fund-calldata/route.ts` — server returns the transaction calldata + the engagement's initial transcript root (Merkle root over all engagement_proposals leaves) so the wallet can broadcast. Server-side never holds the client's private key.
- [X] T060 [US1] Add an indexer hook (extending T040) — when `EngagementOpened` is observed, freeze the `engagement_proposals` chain (mark all but head as `superseded_by`), copy the chain into the engagement's initial transcript leaves, and create `engagement_off_chain` row.

### Encrypted messaging

- [X] T061 [P] [US1] Implement `lib/messaging/transport.ts` (browser-side) — high-level `sendMessage(engagementId, plaintext)` that derives the master key from the per-engagement P-256 key pair, encrypts via `lib/crypto/ecdh.ts`, signs the envelope, POSTs to `/api/engagements/[id]/messages`. Mirror `receiveMessage(envelope)` for decryption.
- [X] T062 [P] [US1] Implement per-engagement P-256 keypair management in `lib/messaging/engagement-keys.ts` — each party generates their P-256 keypair on engagement open (separate from the secp256k1 wallet key); the public key is stored in `verified_users.disclosed_attrs` keyed by engagement (or in a new `engagement_messaging_keys` table — add migration `003_messaging_keys.sql`); the counterparty fetches it from there.
- [X] T063 [US1] Implement `app/api/engagements/[id]/messages/route.ts` — POST accepts `{ciphertext_b64, iv_b64, salt_b64, signature, sender, createdAtClient}`. Verifies signature against `sender`'s known address (FR-024). Appends to per-engagement Merkle tree (in memory; root persisted in `engagement_off_chain`). Persists to `messages`. The route MUST NOT accept any plaintext field — zod schema explicitly forbids it (FR-023).
- [X] T064 [US1] GET `/api/engagements/[id]/messages` returns the ciphertext envelopes (with leaf indices, signatures); the browser decrypts client-side via `lib/messaging/transport.ts`.
- [X] T065 [US1] Implement `app/(client)/engagements/[id]/page.tsx` and `app/(lawyer)/engagements/[id]/page.tsx` — engagement detail with milestone list + chat panel (uses shadcn `Card` for messages). The chat panel surfaces a clear "Connect your wallet to view" state when no key material is available client-side (FR-026).

### Milestone iteration: deliver, release, follow-up milestones

- [X] T066 [US1] Implement deliver action — lawyer-side button on engagement page that submits `LegalEngagementEscrow.markDelivered(engId, idx)` via wagmi.
- [X] T067 [US1] Implement release action — client-side button that submits `LegalEngagementEscrow.releaseMilestone(engId, idx)`.
- [X] T068 [US1] Implement follow-up milestone propose / fund flow inside the active engagement page — calls `LegalEngagementEscrow.proposeMilestone` (either party) and `fundMilestone` (client). Indexer updates `engagement_off_chain` mirror.
- [X] T069 [US1] Implement engagement closure — `closeEngagement` calldata route + UI button. Reverts surfaced clearly when a non-terminal milestone exists. Also wire the refund action `refundUndeliveredMilestone` for the closure prerequisite path.

### Transcript anchoring on every milestone event

- [X] T070 [US1] Wire automatic transcript anchoring: every milestone-state-changing calldata builder (fund/deliver/release/refund/close) reads the latest off-chain root from `engagement_off_chain.current_transcript_root` and includes a follow-up `anchorTranscript(engId, root)` call in the same transaction (using a multicall pattern or sequential txs depending on cost). Indexer updates `last_anchor_block` on `TranscriptAnchored`.

**Checkpoint**: User Story 1 fully functional with the Phase 3-attested lawyers. The MVP demo runs end-to-end (excluding disputes, real ZK conflict check, and operator admin).

---

## Phase 5: User Story 3 - Asymmetric dispute resolution by an arbiter (Priority: P2)

**Goal**: Either party can dispute (client immediate; lawyer after 30-day cooldown). For the v3 demo scope the platform operator address is the arbiter — `resolveDispute` gates on `msg.sender == operator` and the operator decides the split. See [spec.md User Story 3](spec.md#user-story-3---asymmetric-dispute-resolution-by-an-arbiter-priority-p2) and [Constitution v2.0.0 Sync Impact Report](../../.specify/memory/constitution.md). Production trajectory adds a separated arbiter pool.

**V2 + 2026-05-08 carry-forward** (already done; not re-listed below):

- Contract surface: `disputeMilestone(engId, idx, transcriptRoot)`, `escalateMilestone(engId, idx, transcriptRoot)`, `resolveDispute(engId, idx, toLawyer, toClient)` (operator-only). Tests in [contracts/test/LegalEngagementEscrow.t.sol](../../contracts/test/LegalEngagementEscrow.t.sol).
- Indexer: handlers for `MilestoneDisputed`, `MilestoneResolved`, `MilestoneMutuallyRefunded` wired in [apps/platform/lib/chain/indexer.ts](../../apps/platform/lib/chain/indexer.ts).
- DB schema: `milestones.assigned_arbiter` (migration 007) is now vestigial — no V2 code reads or writes it. Safe to drop in a future cleanup.

**Independent Test**: Starting from an active engagement created by US1 with a funded milestone, two flows are independently testable. (a) Client triggers `disputeMilestone` immediately → operator (via `app/(operator)/disputes`) resolves with a 60/40 split → funds move correctly. (b) Lawyer marks delivered (V2's optional `markDelivered` to start the cooldown clock) → attempts `escalateMilestone` before cooldown → reverts; advance time via `evm_increaseTime 30d+1block` → lawyer escalates successfully → operator resolves with a different split.

### Status (all done)

- [X] T071 [US3] "Dispute" button in [apps/platform/components/EngagementMilestones.tsx](../../apps/platform/components/EngagementMilestones.tsx), client-only on `funded`/`delivered`. Submits via dispute-calldata.
- [X] T072 [US3] "Escalate" button in the same component, lawyer-only on `delivered`, with a live cooldown countdown. Submits via escalate-calldata.
- [X] T073 [US3] [`app/api/engagements/[requestId]/milestones/[milestoneIndex]/dispute-calldata/route.ts`](../../apps/platform/app/api/engagements/[requestId]/milestones/[milestoneIndex]/dispute-calldata/route.ts) — client-only; embeds `current_transcript_root` in args.
- [X] T074 [US3] [`app/api/engagements/[requestId]/milestones/[milestoneIndex]/escalate-calldata/route.ts`](../../apps/platform/app/api/engagements/[requestId]/milestones/[milestoneIndex]/escalate-calldata/route.ts) — lawyer-only with cooldown precheck.
- [X] T075 [US3] Operator disputes admin page at [`app/(operator)/disputes/page.tsx`](../../apps/platform/app/(operator)/disputes/page.tsx) — every disputed milestone has an inline split form (toLawyer/toClient ETH); submitting calls resolve-calldata. The original separated-arbiter dropdown was removed when the constitution amendment merged the arbiter role into the operator.
- [X] T076 [US3] [`app/api/operator/disputes/route.ts`](../../apps/platform/app/api/operator/disputes/route.ts) — operator-only listing of disputed milestones with party + matter context.
- [X] T077 [US3] [`app/api/engagements/[requestId]/milestones/[milestoneIndex]/resolve-calldata/route.ts`](../../apps/platform/app/api/engagements/[requestId]/milestones/[milestoneIndex]/resolve-calldata/route.ts) — operator-gated; validates split sum equals milestone amount.

### Optional disclosure helper

- [ ] T078 [US3] Optional in-MVP: implement the "share decrypted excerpt" UI button on the engagement page that lets a party export a JSON bundle of `{plaintext, message_envelope, leaf_index, inclusion_proof}` for out-of-band sharing with the operator/arbiter. The bundle is generated client-side only (the platform never sees plaintext per FR-023). The recipient's verification path recomputes the leaf and checks inclusion against the engagement's anchored `transcriptRoot`.

**Checkpoint**: All three milestone-resolution paths (release, client dispute, lawyer escalation) work end-to-end. Demo's Tier-3 beat from [docs/13-demo-v3.md](../../docs/13-demo-v3.md) is reachable.

---

## Phase 6: User Story 4 - Conflict-of-interest check before engagement (Priority: production trajectory only)

> **Status (2026-05-08):** moved out of v3 scope. The contract retains
> `StubZKConflictVerifier` (returns true unconditionally) so the engagement
> open path still calls the verifier interface; no real Noir circuit, no
> lawyer-side commitment UI, no browser-side proof generation. The full
> task list below remains the production target — when re-activated, the
> contract is a verifier-swap, not a contract change.

**Goal**: Replace the stub ZK verifier from Foundational with a real Noir circuit + on-chain verifier. Lawyers publish a Pedersen-hashed root over their current client set. Clients prove non-membership at engagement-creation time. See [spec.md User Story 4](spec.md#user-story-4---conflict-of-interest-check-before-engagement-priority-production-trajectory-only).

**Independent Test (production)**: A lawyer publishes a conflict commitment with N=8 known client identifiers. A client whose identifier is in the set cannot fund a first milestone (transaction reverts at the verifier). A client whose identifier is not in the set funds successfully.

### Noir circuit

- [ ] T079 [US4] Implement `circuits/src/main.nr` — non-membership circuit: public inputs `commitmentRoot: Field`, `nullifier: Field`; private inputs `clientId: Field`, `siblings: [Field; LOG_N]`, `pathBits: [u1; LOG_N]`, `clientSet: [Field; N]` with `N=8`. Circuit asserts (a) `clientId` Pedersen-hashes to `nullifier`, (b) for every entry in `clientSet`, `entry != nullifier`, (c) Merkle root over `clientSet` equals `commitmentRoot`. Compile with `nargo compile`.
- [ ] T080 [US4] Generate verifying key + Solidity verifier: `bb write_vk -b circuits/target/main.json -o circuits/target/vk` then `bb contract -k circuits/target/vk -o contracts/src/ZKConflictVerifier.sol`. Replace `StubZKConflictVerifier` deployment in `Deploy.s.sol` with this contract.

### Lawyer-side commitment publishing

- [ ] T081 [P] [US4] Implement `app/(lawyer)/conflict/page.tsx` — lawyer-only page where they enter their current client set (textarea, one identifier per line, max 8 entries). The browser computes the Merkle root via Pedersen hashing (using `@noir-lang/noir_js`-bundled hashing utilities) and submits `LegalEngagementEscrow.setConflictRoot(root)` via wagmi.
- [ ] T082 [US4] Implement `app/api/conflict/commitment/route.ts` — receives the published root + set_size, mirrors into the `conflict_commitments` table for fast read.

### Client-side proof generation

- [ ] T083 [US4] Implement `lib/zk/prove.ts` — browser-side `generateConflictProof({clientPseudonymousId, lawyerClientSet, lawyerCommitmentRoot})` returning `{proof, nullifier}`. Uses `@noir-lang/noir_js` + `@aztec/bb.js` (UltraHonk) running entirely in the browser.
- [ ] T084 [US4] Update `app/(client)/engagements/[requestId]/page.tsx` (from US1's T058) to call `lib/zk/prove.ts` before funding. The lawyer's published client set is fetched from a new `/api/conflict/[lawyerAddress]` route that returns the set used by the lawyer to compute the published commitment (this is OK for MVP per [spec.md Assumptions](spec.md) — the conflict commitment for each lawyer is small enough to be enumerable). The proof + nullifier are passed to `openEngagementAndFundFirstMilestone`. On a failed proof, the page surfaces the generic "Conflict detected, please contact a different lawyer" message — no information leakage about *which* identifier matched (FR-028).
- [ ] T085 [US4] Implement `app/api/conflict/[lawyerAddress]/route.ts` — GET returns `{set: [identifier...], commitment_root}` from `conflict_commitments`. The lawyer-uploaded set is stored alongside the root for proof-witness purposes. (In production this would live in a per-engagement encrypted storage; the assumption is captured in [spec.md Assumptions](spec.md).)

### Foundry tests for the real verifier integration

- [ ] T086 [P] [US4] Foundry test at `contracts/test/ZKConflictVerifier.t.sol` — using a known `(proof, root, nullifier)` triple generated offline by bb.js, verify the Solidity verifier accepts it, and verify it rejects a triple where `nullifier` corresponds to an in-set identifier.

**Checkpoint**: Conflict-of-interest check is real, end-to-end. The funding path now exercises real ZK; the stub from T016 is no longer in use.

---

## Phase 7: User Story 5 - Operator capability administration (Priority: production trajectory only)

> **Status (2026-05-08):** moved out of v3 scope. The
> `AttestationManager.revokeCapability` contract path exists and is
> callable directly via `cast send`; no operator admin UI is built.
> Granting `verified_arbiter` is no longer needed in v3 because the
> operator address itself acts as the arbiter (Constitution v2.0.0).
> The full admin surface below remains the production target.

**Goal**: An operator can revoke any capability and grant `verified_arbiter` to a wallet that already holds `verified_lawyer`. Direct grants of `verified_lawyer` / `verified_client` are NOT offered. See [spec.md User Story 5](spec.md#user-story-5---operator-capability-administration-priority-p3).

**Independent Test**: From the operator wallet (anvil account 0): the page lists every attested wallet and its capabilities; revoking a lawyer removes them from the directory and blocks new engagements; granting `verified_arbiter` to a `verified_lawyer` wallet enables that wallet to claim disputes; there is no UI affordance to grant `verified_lawyer` directly.

- [ ] T087 [P] [US5] Implement `app/(operator)/capabilities/page.tsx` — table joining `verified_users` rows with their on-chain capability state (live from `hasCapability`). Per-row actions: Revoke (any role), Promote to arbiter (visible only on rows that hold `verified_lawyer` and not yet `verified_arbiter`).
- [ ] T088 [US5] Implement `app/api/operator/capabilities/route.ts` (GET — full list with capabilities + revocation status).
- [ ] T089 [US5] Implement `app/api/operator/capabilities/revoke/route.ts` — POST `{subject, schemaId}` returns calldata for `AttestationManager.revokeCapability` for the operator wallet to broadcast.
- [ ] T090 [US5] Implement `app/api/operator/capabilities/grant-arbiter/route.ts` — POST `{subject}` checks server-side that subject already holds `verified_lawyer` (defense in depth alongside the contract-side `onlyLawyerHolder`), returns calldata for `AttestationManager.attestVerifiedArbiter`.
- [ ] T091 [US5] Confirm the absence of any direct-grant route for `verified_lawyer` / `verified_client` (FR-007) — write an ADR-style note in `app/(operator)/capabilities/README.md` explaining why those routes intentionally do not exist.

**Checkpoint**: All five user stories work independently and can be demoed in any order against the same running instance.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Demo polish, testnet deployment path, edge-case coverage, documentation, accessibility.

- [ ] T092 [P] Implement persona switcher in dev mode (`components/PersonaSwitcher.tsx`) — bottom-right drawer that lets the demo operator switch which anvil account is "connected" without re-pairing the wallet. Disabled in production builds (NODE_ENV check).
- [ ] T093 [P] Implement `scripts/skip-cooldown.ts` — wraps `cast rpc evm_increaseTime 2592000 && cast rpc evm_mine` for a one-keystroke cooldown skip during the demo. `pnpm scripts:skip-cooldown`.
- [ ] T094 [P] Add Foundry fork tests at `contracts/test/fork/BaseSepoliaForkTest.t.sol` — fork Base Sepolia and run a subset of the deploy + key flows against the canonical EAS deployment to validate the testnet path before pushing.
- [ ] T095 [P] Implement testnet deploy script wiring — `Deploy.s.sol` branches on `block.chainid` to use the canonical EAS + SchemaRegistry addresses on Base Sepolia (chainid `84532`) instead of deploying its own.
- [ ] T096 [P] Implement edge cases listed in [spec.md Edge Cases](spec.md): credential expiring mid-engagement (UI shows engagement still continues, but new engagements are blocked); message exceeding the configured per-message size cap; closure-blocked due to non-terminal milestone (the UI surfaces *which* milestone(s) block).
- [ ] T097 [P] Add basic accessibility: keyboard navigation on all primary actions, ARIA labels on icon-only buttons, focus traps on modals. Validate with `axe-core/cli` against the running dev server.
- [ ] T098 Update `README.md` with the boot sequence + persona table + a one-page "what is this" linking out to [docs/14-project-walkthrough-v3.md](../../docs/14-project-walkthrough-v3.md).
- [ ] T099 Run [quickstart.md](quickstart.md) end-to-end on a clean clone to validate the documented bring-up. Fix any drift between the doc and reality. Capture timing for the SC-001 / SC-002 success-criteria assertions.
- [ ] T100 Update `.specify/memory/constitution.md` with a PATCH bump to fix the stale `../../spike/wallet-integration/` path (now `../../docs/spike/wallet-integration/`). Also update the Sync Impact Report.
- [ ] T101 Run a final security pass: confirm no decryption helpers exist in any server-side code path (grep `lib/` for usage); confirm no plaintext message column anywhere in SQLite; confirm no operator-side route can grant `verified_lawyer`/`verified_client` directly; confirm the conflict-proof rejection path leaks no information.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies. Tasks T002–T006 run in parallel.
- **Phase 2 (Foundational)**: depends on Phase 1. Within Phase 2:
  - T008 → T009 (DB schema before connection helper)
  - T014 → T015 → T016 → T018 → T019 → T021 (contracts deployed and seeded before stories can begin)
  - T014 → T017 (Foundry tests for AttestationManager)
  - T015 → T018 (Foundry tests for LegalEngagementEscrow)
  - T010, T012, T013 in parallel after T009
  - T023, T024, T025, T027, T028 in parallel (different files, no cross-dep)
  - T030–T037 (verifier infrastructure) depends on T027, T028
  - T038, T039 (issuer plumbing) depends on T020 (issuer keys)
  - T040 (indexer) depends on T015, T009
- **Phase 3 (US2 — lawyer onboarding, gates Phase 4)**: depends on Phase 2.
  - T043, T044 in parallel after T038
  - T045 → T046 → T047 → T048
- **Phase 4 (US1 — client engagement, MVP demo path)**: depends on Phase 3 — needs at least one attested lawyer in the directory. Internal:
  - T049 → T050 → T051 (PID issuance → onboarding page → finalization)
  - T052, T053 in parallel after T009
  - T054 reads `verified_users` populated by Phase 3
  - T055 → T056 → T057 (request → inbox → propose)
  - T058 → T059 → T060 (fund flow + indexer hook)
  - T061, T062 in parallel after T023
  - T063 → T064 → T065 (messaging end-to-end)
  - T066–T070 sequential (deliver → release → follow-up → close → anchor)
- **Phase 5 (US3)**: depends on Phase 4 (needs an active engagement to dispute). Internal:
  - T071, T072, T073 in parallel
  - T074 → T075 → T076 sequential
  - T077 (decrypt excerpt UI) in parallel after T061
  - T078 (indexer extension) in parallel after T040
- **Phase 6 (US4)**: depends on Phase 2 (replaces T016 stub). Can run in parallel with Phases 3/4/5 by a separate developer.
  - T079 → T080 → (T081, T086 in parallel) → T082, T083, T084, T085
- **Phase 7 (US5)**: depends on Phase 2. Independent of Phases 3/4/5/6 — but the operator's "promote to arbiter" affordance only has a real subject once Phase 3 has produced at least one verified lawyer (e.g., Eva).
  - T087 in parallel with T088, T089, T090, T091
- **Phase 8 (Polish)**: depends on whichever stories are in scope for the delivery.

### User Story Dependencies (story-level summary)

- **US2 (P1)**: depends on Foundational only. Independently testable; produces the directory entries that US1 reads.
- **US1 (P1) 🎯 MVP**: depends on Foundational + US2 (needs at least one attested lawyer in the directory).
- **US3 (P2)**: depends on Foundational + at least one active engagement (cleanly produced by US1).
- **US4 (P3)**: depends on Foundational only. Replaces the stub verifier; works whether or not US1 is complete (US1 just gets stronger gating once US4 lands).
- **US5 (P3)**: depends on Foundational only for the page itself. The "Promote to arbiter" action requires a verified lawyer (i.e., US2 has produced at least one).

### Within Each Story

- Models / migrations before services
- Services before route handlers
- Route handlers before pages that consume them
- Foundry / vitest tests run in parallel with implementation where possible (no requirement to write tests first; the constitution names specific testable invariants and we're satisfying those)
- Story complete before moving to next priority

### Parallel Opportunities

- All tasks marked `[P]` within a phase can run concurrently.
- Once Foundational (Phase 2) completes, Phase 3 (US2 lawyer onboarding) is the critical path that gates Phase 4. Phases 6 (US4) and 7 (US5) are independent and can run in parallel by separate developers. Phase 5 (US3) follows once Phase 4's engagement plumbing exists.

---

## Parallel Example: User Story 1 (Phase 4)

```bash
# After Phase 3 (US2) lands at least one attested lawyer, the following can run in parallel:
Task T049: "Implement PID issuer routes in app/api/issuer/pid/"
Task T052: "Implement matters API in app/api/matters/route.ts"
Task T054: "Implement public lawyer directory in app/(public)/lawyers/page.tsx"
Task T061: "Implement E2EE messaging transport in lib/messaging/transport.ts"
Task T062: "Implement engagement key management in lib/messaging/engagement-keys.ts"
```

## Parallel Example: Foundry tests for the constitution invariants

```bash
# After T015 lands, both contract test files can run in parallel:
Task T017: "Foundry tests for AttestationManager in contracts/test/AttestationManager.t.sol"
Task T018: "Foundry tests for LegalEngagementEscrow in contracts/test/LegalEngagementEscrow.t.sol"
```

---

## Implementation Strategy

### MVP path (US2 → US1)

The platform starts empty. The MVP demo arc (US1 — pseudonymous client engages a verified lawyer) needs verified lawyers to exist, which means US2 (lawyer onboarding) is on the critical path.

1. Complete Phase 1: Setup (T001–T007).
2. Complete Phase 2: Foundational (T008–T042). **Critical**: blocks every story.
3. Complete Phase 3: User Story 2 — Lawyer onboarding (T043–T048). At least one lawyer onboards via the real OID4VP flow.
4. Complete Phase 4: User Story 1 — Client engagement (T049–T070). MVP demo path.
5. **STOP and VALIDATE**: walk Story 1 end-to-end against the running stack. Verify SC-001 / SC-006 / SC-009 against actual behaviour.

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. Add US2 → at least one verified lawyer in the directory.
3. Add US1 → MVP demo (the headline narrative arc).
4. Add US3 → asymmetric disputes + arbiter resolution. Demo's Tier-3 beat now reachable.
5. Add US4 → real ZK conflict-of-interest. Funding path is now end-to-end real.
6. Add US5 → operator capability admin. Production-readiness-shaped admin surface visible on stage.
7. Add Phase 8 polish — testnet deployment, accessibility, demo conveniences.

### Parallel Team Strategy (3 devs)

- Dev A: Phase 1 → Phase 2 → Phase 3 (US2 lawyer onboarding) → Phase 4 (US1 MVP).
- Dev B: parallels into Phase 6 (US4 ZK conflict check) once Phase 2 is done; replaces stub verifier when ready.
- Dev C: parallels into Phase 7 (US5 operator admin) once Phase 2 is done; the page is buildable independently, and the "Promote to arbiter" affordance becomes meaningful as soon as Dev A has at least one verified lawyer.
- All three converge on Phase 5 (US3 disputes — needs Phase 4) and Phase 8 (Polish) toward the demo deadline.

---

## Notes

- Tasks marked `[P]` are different files / no cross-dependencies and can be picked up in any order.
- `[Story]` labels (US1–US5) appear only in Phases 3–7 (the user-story phases). Setup, Foundational, and Polish tasks have no story label even when they're "for" a particular story — the contract layer in T014/T015 is shared infrastructure that every story reads from, so it lives in Foundational.
- Verify every Foundry test fails on a deliberately-broken contract before trusting them green (especially the cooldown and only-claiming-arbiter invariants — those are the ones the constitution explicitly names).
- Commit per logical group; don't squash mass-rewrites of unrelated files.
- Stop at any checkpoint to validate independently before moving on.
- Avoid: vague tasks, same-file conflicts in parallel work, cross-story dependencies that break independence.
