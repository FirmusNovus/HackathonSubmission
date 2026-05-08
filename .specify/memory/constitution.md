<!--
Sync Impact Report
Version: 1.1.0
Ratified: 2026-05-08
Last Amended: 2026-05-08

Establishes principles I-IX and Technical Invariants 1-7. Aligned with
the active spec at specs/001-verified-legal-engagement/spec.md and its
Session 2026-05-08 clarifications (FR-058..FR-061 concurrency + chain
availability, FR-015a/b consultation timeout + cancel, FR-055a
English-only UI).

Templates requiring updates: none (templates are generic).
Follow-up TODOs: none.
-->

# Firmus Novus Constitution

> Verified Legal Counsel, On-Chain.

This document is the constitution for the platform. The public brand
name appears once, in the title above; throughout the body the neutral
term "the platform" is used so that downstream artifacts may refer to
this constitution without re-inheriting the brand.

The platform connects clients with verified European legal counsel.
Clients prove they are real EU residents via selective-disclosure of an
EU resident credential; lawyers prove they are admitted to a real EU
bar via selective-disclosure of a bar-membership credential.
Engagements are brokered through escrow on chain; messages between the
parties are end-to-end encrypted with keys derived from their wallets.
The platform stores ciphertext and on-chain attestation references; it
cannot decrypt messages, unseal client identity, or forge a credential.

## Core Principles

### I. Privilege as Cryptography (NON-NEGOTIABLE)

Lawyer–client communication is encrypted with keys derived in the
browser from the parties' wallet keys via ECDH (P-256). The platform
stores ciphertext and signatures only; it MUST NOT possess decryption
keys, master keys, or any path to recovering plaintext. Attorney–client
privilege is enforced cryptographically, not contractually. If the
platform is subpoenaed for message content, it produces an unreadable
blob.

**Rationale**: privilege that depends on platform good behavior is no
privilege at all. This rule survives platform takeovers, regulatory
subpoenas, and operator mistakes. It is the cryptographic floor
everything else rests on.

### II. Pseudonymous by Default, Identifiable Only by the Holder (NON-NEGOTIABLE)

Clients prove they are real EU residents via selective disclosure. The
platform's verifier asks for **only** `age_equal_or_over.18` and
`address.country` — nothing else. Given name, family name,
nationalities, birth date, document number, full address, place of
birth, and sex never leave the wallet. The platform persists exactly
the two attributes it asked for, plus the wallet address.

Lawyers' practising attributes (jurisdiction, bar registration number,
admission date, validity end-date) are persisted because lawyers are
public-facing professionals whose credentials clients vet by name.
Lawyer name is intentionally cleartext; client name is intentionally
absent.

Identity unsealing for fraud / regulatory escalation is intentionally
NOT IMPLEMENTED in the MVP — production trajectory only.

### III. Asymmetric Mechanisms for Asymmetric Stakes

Where the parties' rights or stakes differ, the smart contract
enforces the difference, not platform policy:

- The client MAY dispute any `FUNDED` or `DELIVERED` proposal (or paid
  consultation) immediately.
- The lawyer MAY only escalate after `LAWYER_DISPUTE_COOLDOWN` (30
  days) has elapsed since they called the on-chain `markDelivered`
  action.
- The cooldown clock starts exclusively on the on-chain
  `markDelivered` call. No off-chain event advances or restarts it.
- The arbiter has escrow authority only. They MUST NOT receive any
  ability to decrypt messages or unseal identity through the
  platform's code.
- For the MVP demo scope, the arbiter address is the platform operator
  (single, hardcoded in the escrow constructor); the contract gates
  the resolve call on `msg.sender == operator`. A separated arbiter
  pool is production trajectory.

**Rationale**: norms drift under pressure; contract checks don't.
Encoding asymmetric stakes at the contract layer means they survive
platform turnover, social-engineering pressure, and incentive shifts.

### IV. Standards-Compliance Over Novelty

Every protocol the platform speaks MUST be an established standard:

| Surface | Standard |
|---------|----------|
| Credential issuance | OID4VCI (pre-authorized code grant + DPoP) |
| Credential presentation | OID4VP with DCQL |
| Credential format | SD-JWT VC (`vc+sd-jwt`) |
| Bar credential payload type | `urn:firmus-novus:LegalProfessionalAccreditation` (issuer-namespaced) |
| Client credential payload type | `urn:eudi:pid:1` (EUDI ARF) |
| On-chain attestations | EAS (Ethereum Attestation Service) |
| Wallet auth | SIWE (EIP-4361) |
| Messaging crypto | WebCrypto: ECDH P-256, AES-GCM, ECDSA P-256 |
| ZK (production trajectory) | Noir + UltraHonk (Aztec barretenberg) |

Wallet-specific quirks (validated against wwWallet) MAY be adapted;
base protocols stay standard. The platform MUST NOT invent crypto or
roll its own protocols when conformant ones exist.

### V. Quiet Web3, Loud Trust

Web3 vocabulary stays quiet in user-facing copy. Headlines say "secure
payment held until your consultation completes," not "smart-contract
escrow." Wallet addresses are truncated and rendered in a monospaced
font (e.g. `0x4f02…2c1a`). EAS-anchored, EBSI-aligned verification is
the marquee trust signal — crypto plumbing is invisible.

ETH amounts ARE shown to users (e.g. `0.0123 ETH` in fee summaries),
because ETH is what the contract holds — but always paired with a
quieter "secure payment" framing. EUR (or any other fiat currency)
MUST NOT appear in user-facing copy.

### VI. Design Tokens & Visual Discipline (NON-NEGOTIABLE)

- **Two accent colors only**: teal `#14B8A6` for actions and Web3
  signals; muted gold `#C9A961` for verification — gold MUST stay
  under 5% of visual weight on any view.
- **Typography**: Inter for UI text, Fraunces for hero / page titles.
- **Iconography**: `lucide-react` only. No emoji as UI elements.
- **Accessibility**: WCAG AA contrast everywhere; all interactive
  elements keyboard-reachable; `aria-hidden` on decorative icons.
- **Tokens**: the design system at `design/` — its `@theme` block,
  components.md, and pages.md — is the source of truth for visual
  decisions.

### VII. Two-Process Trust Boundary (NON-NEGOTIABLE)

The platform runs as **two separate Next.js OS processes** fronted by
a path-routed reverse proxy. The boundary is enforced at the process
and filesystem level, not by convention:

| Process | Port | Role | Storage | Signing keys |
|---------|------|------|---------|--------------|
| `apps/issuer` | 3001 | OID4VCI issuance only. Lets the user pick a credential type (PID or bar) after wallet+SIWE, then drives OID4VCI to the user's wallet. | `apps/issuer/data/db.sqlite` (subjects roster + flow state) | `apps/issuer/data/pid-signing-key.jwk`, `apps/issuer/data/bar-signing-key.jwk` (separate keys per credential type) |
| `apps/platform` | 3010 | Verification (OID4VP), onboarding, application surface (directory, booking, consultation, messaging, dashboard, dispute resolution). | `apps/platform/data/db.sqlite` | `apps/platform/data/operator-private-key` (for writing EAS attestations) |
| `apps/proxy` | 3000 | Path-routed reverse proxy. `/api/issuer/*` → 3001; everything else → 3010. Provides one ngrok hostname (free-tier constraint). | none | none |

The platform process MUST NOT have read access to the issuer's signing
keys or the issuer's `subjects` table. The platform validates issuer
signatures only via the issuer's public `.well-known/jwks.json` over
HTTP. The platform operator MUST NOT be able to forge a credential the
issuer would have signed (by process and filesystem isolation).

### VIII. Real Persistence, Stubbed Seams

The MVP persists everything user-visible to per-process SQLite.
Smart-contract escrow, EAS attestations, OID4VCI issuance, and OID4VP
presentation are real on-chain / real wire-protocol code paths.

Stubbed seams (clearly labeled in code, surgical to swap for
production):

| Seam | Path (planned) | Stub behavior |
|------|----------------|---------------|
| Conflict-of-interest ZK verifier | `contracts/src/StubZKConflictVerifier.sol` | Returns `true` unconditionally; the verifier interface is preserved so production drops in the bb-generated verifier. |
| Video room | `apps/platform/components/consultation/video-stub.tsx` | Placeholder canvas. |
| File storage for attachments | `apps/platform/app/api/uploads/route.ts` | Local disk under `apps/platform/data/uploads/`. |
| TIR (Trusted Issuers Registry) lookup | not implemented | Operator's manual review at attestation time stands in. |
| Identity unsealing | not implemented | Production trajectory only. |
| Account deletion / GDPR right-to-erasure | not implemented | Production trajectory only — see spec FR-section "Out of Scope." |

Stubs MUST stay self-contained and clearly labeled, so production
swaps are surgical at named seams.

### IX. Modularity for Iteration

The codebase MUST be organized so that any feature, fix, or production
swap can be performed within a single bounded module without ripple
effects across the rest of the system. Concretely:

- **Spec ↔ module mapping.** Each feature spec maps to a contiguous,
  predictable set of implementation files — its UI route(s) under
  `apps/platform/app/`, its components under
  `apps/platform/components/<feature>/`, its route handlers under
  `apps/platform/app/api/<feature>/`, its data-access calls under
  `apps/platform/lib/db/<feature>.ts`, and its tests under
  `apps/platform/__tests__/<feature>/`. The owning spec ID is named
  in a top-of-file comment.
- **Dependency direction.** Features depend on primitives; primitives
  never depend on features. Primitives live in `packages/`
  (`crypto`, `oid4vci`, `sd-jwt`, `dcql`, `db-toolkit`) or in
  `apps/platform/lib/` as named utilities (`chain/`, `verifier/`,
  `siwe/`, `format/`). Cross-feature imports between sibling features
  are forbidden by default; if one is unavoidable, the receiving
  feature MUST be promoted to the importer's dependency tier
  (typically by extracting the shared piece into `lib/` or
  `packages/`).
- **Stubs are owned by one module.** Every named seam from Principle
  VIII has exactly one module owner; the swap from stub to production
  is a single module's diff, not a cross-cutting refactor.
- **Design components are tokens-only.** Components under
  `apps/platform/components/firmus/` and `components/ui/` depend only
  on the design system's tokens (`design/css/tokens.css`) and on
  lucide-react. They MUST NOT import feature-specific business logic,
  route handlers, or data-access calls.
- **Contract layer is its own world.** The Solidity contracts at
  `contracts/src/` are independent of the application layer; the
  application reaches the chain only through
  `apps/platform/lib/chain/` bindings + `viem`. No application import
  statement names a contract source file directly.
- **Tests align with boundaries.** Unit tests live beside the module
  they test. Spec-level integration tests live per `specs/NNN-…/`.
  Playwright E2E suites are organized by customer journey, not by
  feature.

**Rationale**: hackathon code is the start of a project, not the end.
Future iterations — production-trajectory swaps and new feature slices
— must land surgically, not as system-wide rewrites. Modularity makes
"swap the stub at `lib/web3/escrow.ts` for the real one" literally a
single-file change with a single test re-run; the opposite — a
tightly-coupled codebase — turns every production swap into a
multi-week migration. This principle is engineering discipline, not a
security or trust property; it is therefore important but NOT
NON-NEGOTIABLE — pragmatic exceptions are allowed when documented in
the affected spec's Complexity Tracking section.

## Technical Invariants

The following invariants apply across all current and future code
paths. They MUST NOT be violated by future amendments without a MAJOR
version bump.

1. **No platform-held decryption keys.** Anything that decrypts must
   use a key that lives in a user's wallet. The platform never
   possesses private key material that could unseal credential
   content, message content, or hidden PID claims.
2. **EAS attestations are the on-chain handshake.** The engagement
   contract gates on EAS attestations (`verified_lawyer`,
   `verified_client`); other trust signals (TIR lookups, external
   registries) feed *into* whether the platform writes an
   attestation, not *replace* it.
3. **Asymmetric capabilities, single identity.** A user's SIWE
   Ethereum address MAY hold any subset of `[verified_client,
   verified_lawyer]` simultaneously. The contract enforces capability
   requirements per function call. (Lawyers will hold both: they
   present a PID for `verified_client` and a bar credential for
   `verified_lawyer`.) The `verified_arbiter` capability is
   production trajectory; the MVP collapses the arbiter role into the
   operator address.
4. **Issuer–Platform separation, enforced at the process boundary.**
   The issuer process holds the PID and bar signing keys; the platform
   process holds the operator key. The platform never reads the
   issuer's signing keys or the issuer's `subjects` table; signature
   validation happens only via the issuer's public JWKS over HTTP.
5. **Per-engagement message transcripts are tamper-evident.** Each
   message is signed by the sender's wallet key; messages are hashed
   into a per-engagement Merkle transcript whose root is committed on
   chain at every funds-touching event (consultation funding, proposal
   fund / mark delivered / release / refund / resolve / close). After
   such an event, the transcript root for everything before that
   point is immutable.
6. **Cooldowns are contract-enforced, not policy-enforced.** Every
   asymmetric mechanism in Principle III MUST be implemented as
   on-chain checks (`require(...)` in the resolve / escalate
   modifiers) rather than off-chain validation in the platform code.
7. **Bounded module ownership; no import cycles.** The dependency
   graph between modules in `apps/platform/` MUST be a DAG. A
   static-analysis gate (`madge --circular apps/platform/` or
   `dependency-cruiser`) MUST run in CI and block any PR that
   introduces an import cycle. Sibling features MUST NOT directly
   import each other; shared primitives are extracted to `lib/` or
   `packages/`. Each module's owning spec ID is declared in a
   top-of-file comment so reviewers can verify Principle IX's spec ↔
   module mapping at a glance.

## Engineering Rules

These are not principles (they are not constitutional non-negotiables);
they are workflow conventions for the team.

- **Role-gated routing.** Every URL under `/client/*` requires an
  authenticated user with role `CLIENT`. Every URL under `/lawyer/*`
  requires role `LAWYER`. Every URL under `/operator/*` requires the
  operator address. Middleware enforces this; pages also call
  `requireClient()` / `requireLawyer()` / `requireOperator()`
  server-side.
- **Schema is source of truth.** UI types follow SQLite schema (via a
  thin TypeScript layer); API routes return shapes derived from that
  schema.
- **Validation at every boundary** — zod for forms, route handlers,
  and external inputs.
- **Tests** — `forge test` for Solidity invariants (asymmetric
  mechanism, escrow flow, capability checks); `vitest` for
  crypto/credential code paths; Playwright for golden flows
  (sign-in, directory filter, booking, consultation complete, lawyer
  accept/decline, dispute resolution).
- **Trunk-only branching.** Commits land on `main`. Feature branches
  are not used for this project.
- **Canonical glossary.** The structured payment artifact is named
  **proposal**. The terms "milestone" and "invoice" are not used in
  any user-facing copy, schema column name, contract function name,
  test name, or spec body.

## Governance

This constitution supersedes informal norms and undocumented decisions
within the project. Amendments require:

1. A pull request modifying `.specify/memory/constitution.md` with a
   Sync Impact Report prepended as an HTML comment.
2. A version bump per semantic versioning:
   - **MAJOR**: removing a principle, redefining a non-negotiable
     rule, or relaxing a Technical Invariant.
   - **MINOR**: adding a new principle or section, or materially
     expanding existing guidance.
   - **PATCH**: clarifications, wording fixes, non-semantic
     refinements.
3. Verification that downstream artifacts (spec, plan, tasks,
   customer journeys, design system references) remain consistent
   with the amended principles.

Compliance is checked at planning time (each `/speckit-plan` run reads
this constitution for its Constitution Check step) and at code-review
time (PR reviewers verify that changes don't silently violate
principles or invariants).

**Version**: 1.1.0 | **Ratified**: 2026-05-08 | **Last Amended**: 2026-05-08
