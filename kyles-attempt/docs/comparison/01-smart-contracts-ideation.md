# System A — `smart-contracts-ideation`

> Location: `/home/kyle/programming/firmusnovus/ethprague/smart-contracts-ideation/`
> Tagline (informal): "the implementation with an ugly frontend of all the smart contracts and ways of interacting with them"
>
> What it actually is: a near-complete decentralized legal-engagement marketplace with on-chain escrow, EAS-attested capabilities, EUDI-style selective-disclosure credential issuance and verification, end-to-end encrypted messaging, asymmetric (contract-enforced) dispute logic, an operator dispute-resolution path, and a stub Noir circuit for conflict-of-interest proofs. The "ugly frontend" qualifier understates this — it is a full pnpm monorepo with three runtime services, five shared packages, three production Solidity contracts, a Noir circuit, ~20 e2e scenario scripts, 23 passing Foundry tests, and a CI gate suite that enforces architectural invariants.

---

## 1. Executive summary

**Firmus Novus** (the brand both implementations share) is a marketplace where verified bar-admitted European lawyers offer consultations to verified EU-resident clients. This implementation is the **trust-machine version**: every claim about who a lawyer or client is, every payment, and every state transition is anchored in cryptographic primitives the platform itself cannot forge. The platform is reduced to a coordination layer; the smart contract is the arbiter, the wallet is the identity, the credentials are the trust signal, and the messages are E2E encrypted so the platform sees only ciphertext.

**Core problem solved.** Cross-border legal consultation has a trust impedance: clients need to verify the lawyer is admitted; lawyers want to know the counter-party is a real EU resident (not a sanctioned actor, not a minor); both want privilege-grade confidentiality; and neither wants to trust a single intermediary with payment, identity, or message content. Traditional marketplaces bundle all of that into one custodian. This implementation distributes it: an EBSI-style issuer signs credentials, EAS records capabilities, the escrow contract holds and releases funds under contract-enforced rules (asymmetric dispute, mutual-refund), and the platform stores only what it must.

**Why "ugly frontend" is misleading.** The UI is unpolished compared to System B (Kyle's version) — but it is functionally complete: directory, profile, booking, consultation room with E2EE chat, lawyer dashboard with proposal sender, operator dispute queue, and a dev-bypass persona switcher that broadcasts EAS attestations on demand. Every code path in this system either calls a real contract or has a TODO(production) seam clearly delineated.

---

## 2. Top-level structure (pnpm monorepo)

```
smart-contracts-ideation/
├── apps/
│   ├── platform/       # Main Next.js app (port 3010) — clients, lawyers, operator
│   ├── issuer/         # OID4VCI credential issuer (port 3001) — separate process, separate keys
│   └── proxy/          # Reverse proxy (port 3000) — single public origin for ngrok
├── contracts/          # Foundry: 3 Solidity contracts + 23 tests
├── circuits/           # Noir: conflict-of-interest proof (currently stub body)
├── packages/
│   ├── crypto/         # Browser-only ECDH, AES-GCM, ECDSA, incremental Merkle
│   ├── sd-jwt/         # SD-JWT VC parsing + verification
│   ├── oid4vci/        # OID4VCI flow state (pre-auth codes, access tokens)
│   ├── dcql/           # DCQL request builders for OID4VP
│   └── db-toolkit/     # better-sqlite3 wrapper with migrations
├── specs/              # Spec, plan, research, data-model, quickstart, contracts/
├── docs/               # Implementation decisions (D-IMPL-001..007)
├── design/             # Tokens, components, page wireframes
├── scripts/            # deploy.sh, seed.sh, smoke-test.sh, start-all.sh, scenarios/
└── pnpm-workspace.yaml
```

Three things to notice:

1. **Two-process trust boundary.** The issuer is a separate Next.js process with its own keys, its own SQLite database, and its own JWKS endpoint. The platform never imports the issuer's signing keys; it verifies credentials by fetching `.well-known/jwks.json` over HTTPS. This is enforced at runtime (different ports, different DBs) and at build time (CI gate `scripts/check-isolation.sh`).
2. **Reverse proxy at :3000.** Wallets care about origins. ngrok's free tier gives one public hostname. The proxy fronts both apps so wallet redirects, CORS, and bearer-token handoffs work as if the system were one app.
3. **Workspace packages are first-class.** Crypto, SD-JWT verification, OID4VCI plumbing, DCQL request building, and DB plumbing all live under `packages/` and are imported by both apps. The crypto package in particular is browser-only and CI-gated against accidental server-side import.

---

## 3. Smart contracts (`contracts/src/`)

Three contracts, written in Solidity 0.8.28, tested with Foundry (23/23 passing).

### 3.1 `LegalEngagementEscrow.sol` — the core engine

This single contract covers the entire engagement lifecycle: opening (free or paid), funding follow-up proposals, marking deliverables, releasing funds, mutual refunds, disputes, escalations, and operator resolution.

**Key state**
```solidity
IAttestationManager public immutable attestationManager;
IZKConflictVerifier public zkVerifier;
address public immutable operator;
uint64 public constant LAWYER_DISPUTE_COOLDOWN = 30 days;
mapping(uint256 => Engagement) private _engagements;
mapping(uint256 => mapping(uint256 => Proposal)) _proposals;
mapping(bytes32 => bool) public consumedProposalNonces;
mapping(address => bytes32) public lawyerConflictRoot;
mapping(bytes32 => bool) public usedConflictNullifiers;
```

**Two enums, two structs**
```solidity
enum EngagementState { None, Active, Closed }
enum ProposalState   { None, Funded, Delivered, Released, Disputed, Resolved, Refunded }

struct Engagement {
  address client;
  address lawyer;
  bytes32 matterRef;            // keccak256(case_description || jurisdiction || practice_area)
  EngagementState state;
  bytes32 transcriptRoot;       // per-engagement Merkle root of messages
  uint256 proposalCount;        // proposal[0] is the consultation if it was paid
  bool consultationPaid;
}

struct Proposal {
  uint256 amount;
  ProposalState state;
  uint64 deliveredAt;           // for the lawyer's 30-day cooldown
  uint256 amountToLawyer;       // populated only by resolveDispute()
  uint256 amountToClient;
}
```

**Public surface (12 entry points)**

| Function | Caller | Purpose |
|---|---|---|
| `openFreeEngagement(...)` | client | Open an engagement with no escrow. Verifies lawyer capability via attestation manager and consumes a ZK conflict-proof + nullifier. |
| `openPaidEngagementAndFundConsultation(...)` payable | client | Atomic: open engagement and fund the consultation (proposal index 0). `msg.value == amount` enforced. |
| `fundProposal(eid, idx, amount, itemsHash, nonce, lawyerOfferSig)` payable | client | Fund a follow-up proposal whose terms the lawyer signed off-chain (EIP-712). Nonce single-use. |
| `markDelivered(eid, idx)` | lawyer | Record delivery timestamp, transition Funded → Delivered, start cooldown. |
| `releaseProposal(eid, idx)` | client | Transfer the parked amount to the lawyer (works on Funded or Delivered). |
| `mutualRefundProposal(eid, idx, nonce, clientSig, lawyerSig)` | either | Both parties must sign an EIP-712 refund authorization. Funded only — Delivered work goes through dispute. |
| `disputeProposal(eid, idx, transcriptRoot)` | client | Immediate, no cooldown. Anchors transcript. |
| `escalateProposal(eid, idx, transcriptRoot)` | lawyer | Requires `block.timestamp ≥ deliveredAt + 30 days`. Reverts with `CooldownNotElapsed(unlockAt)` so the UI can show the exact unlock time. |
| `resolveDispute(eid, idx, toLawyer, toClient)` | operator only | Sum-equality enforced: `toLawyer + toClient == proposal.amount`. Transfers immediately. |
| `anchorTranscript(eid, newRoot)` | either party | Update Merkle root. Called after messages or at state transitions. |
| `closeEngagement(eid, finalRoot)` | either party | Only allowed when every proposal is in a terminal state (Released, Resolved, Refunded). |
| `setConflictRoot(root)` | verified lawyer | Lawyer commits a Merkle root over their list of conflict-of-interest counterparties. |

**Modifiers** wire access control to the EAS-backed capability system: `onlyVerifiedClient`, `onlyVerifiedLawyer`, `onlyEngagementClient`, `onlyEngagementLawyer`, `onlyEngagementParty`, `onlyOperator`, `cooldownElapsed`.

**Events** (every meaningful state change): `EngagementOpened`, `ProposalFunded`, `ProposalDelivered`, `ProposalReleased`, `ProposalDisputed`, `ProposalResolved`, `ProposalRefunded`, `TranscriptAnchored`, `EngagementClosed`, `ConflictRootSet`, `ZKVerifierUpdated`.

**Custom errors** (all named, all surface useful info to the UI): `NotEngagementClient`, `NotVerifiedLawyer`, `CooldownNotElapsed(uint64 unlockAt)`, `InvalidProposalState`, `ConflictProofFailed`, `NullifierAlreadyUsed`, `InvalidSplit`, `EthAmountMismatch`, `EngagementNotClean`, `InvalidRefundSignature`, `InvalidOfferSignature`, `NonceAlreadyUsed`, etc.

**Three asymmetries that matter**

- *Dispute timing.* Client can call `disputeProposal` at any time on a Funded or Delivered proposal. Lawyer can only `escalateProposal` on a Delivered proposal, and only after 30 days. This bakes consumer protection into the contract — a lawyer can't sit on funds and force a dispute the moment the client gets uncomfortable.
- *Refund signatures.* Mutual refunds require BOTH parties' EIP-712 signatures. No unilateral path.
- *Resolution arithmetic.* The operator can split, but the split must sum to the parked amount. The contract refuses inflated or shaved resolutions.

### 3.2 `AttestationManager.sol` — capability registry

A thin wrapper around EAS (Ethereum Attestation Service). Two schemas registered at construction:

- `SCHEMA_LAWYER`: `string jurisdiction, string barAdmissionNumber, uint64 admittedAt, uint64 validUntil`
- `SCHEMA_CLIENT`: `string countryOfResidence, bool ageOver18`

Operator-only methods (`attestVerifiedLawyer`, `attestVerifiedClient`) write attestations and cache the UID in `_latestAttestation[subject][schemaId]`. `revokeCapability` calls `eas.revoke()` and clears the cache.

The critical read is `hasCapability(subject, schemaId)`, used by every gated function in `LegalEngagementEscrow`. It returns true only when:
- a cached UID exists,
- the EAS attestation still exists,
- it's not revoked (`revocationTime == 0`),
- it's not expired (`expirationTime == 0 || expirationTime ≥ block.timestamp`).

This means revoking a lawyer's capability immediately blocks them from being booked into new engagements without touching the escrow contract.

### 3.3 `StubZKConflictVerifier.sol` — pluggable ZK seam

Implements `IZKConflictVerifier { verifyProof(bytes proof, bytes32 root, bytes32 nullifier) external view returns (bool); }`. The MVP returns `true`. Production will deploy a Noir+UltraHonk-generated verifier and swap it in via `LegalEngagementEscrow.setZKVerifier(newAddr)`.

The plumbing around it is real: the engagement-open path passes `(proof, nullifier)`, calls the verifier, and tracks `usedConflictNullifiers` to prevent reuse. Only the proof-truth function is stubbed.

### 3.4 Tests (Foundry, 23/23 passing)

- `AsymmetricMechanism.t.sol` — client immediate dispute; lawyer pre-cooldown escalation reverts with `CooldownNotElapsed`.
- `EscrowFlow.t.sol` — happy paths and state-machine guards.
- `CapabilityChecks.t.sol` — revoked / expired capabilities block new engagements.
- `ConcurrentTransitions.t.sol` — chain-as-arbiter under simultaneous mutations.
- `MutualRefund.t.sol` — both signatures required.
- `ResolveSplit.t.sol` — sum-equality.
- `Base.t.sol` — fixtures, EAS mocks.

### 3.5 Deployment

`script/Deploy.s.sol` (called by `scripts/deploy.sh`) deploys `AttestationManager` (registering both schemas), `StubZKConflictVerifier`, then `LegalEngagementEscrow` wiring the first two. Then it seeds the six test personas with attestations.

---

## 4. Circuits (`circuits/src/main.nr`)

Single Noir circuit, currently a stub:

```noir
fn main(commitment_root: pub Field, nullifier: pub Field, secret: Field, leaf: Field) {
    assert(commitment_root != 0);
    assert(nullifier != 0);
    assert(secret != 0);
    assert(leaf != 0);
}
```

The intended proof is non-membership of `leaf` (a hash of the client's identifier) in the Merkle tree committed at `commitment_root` (the lawyer's published list of conflicts), with the nullifier `poseidon(secret, commitment_root)` blocking reuse across engagements. The compiler target is `bb` (Barretenberg) generating an UltraHonk verifier contract. The contract interface and the on-chain state (`lawyerConflictRoot`, `usedConflictNullifiers`) are wired; only the circuit body is missing.

---

## 5. Apps

### 5.1 `apps/platform/` — main app (Next.js 14 App Router, port 3010)

A complete role-aware app. Routes:

**Public.** `/` (landing), `/lawyers` (directory with specialty/language/pricing filters), `/lawyers/[slug]` (profile with About / Credentials / Reviews / Availability tabs and a sticky "Book a consultation" sidebar).

**Onboarding.** `/connect` (role chooser), `/connect/client` and `/connect/lawyer` (steppers that orchestrate SIWE, then OID4VP credential presentations, then capability attestation, then a profile form for lawyers).

**Client.** `/client/home`, `/client/book/[lawyerId]`, `/client/consultation/[engagementId]` (chat + proposals + actions: Mark Complete / Dispute / Request Refund), `/client/messages`.

**Lawyer.** `/lawyer/dashboard` (4 stat cards: pending, upcoming-this-week, active, 30-day net), `/lawyer/requests/[id]` (review with anonymized client identifier, disclosed attributes, fee breakdown), `/lawyer/profile/edit` (live preview, immutable credential-derived fields), `/lawyer/consultation/[engagementId]`, `/lawyer/proposals/[engagementId]/new` (line-item + deliverable form, EIP-712 signing).

**Operator.** `/operator/disputes` — queue of Disputed proposals; resolve form with sum-equality validation; submits via `resolveDispute()`.

**Dev.** `/dev/personas` — only when `DEV_BYPASS_EUDI=1`. Picks one of six personas and broadcasts on-chain transactions on their behalf via `lib/dev/persona-broadcast.ts`, which derives the persona's anvil key from a mnemonic. Used for demos and tests.

**API routes** (selected):

| Route | Purpose |
|---|---|
| `POST /api/auth/siwe` | nonce + verification |
| `GET /api/verifier/request` | build OID4VP DCQL request, return `request_uri` |
| `POST /api/verifier/response` | verify `vp_token`, write capability attestation via `AttestationManager` |
| `GET /api/lawyers`, `/api/lawyers/[slug]` | directory data |
| `POST /api/consultations` | book consultation; broadcasts `openPaidEngagementAndFundConsultation` or `openFreeEngagement` |
| `PATCH /api/consultations/[id]` | accept / decline |
| `POST /api/proposals` | lawyer sends EIP-712-signed proposal |
| `PATCH /api/proposals/[engagementId]/[idx]` | fund / mark-delivered / release / dispute |
| `POST /api/messages` | accepts ciphertext + iv + salt + signature ONLY (server validates that no plaintext field is present) |
| `GET /api/messages?engagementId=X` | poll for new ciphertext |
| `POST /api/messaging-keys` | register per-engagement public key |
| `GET /api/chain-health` | RPC liveness probe — used to disable wallet-sign actions when the chain is unreachable |
| `POST /api/dev/login`, `/api/dev/reset`, `/api/dev/skip-time`, `/api/dev/sign-refund` | dev-only |

**Library layout (`apps/platform/lib/`)** — chain (viem clients, contract bindings, indexer, EAS helpers); crypto/client (browser-only re-export of `@firmus-novus/crypto` plus per-engagement messaging key derivation); verifier (DCQL builder, `vp_token` verifier, x509 cert parsing, JWKS fetch); db (better-sqlite3 schema and accessors); auth (SIWE session); format / anonymize / siwe / dev helpers.

**Indexer.** On-demand, not a daemon. Each mutating API route calls `syncFromChain()` after broadcast (D-IMPL-004). The contract is the source of truth; SQLite is a queryable mirror.

### 5.2 `apps/issuer/` — credential issuer (Next.js 14, port 3001)

A separate process with separate signing keys (`apps/issuer/data/signing-key-*.jwk`) and a separate database (`apps/issuer/data/db.sqlite`). Issues two credential types over OID4VCI:

- **PID** (`urn:eudi:pid:1`) — selective-disclosure JWT VC with claims `address.country`, `birthdate`, `family_name`, `given_name`, `age_equal_or_over_18`, etc. The platform requests only `address.country` and `age_equal_or_over_18` via DCQL.
- **Bar** (`urn:firmus-novus:LegalProfessionalAccreditation`) — claims `jurisdiction`, `bar_admission_number`, `bar_admission_date`, `valid_until`, `family_name`, `given_name`.

OID4VCI flow: `GET /credential-offer` mints a pre-auth code, the wallet posts to `/token` with the pre-auth code and a holder-proof JWT, then to `/credential` with a Bearer token to receive the SD-JWT envelope. State (`issuer_pre_auth_codes`, `issuer_access_tokens`, `credential_offers`) lives in the issuer's own SQLite, with 10-minute TTLs.

Two signing keys, two `.well-known/openid-credential-issuer` endpoints, two `.well-known/jwks.json` endpoints — one pair per credential type.

### 5.3 `apps/proxy/` — reverse proxy (Node, port 3000)

Routes `/api/issuer/*` to the issuer on 3001, everything else to the platform on 3010. Lets the system present a single origin to wallets, which is required for ngrok's free tier and for OID4VP redirect flows.

---

## 6. Packages

### 6.1 `@firmus-novus/crypto` — browser-only

- **`ecdh`** — P-256 keypair generation and shared-secret derivation (JWK format).
- **`aes-gcm`** — HKDF-SHA-256 → AES-256 key, fresh IV+salt per message, GCM tag verification.
- **`ecdsa`** — sign/verify via wallet's secp256k1 key (viem integration).
- **`merkle`** — incremental Merkle tree, depth 16 (= 2¹⁶ leaves), SHA-256, leaf format `sha256(ciphertext || signature || sender || index)`. Deterministic and order-dependent.

Every export checks `globalThis.crypto.subtle` and throws if unavailable. CI gate `scripts/check-no-server-decryption.sh` ensures the server bundle never imports any of these.

11/11 vitest tests passing: ECDH key derivation + bilateral shared-secret equality; AES-GCM round-trip; tamper detection; wrong-key rejection; Merkle determinism + order-dependence.

### 6.2 `@firmus-novus/sd-jwt` — VC parsing/verification

`parseEnvelope` splits `<JWS>~<Disclosure1>~...~<KB-JWT>`. `verifySdJwtVc` runs the 6-step verification: JWS-against-JWKS, hash each disclosure into the `_sd` array, decode disclosures, verify the key-binding JWT against `cnf.jwk`, check `aud` matches the verifier's `client_id`, check `nonce` matches.

### 6.3 `@firmus-novus/oid4vci` — issuer state

Owns the issuer's three OID4VCI tables (pre-auth codes, access tokens, credential offers), with helpers `mintPreAuthCode`, `consumePreAuthCode`, `issueAccessToken`, `verifyHolderProof`. 10-minute TTLs.

### 6.4 `@firmus-novus/dcql` — request builders

Builds OID4VP request objects (DCQL) declaring exactly which claims the platform wants from which credential type. The DCQL is the legal contract for selective disclosure — it's how the platform constrains itself to country + age-over-18 rather than the full PID payload.

### 6.5 `@firmus-novus/db-toolkit` — SQLite wrapper

Light wrapper around better-sqlite3 with a per-path migration runner. Used by both apps.

---

## 7. Specs (`specs/001-verified-legal-engagement/`)

This directory is the source of truth for what the system is supposed to do. It includes:

- **`spec.md`** — 8 user stories, 64 functional requirements (FR-001..FR-062), 20+ edge cases.
- **`plan.md`** — technical architecture, 9-principle constitution check (all PASS), no complexity violations.
- **`research.md`** — 14 documented design decisions (wallet handoff, chain choice, ZK toolchain, messaging substrate, etc.).
- **`data-model.md`** — EAS schemas, on-chain structs, SQLite tables, state-machine diagrams.
- **`quickstart.md`** — 10-minute bring-up.
- **`contracts/`** — `solidity-surface.md`, `api-routes.md`, `eas-schemas.md`, `credential-shapes.md`, `messaging-shape.md`.

The spec maps requirements to FR groups: identity & onboarding (FR-001..010), consultation requests (FR-011..015), proposals (FR-016..023), asymmetric dispute (FR-024..030), mutual refund & closure (FR-031..034), E2EE messaging (FR-035..040), public discovery & pseudonymity (FR-041..051), concurrency & availability (FR-052..062).

---

## 8. Scripts and CI gates

**Bring-up.** `scripts/start-all.sh` runs anvil, deploys, seeds, and starts proxy + issuer + platform in parallel. `deploy.sh`, `seed.sh`, `reset.sh`, `smoke-test.sh` (full demo) round it out.

**Test scenarios** (`scripts/scenarios/`) — 19 scripts named S1..S19, 20/20 passing in current state, covering: free consultation, mutual refund (both directions), 30-day cooldown, message API security, chain-as-arbiter under race, role-gating, multi-proposal lifecycle, forged-offer rejection, terminal-state guards, nullifier replay, engagement closure, free→paid sequence, 10 simultaneous engagements between same parties, Unicode + 100KB ciphertext, direct-chain tampering, large payloads, 8 follow-ups on one engagement, SSR coverage, operator capability revocation mid-flow.

**CI gates.**
- `forge test` — Solidity invariants.
- `pnpm test` — vitest unit tests for crypto.
- `madge --circular apps/platform/` — no import cycles (Constitution Inv 7).
- `scripts/check-feature-isolation.sh` — sibling features never import each other.
- `scripts/check-no-server-decryption.sh` — server bundles never import browser crypto (Constitution Inv 1).
- `scripts/check-isolation.sh` — issuer ↔ platform interact only over HTTPS JWKS.
- `scripts/check-brand-mentions.sh` — brand-mention discipline.

---

## 9. End-to-end flows

### 9.1 Lawyer onboarding

1. Lawyer connects wallet (SIWE).
2. Platform builds DCQL request asking for jurisdiction, bar admission number, admitted-at, valid-until.
3. Wallet (wwWallet in production, persona picker in dev) presents the bar credential as a `vp_token`.
4. Platform verifies signatures (issuer JWKS) + KB-JWT.
5. Platform calls `AttestationManager.attestVerifiedLawyer(...)` from the operator key — writes EAS attestation.
6. Lawyer fills profile (city, headline, bio, specialties, languages, pricing) and appears in the directory.

### 9.2 Booking a paid consultation

1. Client clicks "Book a Consultation" on a lawyer's profile.
2. Form: scheduled time, duration (30/60), practice area, case description (≥20 chars).
3. Client wallet signs `openPaidEngagementAndFundConsultation(lawyer, matterRef, amount, zkProof, nullifier, initialRoot)` with `value = amount`.
4. Contract verifies lawyer capability, runs ZK conflict check, opens engagement, marks proposal[0] Funded, emits `EngagementOpened` + `ProposalFunded`.
5. Platform's indexer mirrors to SQLite (`engagements_off_chain`, `consultations`, `proposals_off_chain`).
6. Client redirected to consultation workspace.

### 9.3 E2E encrypted messaging

1. Both parties open the workspace; their browsers derive a per-engagement ECDH keypair.
2. Each fetches the other's public key from `/api/messaging-keys`.
3. To send: derive shared secret → AES-GCM-encrypt → sign → POST `{ciphertext, iv, salt, signature}` (no plaintext).
4. Server hashes the message into the per-engagement Merkle tree, updates `current_transcript_root`, calls `LegalEngagementEscrow.anchorTranscript`.
5. Recipient polls every 5s, decrypts in browser. If the wallet is disconnected, the UI fetches but can't decrypt and shows "Connect wallet to view".

### 9.4 Lawyer follow-up proposal

1. Lawyer fills line items (hourly or fixed) + deliverables.
2. Lawyer's wallet signs an EIP-712 digest `(PROPOSAL_OFFER_TYPEHASH, engagementId, totalWei, itemsHash, nonce)`.
3. Platform stores the offer + signature.
4. Client clicks "Accept and Fund" → wallet signs `fundProposal(eid, idx, amount, itemsHash, nonce, lawyerOfferSig)` with `value = amount`.
5. Contract verifies the lawyer's signature, marks the nonce consumed (one-shot), transitions proposal to Funded.

### 9.5 Dispute and resolution

- **Client dispute (immediate).** `disputeProposal(eid, idx, transcriptRoot)` on a Funded or Delivered proposal. Anchors the transcript.
- **Lawyer escalation (cooldown).** `markDelivered` starts the clock. After 30 days, `escalateProposal` is allowed. Pre-cooldown calls revert with `CooldownNotElapsed(unlockAt)`.
- **Operator resolution.** `resolveDispute(eid, idx, toLawyer, toClient)` with `toLawyer + toClient == proposal.amount`. Funds transferred immediately.

---

## 10. Constitutional invariants

The spec is governed by 9 principles and 7 invariants:

1. **Privilege as Cryptography** — keys derive from wallet ECDH in the browser; server has no decryption path.
2. **Pseudonymous by Default** — clients reveal only country + age-over-18; lawyers reveal jurisdiction + bar number + admission/validity dates + name.
3. **Asymmetric Mechanisms** — client disputes immediately, lawyer waits 30 days, contract-enforced.
4. **Standards-Compliance** — OID4VCI/OID4VP, SD-JWT VC, EAS, SIWE, WebCrypto, Noir+UltraHonk; no novel crypto.
5. **Quiet Web3, Loud Trust** — copy says "secure payment held until consultation completes," not "smart contract escrow." Wallet addresses in monospace, truncated.
6. **Design Tokens** — `design/css/tokens.css` is authoritative. Teal + gold (gold <5%). Lucide icons only.
7. **Two-Process Trust Boundary** — issuer + platform are separate processes, separate DBs, separate keys.
8. **Real Persistence, Stubbed Seams** — every stub is a `TODO(production)` block; nothing is hidden behind interfaces.
9. **Modularity for Iteration** — features map to contiguous modules; CI gates prevent cross-feature imports and cycles.

The 7 invariants encode these as testable properties: no platform-held decryption keys, EAS as on-chain handshake, asymmetric capabilities + single identity, issuer/platform separation, tamper-evident transcripts, contract-enforced cooldowns, no import cycles.

---

## 11. Implementation status

**Implemented.** SIWE login, OID4VCI issuance, OID4VP+DCQL verification, EAS attestation/revocation, paid + free consultation booking, E2EE messaging with ECDH+AES-GCM, per-engagement Merkle transcript, lawyer-signed proposals, mutual refund (both signatures), asymmetric dispute (immediate client / 30-day lawyer), operator resolution with sum-equality, lawyer profile self-service with avatar upload, directory + filters, 6 seeded personas with attestations, smoke-test demo, 23/23 Foundry tests, 11/11 crypto tests, 20/20 scenario tests.

**Stubbed (TODO(production) blocks).** Video call, large-file uploads to object storage, ZK conflict-of-interest circuit body, wwWallet integration (replaced by `DEV_BYPASS_EUDI` persona picker in dev).

**Out of scope for MVP.** Account deletion / GDPR right-to-erasure, multi-language UI, fiat (ETH only), feature branches (trunk-only), mobile-first.

---

## 12. Networks and deployment

**Local dev.** Anvil (zero-gas, instant blocks). Hardcoded mnemonic in `.env` for the 12 standard accounts; index 0 is the operator. ngrok free tier provides a single public hostname which the proxy fronts.

**Production trajectory.** Base Sepolia for testnet, then a base-tier L2. Cloud hosting; managed Postgres replacing SQLite; S3 / Cloudflare R2 for avatars and large assets; Sentry/DataDog for monitoring.

---

## 13. The system in one sentence

A pnpm monorepo that takes the abstract claim "decentralized law firm" and grounds every word — *decentralized* into EAS attestations and contract-enforced asymmetric escrow on Anvil/Base; *law firm* into bar-admission credentials issued via OID4VCI and selectively disclosed via OID4VP — wrapped in a usable-but-unpolished UI whose primary job is to prove the cryptographic substrate works end-to-end.
