# System A vs System B — differences

> **A** = `smart-contracts-ideation/` — the cryptographic substrate, with a usable-but-rough UI.
> **B** = `kyles-attempt/` — the polished UI, with the cryptographic substrate stubbed.
>
> Both implementations target the same product (Firmus Novus, a verified-pseudonymous legal-engagement marketplace), under the same constitution, against the same spec — and they end up with **disjoint completeness profiles**: A has the trust machine, B has the user experience. Neither alone is a complete shippable product. Together they describe the whole.

---

## 1. The one-line contrast

- **A is a trust system that happens to have a UI.** The Solidity contract is the source of truth; the platform mirrors it; the UI exists to drive transactions.
- **B is a user experience that happens to have a database.** The UI is the source of truth; the database mirrors it; the Web3 surface exists as a future seam.

Said differently: A would still be correct if you replaced its UI with a CLI; B would still feel like Firmus Novus if you replaced Prisma with hardcoded JSON fixtures.

---

## 2. Side-by-side at a glance

| Dimension | A — `smart-contracts-ideation` | B — `kyles-attempt` |
|---|---|---|
| Repository shape | pnpm monorepo | single Next.js app |
| Runtime services | 3 (proxy + issuer + platform) | 1 |
| Smart contracts | 3 Solidity (LegalEngagementEscrow, AttestationManager, StubZKConflictVerifier), Foundry, 23/23 tests | 0 (stub functions in `lib/web3/escrow.ts`) |
| ZK circuit | Noir circuit (stub body, real on-chain plumbing) | none |
| Credential issuance | OID4VCI (PID + bar), separate issuer process, separate signing keys | none (stubbed) |
| Credential verification | OID4VP + DCQL + SD-JWT VC, real x509 + JWKS | none (stubbed) |
| On-chain attestations | EAS schemas (verified_lawyer, verified_client), via AttestationManager | column `verificationStatus` enum on `LawyerProfile` |
| Escrow | real contract, sum-equality on resolve, EIP-712 proposal offers, EIP-712 mutual refunds | stub functions returning fake tx hashes after `setTimeout` |
| Asymmetric dispute | contract-enforced 30-day cooldown for lawyer; immediate for client; reverts with `CooldownNotElapsed(unlockAt)` | status enum value `DISPUTED` only; no timing logic |
| E2E messaging | ECDH (P-256) + AES-GCM-256 in browser, ciphertext-only over the wire, server validates absence of plaintext | plaintext `content` field in SQLite; no encryption |
| Transcript anchoring | per-engagement incremental Merkle (depth 16), root anchored on contract at every transition | `(conversationId, createdAt)` index; no anchoring |
| Conflict-of-interest check | ZK non-membership proof (stub returns `true`), nullifier-tracked | hardcoded "pass" badge in the request review UI |
| Database | issuer SQLite + platform SQLite (separate DBs, separate processes) | single Prisma SQLite |
| ORM | better-sqlite3 + custom migration runner (`@firmus-novus/db-toolkit`) | Prisma 6 |
| Auth | SIWE + capability-attestation gating | NextAuth (Auth.js) Credentials provider with SIWE adapter |
| Wallet UX | wagmi + viem; production target is wwWallet for credentials, MetaMask-class for tx | RainbowKit (mocked); two-stage picker (EBSI provider + tx wallet) |
| Front-end | Next.js 14, Tailwind 3, React 18 | Next.js 15, Tailwind 4, React 19 |
| Polish level | functional, demo-grade UI (rough by design — the surface is the contract) | polished, design-system-driven, animated, dark-mode consultation room |
| Roles | client, lawyer, **operator** (real route group) | client, lawyer (admin behind a single API endpoint, no UI) |
| Test surface | 23 Foundry tests + 11 crypto vitest tests + 19 e2e scenario scripts | 10 Playwright e2e suites covering UI/API parity |
| CI gates | madge (cycles), feature-isolation, no-server-decryption, two-process isolation, brand mentions | none beyond `tsc` |
| Indexer | on-demand `syncFromChain()` after every mutating route | n/a |
| Chain health | `GET /api/chain-health` checked before wallet-sign actions; UI disables on failure | n/a |
| Operator path | `/operator/disputes` queue + resolve form → `resolveDispute()` | none |

---

## 3. Architectural differences

### 3.1 The trust boundary

A's most important architectural choice is the **two-process trust boundary** (Constitution Inv 4). The issuer is a separate Next.js process on port 3001 with its own SQLite database (`apps/issuer/data/db.sqlite`) and its own signing keys (`apps/issuer/data/signing-key-*.jwk`). The platform never reads the issuer's keys; it verifies credentials by fetching `.well-known/jwks.json` over HTTPS. This is enforced at runtime (different ports, different DBs) and at build time (CI gate `scripts/check-isolation.sh`).

B has no such boundary. There is one process, one database, one set of secrets. The "EBSI wallet provider" picker on `/connect` is purely a UI selector that gets stored to `User.ebsiWalletProvider`; nothing on the backend behaves differently per provider. There is no issuer process to be isolated from.

This isn't a flaw of B per se — it's the consequence of stubbing credentials. There is nothing real to wall off yet. But it is the largest single structural difference between the two systems, and the one that would require the most surgery to retrofit into B.

### 3.2 Source of truth

In A, **the contract is canonical.** `engagements_off_chain`, `proposals_off_chain`, etc. in the platform's SQLite are mirrors. The indexer is on-demand: every mutating API route broadcasts the transaction first, then calls `syncFromChain()`. If the DB and the chain disagree, the chain wins and the DB is rebuilt from events.

In B, **the database is canonical.** The `escrowTxHash` and `escrowReleaseHash` columns exist and are populated, but with fake values. There is no chain to reconcile with. The Booking row IS the engagement.

This colors every operation:
- A's "accept request" path: client wallet signs `openPaidEngagementAndFundConsultation` (or the lawyer signals acceptance via off-chain flow + later state machine), contract mints engagement, indexer mirrors, UI updates.
- B's "accept request" path: server checks `clientAcceptedAt` is non-null, calls the escrow stub which sleeps and returns a fake hash, sets `status = ACCEPTED` and stores the hash. No chain involvement.

### 3.3 Asymmetric dispute mechanism

A implements this for real. The 30-day cooldown is `LAWYER_DISPUTE_COOLDOWN = 30 days` in the contract; `escalateProposal` is gated by the `cooldownElapsed` modifier; pre-cooldown calls revert with `CooldownNotElapsed(uint64 unlockAt)` so the UI can show the exact unlock timestamp. Test `AsymmetricMechanism.t.sol` (in the 23/23 passing suite) verifies this end-to-end.

B has the **shape** of this mechanism — the `BookingStatus` enum includes `DISPUTED`, the escrow stub has `disputeEscrow`, the schema separates `clientAcceptedAt` from `lawyerAcceptedAt` — but no timing logic, no cooldown, no UI affordance. The asymmetry is design-ready, not yet implemented.

### 3.4 E2E encryption

A treats this as load-bearing. The crypto package is browser-only and CI-gated (`check-no-server-decryption.sh`). Per-engagement ECDH keypairs derived from wallet keys; AES-GCM with fresh IV+salt per message; KDF via HKDF-SHA-256; messages on the wire are `{ciphertext, iv, salt, signature}` only — the server validates that no `plaintext` field is present and rejects the request if it is. The Merkle tree (depth 16, SHA-256, leaves of `sha256(ciphertext || signature || sender || index)`) is updated on every message and its root is anchored on `LegalEngagementEscrow.anchorTranscript()` at every state transition.

B stores `Message.content` as plaintext in SQLite. The chat works, polls every 5 seconds, has auto-scroll-to-bottom, supports attachments — but the platform sees everything. This is not a temporary oversight; it's a choice consistent with B's positioning ("show the experience, defer the substrate").

### 3.5 Conflict-of-interest

A wires the entire pipeline. `LegalEngagementEscrow.openFreeEngagement` and `openPaidEngagementAndFundConsultation` both take `(zkConflictProof, zkNullifier)` parameters, call `zkVerifier.verifyProof()`, track `usedConflictNullifiers[nullifier]` to prevent reuse, and check `lawyerConflictRoot[lawyer]` matches the proof. The Noir circuit at `circuits/src/main.nr` is currently a stub asserting non-zero inputs; production replaces it with a real non-membership proof and swaps in a generated UltraHonk verifier via `setZKVerifier`.

B shows a "Conflict check passed" badge on `/lawyer/requests/[id]`. It is hardcoded.

### 3.6 Operator role

A has a real third role. `/operator/disputes` is a route group; `resolveDispute` is a contract function with `onlyOperator` modifier and the sum-equality invariant `amountToLawyer + amountToClient == proposal.amount` checked on-chain. There's a UI to enter the split, client-side validation that mirrors the server-side validation, and a wallet sign-and-broadcast path.

B has no operator UI. There is one admin-protected API endpoint (`/api/admin/verify-lawyer`) that flips `verificationStatus` based on a header-passed `ADMIN_API_KEY`. That's the entire admin surface.

### 3.7 Capability vs. column

A's identity model is **capability-based**. `AttestationManager.hasCapability(subject, schemaId)` is the gate every contract function passes through. Capabilities are EAS attestations; they can be revoked (`revokeCapability`); the contract checks freshness (not revoked, not expired) on every call. A revoked lawyer is immediately uninvitable — the next `openPaid…` call from a client targeting them reverts with `NotVerifiedLawyer`.

B's identity model is **enum-based**. `LawyerProfile.verificationStatus` is a string column ("PENDING" | "VERIFIED" | "REJECTED"). To revoke, you mutate the column. There is no on-chain consequence and no atomicity with in-flight bookings; if a lawyer's status flips mid-request, nothing automatically prevents the request from completing.

---

## 4. Data-model differences

| Concept | A | B |
|---|---|---|
| Identity record | EAS attestation UID + on-chain capability + off-chain `verified_users` row | `User` row + `LawyerProfile.verificationStatus` enum |
| Engagement | `Engagement` struct on-chain + `engagements_off_chain` SQLite mirror | does not exist as a distinct entity — folded into `Booking` |
| Consultation | `Proposal` struct at index 0 with `amount > 0 ⇔ paid` | `Booking` with `clientAcceptedAt` set |
| Follow-up proposal | `Proposal` struct at index ≥1 with `lawyerOfferSignature` (EIP-712) | `Booking` with same shape (line items + deliverables + total) |
| Message | hashed into per-engagement Merkle, stored in `messages` SQLite as `{ciphertext, iv, salt, signature, sender, index}` | `Message` row with plaintext `content` |
| Transcript proof | `transcriptRoot` anchored on contract at every transition | implicit in `(conversationId, createdAt)` index — no proof |
| Mutual-refund auth | both EIP-712 signatures stored in `mutual_refund_authorizations` | not modeled |
| Bar credential record | EAS attestation with `jurisdiction, barAdmissionNumber, admittedAt, validUntil` | columns `barRegistrationNum, barJurisdiction, admissionDate` on `LawyerProfile` |
| Pricing | numeric on-chain (wei); off-chain mirror with EUR conversion | `pricingKind` enum + `hourlyRateEUR` + `consultationRate30/60` + `pricingItems` JSON |

A's data model accommodates concurrency naturally: the chain is the arbiter, two parties acting on the same proposal at the same time means the second tx reverts because the proposal state has changed. B's data model has no arbiter for concurrent edits — last write wins on the Booking row.

---

## 5. Dependencies and stack drift

| | A | B |
|---|---|---|
| Next.js | 14.2 | 15 |
| React | 18 | 19 |
| Tailwind | 3 | 4 (with `@theme` in CSS) |
| ORM / DB | better-sqlite3 + custom toolkit | Prisma 6 + SQLite |
| Auth | siwe + custom session in `lib/auth/` | NextAuth v5 + siwe + `Nonce` table |
| Wallet | wagmi 2 + viem 2 + (production: wwWallet for VCs) | wagmi 2 + viem 2 + RainbowKit (mocked) |
| Crypto | jose + WebCrypto + `@firmus-novus/crypto` workspace package | none |
| Form / validation | zod (server-side, indirect) | zod + react-hook-form (both sides) |
| Test | Foundry (Solidity) + vitest (TS) + 19 bash scenario scripts | Playwright e2e (10 suites) |
| Production-ready chain | Base Sepolia (research.md) | unspecified — would be wherever the future contract lives |

The stack-version drift (Next 14→15, React 18→19, Tailwind 3→4) reflects when each was authored: A was scaffolded on the Next 14/Tailwind 3 stable line and stayed there for stability of the verifier and contract integration; B was scaffolded later on Next 15/Tailwind 4 to take advantage of the newer design-token story.

---

## 6. UX and product surface

### 6.1 Onboarding

A's onboarding is the **OID4VCI/OID4VP loop**. Lawyer goes to `/connect/lawyer` → SIWE → platform builds DCQL request asking for jurisdiction + bar number + admission/validity + name → wallet (wwWallet in production, persona picker via `/dev/personas` in dev) presents `vp_token` → platform verifies, calls `attestVerifiedLawyer` from operator key → EAS attestation written → lawyer fills profile form → directory.

B's onboarding is a **two-stage wallet picker + a separate verification form**. `/connect` collects role, EBSI wallet provider, age check (clients), and tx wallet, all in a stage-progress UI. SIWE message + signature creates the User row. Lawyers then go to `/verify-lawyer`, fill a long form, upload credential documents to the file system, and POST to `/api/verification` which sets PENDING. In dev, `DEV_AUTO_VERIFY_SECONDS` flips it to VERIFIED.

A is closer to the spec; B is more demoable.

### 6.2 The consultation room

Both implementations have a real chat. A's chat is encrypted end-to-end (per-engagement ECDH, AES-GCM, signed); B's is plaintext-over-HTTPS. Both poll every 5 seconds. Both have a video stub (placeholder tiles awaiting a video SDK). B's room is dark-mode and more visually polished — `EscrowStatusIndicator` in the right rail, `FirmusLogo` in the header, dedicated control buttons (Mute, Camera, Screen Share, Leave). A's room shows a richer **proposal panel** in the right rail with role-aware action buttons (Mark Complete / Dispute / Request Refund for clients, Mark Delivered / Send Proposal for lawyers).

### 6.3 Lawyer dashboard

Both have a stat-tile dashboard with pending requests, upcoming, active, and 30-day earnings. Both have a "today's schedule" and a recent-requests list. The shapes are nearly identical, because both implementations are reading from the same product brief.

The difference is what the lawyer can do from there:
- A — review request → accept/decline → message with E2EE → mark delivered → wait for release / send follow-up proposal → escalate (after cooldown) if needed
- B — review request → accept/decline → message in plaintext → wait for client to mark complete → send invoice from `/lawyer/invoices/new`

A models the lifecycle as a state machine. B models it as a sequence of UI steps.

### 6.4 Anonymity and pseudonymity

Both implementations show the lawyer an anonymous client identifier on the request review screen. A derives it from disclosed attributes (country + age-over-18) plus a hash of the wallet address — `anon-A1B2C3` style. B derives it from the wallet address alone — `#4A · 2f` (from `lib/utils/anonymize.ts`, `anonymousClientId()`).

Both go beyond the wallet address to avoid leaking patterns; A goes a step further by also incorporating the disclosed-attribute hash so two different EU PIDs produce visually distinct identifiers.

---

## 7. Test posture

A's test pyramid:
- **Solidity** — 23 Foundry tests, all passing, covering asymmetric mechanism, escrow flow, capability gates, concurrent transitions, mutual refund signatures, sum-equality on resolve.
- **Crypto** — 11 vitest tests, all passing, covering ECDH key derivation, AES-GCM round-trip / tamper / wrong-key, Merkle determinism + order-dependence.
- **Scenarios** — 19 numbered shell scripts (S1..S19), 20/20 passing in current state. S1 free consultation, S2-S3 mutual-refund directions, S4 cooldown, S5 message API security, S6 chain-as-arbiter race, S7 role-gating, S8/S8b multi-proposal + forged-offer rejection, S9 input validation, S10 nullifier replay + terminal guards, S11 closure, S12 free→paid sequencing, S13 10 simultaneous engagements, S14 Unicode + 100KB ciphertext, S15 direct-chain tampering, S16 large payloads, S17 8 follow-ups, S18 SSR coverage + role-aware banners, S19 operator capability revocation mid-flow.
- **CI gates** — madge for cycles, feature-isolation script, no-server-decryption script, two-process isolation script, brand-mentions script.

B's test pyramid:
- **Playwright** — 10 e2e suites covering public, sign-in-out, connect, client, lawyer, attachments, invoices, stale-session, api-coverage, dead-button-sweep. Single-worker against `next start` on port 3100, DB auto-resets per suite.
- **CI gates** — none beyond `tsc` + `eslint`.

A's tests prove **invariants**: nothing the platform can do violates the contract's rules. B's tests prove **happy paths**: the UI doesn't break when a real user clicks through it. Both are valuable; they are not substitutes for each other.

---

## 8. What B can borrow from A

If B's UI were grafted onto A's substrate, the work would look like:

1. **Wire the `lib/web3/escrow.ts` stubs to viem `writeContract` calls** against a deployed `LegalEngagementEscrow`. The schema columns (`escrowTxHash`, `escrowReleaseHash`) are already there.
2. **Replace `verifyLawyerCredentials` with an OID4VP+DCQL flow** following the patterns in A's `/api/verifier/request` and `/api/verifier/response`. The `LawyerProfile.ebsiCredentialId` column receives the verified credential's identifier.
3. **Replace plaintext messaging with E2EE.** Borrow `@firmus-novus/crypto` directly. Move the chat wire format to `{ciphertext, iv, salt, signature}`. Add the per-engagement ECDH keypair derivation. Add server-side rejection of any request body that contains a plaintext field.
4. **Add the operator route group** (`/operator/disputes`) and the `resolveDispute` call.
5. **Implement the asymmetric cooldown.** Add `deliveredAt` to Booking; gate lawyer dispute on `now ≥ deliveredAt + 30 days`; let the contract enforce it once escrow is real.
6. **Two-process the issuer.** Split the verification flow into a separate Next.js app with its own DB and signing keys. This is the largest change, because it crosses the deployment boundary.

## 9. What A can borrow from B

If A wanted B's polish:

1. **Adopt B's component library** under `components/firmus/`. `LawyerCard`, `EscrowStatusIndicator`, `EBSIBadge`, `InvoiceCard`, `InvoiceEditor` are all directly portable.
2. **Adopt the design tokens** from B's `app/globals.css` (Tailwind v4 `@theme`). They're already aligned with the constitution.
3. **Adopt the multi-stage `/connect` flow** with the EBSI provider picker. A's onboarding is more correct but less guided; B's is more demo-able.
4. **Adopt the dark-mode consultation room layout.** A's room is functionally complete; B's is visually excellent.
5. **Adopt B's Prisma schema** for the user-facing pieces (`pricingKind`, `pricingItems`, `tags`, `consultationRate30/60`) — they're slightly richer than A's pricing model.
6. **Adopt B's category-based client home** (`CATEGORY_SERVICES`) and recommended-lawyers grid. A's client home is sparse by comparison.

---

## 10. The two systems as a Venn diagram

```
              ┌────────────────────────────────────┐
              │             A only                  │
              │  • 3 Solidity contracts             │
              │  • Foundry test suite               │
              │  • EAS attestation registry         │
              │  • Operator dispute queue           │
              │  • OID4VCI issuer (separate proc)   │
              │  • OID4VP + DCQL + SD-JWT verifier  │
              │  • E2EE chat (ECDH + AES-GCM)       │
              │  • Per-engagement Merkle transcript │
              │  • Noir conflict-of-interest circuit│
              │  • EIP-712 proposal & refund auth   │
              │  • 30-day cooldown (contract)       │
              │  • Indexer + chain-health probe     │
              │  • CI gates (madge, isolation, ...) │
              └────────────────────────────────────┘

      ┌─────────────────────────────────────────────────┐
      │                   Both                           │
      │  • Same product brief & constitution             │
      │  • Same spec FRs (the 64-item list)              │
      │  • Lawyer directory + filters                    │
      │  • Lawyer profile (About/Cred/Reviews/Avail.)    │
      │  • SIWE auth                                     │
      │  • Booking + invoice/proposal shape              │
      │  • Consultation workspace with chat              │
      │  • Lawyer dashboard + request review             │
      │  • Profile editor                                │
      │  • Pseudonymous client identifier on requests    │
      │  • Teal + gold design language, Inter + Fraunces │
      │  • Pragmatic dev-bypass for credentials          │
      └─────────────────────────────────────────────────┘

              ┌────────────────────────────────────┐
              │             B only                  │
              │  • Next 15 / React 19 / Tailwind 4  │
              │  • Prisma ORM                       │
              │  • NextAuth v5 wiring               │
              │  • RainbowKit-style two-stage picker│
              │  • Full design system + animations  │
              │  • Dark-mode consultation room      │
              │  • Category-driven client home      │
              │  • In-app invoice editor (UI-rich)  │
              │  • Verification submission form     │
              │  • Single-process simplicity        │
              └────────────────────────────────────┘
```

---

## 11. Picking one

**Pick A if your goal is to demonstrate that the system is real.** Investors who care about the cryptography, journalists writing about decentralized professional services, lawyers asking "how do you actually enforce the cooldown?", security reviewers — all of these audiences are persuaded by code that compiles to a contract that runs on a chain that has 23 passing tests against it.

**Pick B if your goal is to demonstrate that the product is desirable.** Pilot users, design partners, marketing copy, screenshots in a deck, the demo recorded for a hackathon judge in 90 seconds — these audiences are persuaded by an interface that looks professional, behaves smoothly, and tells a complete story without breaking immersion.

**Pick the merge of both if your goal is to ship.** The honest answer is that the production system is B's UI on top of A's substrate. A demonstrates that the substrate works. B demonstrates that the product is wantable. Neither is the final form. The final form is the surgery described in §8 — graft B's design system, dark-mode consultation room, polished onboarding, and category-driven home onto A's contracts, attestations, encryption, transcripts, and operator path. That is the system that should exist; both repos are partial sketches of it.
