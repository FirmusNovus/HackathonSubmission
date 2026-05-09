<!--
Sync Impact Report
Version change: (template placeholders) → 1.0.0
Bump rationale: initial ratification — the constitution is being established for the first time.
Modified principles: N/A (initial draft).
Added principles:
  - I. Privilege as Cryptography (NON-NEGOTIABLE)
  - II. Pseudonymous by Default, Identifiable Only by the Holder
  - III. Asymmetric Mechanisms for Asymmetric Stakes
  - IV. Standards-Compliance Over Novelty
  - V. Spike-Validated Before Specced
  - VI. Honest Framing of Demo vs. Production
Added sections:
  - Technical Invariants
  - Demo and Production Discipline
  - Governance
Removed sections: none (template placeholders replaced).
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ generic; no constitution-specific references to update
  - .specify/templates/spec-template.md ✅ generic; alignment OK
  - .specify/templates/tasks-template.md ✅ generic; alignment OK
  - .specify/templates/checklist-template.md ✅ generic; alignment OK
  - .specify/templates/agent-file-template.md ✅ generic; alignment OK
Runtime guidance:
  - docs/12-spec-v3.md is the canonical implementation guidance and remains consistent
  - spike/wallet-integration/ is the validated reference impl and remains consistent
Follow-up TODOs: none.

---
Sync Impact Report
Version change: 1.0.0 → 1.0.1
Bump rationale: PATCH — clarification of Invariant 4 to reflect the actual
implementation. The conceptual rule ("three entities are distinct, even when
colocated") is unchanged; the wording now records that the separation is
process-enforced (`apps/{platform,bar-issuer,pid-issuer}` with their own DBs
and signing keys, fronted by `apps/proxy`) rather than purely conventional.
No principle removed, no rule relaxed.
Modified principles: Invariant 4.
Added sections: none.
Removed sections: none.
Templates requiring updates: none (templates are generic).
Runtime guidance:
  - specs/001-lex-nova-mvp/plan.md ✅ structure diagram updated for pnpm workspace + 4 services
  - specs/001-lex-nova-mvp/data-model.md ✅ three-DB partition documented
Follow-up TODOs: none.

---
Sync Impact Report
Version change: 1.0.1 → 2.0.0
Bump rationale: MAJOR — relaxes a non-negotiable rule from Principle III.
The previous wording ("Arbiters MUST be credentialed lawyers… plus a
platform-issued `verified_arbiter` capability… The platform operator
itself MUST NOT be the arbiter") is replaced for the v3 demo scope: the
operator MAY serve as the single arbiter for the MVP, and the open
verified-arbiter pool becomes production trajectory rather than running
code. The rest of Principle III (asymmetric cooldowns, escrow-only
authority) is preserved verbatim — the contract still enforces the
30-day lawyer-side dispute cooldown and the arbiter (now the operator)
still has on-chain authority limited to splitting parked funds via
`resolveDispute`. This change is honest about a hackathon-scope decision:
the verified-arbiter capability and operator/arbiter separation remain
the production target, but the running code merges them so the demo
can ship without a separate arbiter-onboarding flow.
Modified principles: Principle II (minor reword on arbiter authority);
Principle III (third bullet rewritten); Principle VI (no semantic change,
but the new arbiter setup is now an explicit "production trajectory"
item).
Modified invariants: Invariant 3 — `verified_arbiter` removed from the
live capability set; the operator's role in granting it is replaced by
the operator-as-arbiter scope cut.
Added sections: none.
Removed sections: none. The "Demo and Production Discipline" item that
mentioned multi-sig arbiter committees is updated to reflect the new
single-operator-arbiter design and to record the previous separation
goal as production trajectory.
Templates requiring updates: none (templates are generic).
Runtime guidance:
  - specs/001-lex-nova-mvp/spec.md ✅ Session 2026-05-08 clarification + US3/4/5/FR updates record the same scope cut
  - specs/001-lex-nova-mvp/tasks.md ✅ Phase 5 simplified; Phases 6 (US4) and 7 (US5) marked production trajectory
  - contracts/src/LegalEngagementEscrow.sol ✅ `assignArbiter` removed; `resolveDispute` gates on the operator address
Follow-up TODOs: none.
-->

# Lex Nova Constitution

## Core Principles

### I. Privilege as Cryptography (NON-NEGOTIABLE)

Lawyer-client communication is encrypted with keys derived from the parties' wallet holder
keys via ECDH performed in their browsers. The platform stores ciphertext and signatures only;
it MUST NOT possess decryption keys, master keys, or any path to recovering plaintext.
Attorney-client privilege is enforced cryptographically, not contractually. If the platform
is subpoenaed for message content, it produces an unreadable blob.

**Rationale:** privilege that depends on platform good behavior is no privilege at all.
This rule survives platform takeovers, regulatory subpoenas, and operator mistakes. It is
the cryptographic floor everything else rests on.

### II. Pseudonymous by Default, Identifiable Only by the Holder

Clients prove they are real EU residents via PID with selective disclosure. The platform
sees only what the client chose to disclose: `given_name`, `family_name`, `nationalities`,
`age_equal_or_over.18`, `address.country`. Birth date, document number, full address,
place of birth, sex, and other PID claims never leave the client's wallet. Identity
unsealing for fraud / regulatory escalation is intentionally NOT IMPLEMENTED in v3 —
Tier 3.5 is production-trajectory only.

The arbiter has on-chain authority limited to splitting parked funds via `resolveDispute`;
they hold no decryption keys and no path to unsealing client identity. Even during
arbitration, the privilege boundary stays absolute — only the parties themselves can
decrypt their messages, and they choose what (if anything) to reveal. (For v3 the
arbiter address is the platform operator; see Principle III for the production
trajectory toward a separated arbiter pool.)

**Rationale:** cross-border legal advice doesn't work as a marketplace if the client must
hand over their passport to the directory site. Verified pseudonymity is the product wedge.

### III. Asymmetric Mechanisms for Asymmetric Stakes

Where the parties' rights or stakes differ, the smart contract enforces the difference,
not platform policy. Specifically:

- The client MAY dispute any `Funded` or `Delivered` milestone immediately. The lawyer
  MAY only escalate after `LAWYER_DISPUTE_COOLDOWN` has elapsed since `markDelivered`.
  This is encoded in the contract; reverts are unconditional.
- The arbiter has escrow authority only. They MUST NOT receive any ability to decrypt
  messages or unseal identity through the lex-nova codebase.
- For v3 the arbiter address is the platform operator (single, hardcoded in the
  escrow constructor). The contract gates `resolveDispute` on `msg.sender == operator`.
  This is a deliberate hackathon-scope simplification — the production trajectory is
  a separated arbiter pool of credentialed lawyers each holding a `verified_arbiter`
  capability granted by the operator after manual review, with the operator itself
  forbidden from acting as arbiter. That separation is documented in
  [docs/12-spec-v3.md](../../docs/12-spec-v3.md) under production trajectory and
  remains the long-term design.

**Rationale:** norms drift under pressure; contract checks don't. Encoding asymmetric
stakes at the contract layer means they survive platform turnover, social-engineering
pressure, and incentive shifts. The operator-as-arbiter cut for v3 trades the
separation-of-powers story for a shippable demo; Principle VI then requires us to be
explicit on stage that the production design separates the roles.

### IV. Standards-Compliance Over Novelty

Every protocol the platform speaks MUST be an established standard: OID4VCI for issuance,
OID4VP with DCQL for presentation, SD-JWT VC for credential format, EAS for on-chain
attestations, EUDI ARF for credential payloads (`urn:lex-nova:LegalProfessionalAccreditation`,
`urn:eudi:pid:1`), SIWE for wallet auth, WebCrypto ECDH/AES-GCM/ECDSA for messaging,
Noir + UltraHonk for ZK. We MUST NOT invent cryptography or roll our own protocols
when conformant ones exist. We MAY adapt to wallet-specific quirks (documented as
"Validated wwWallet constraints" in the spec) but the base protocols stay standard.

**Rationale:** the project rides the EUDI / EBSI regulatory tailwind only if it's
interoperable. The moment we invent our own primitives we leave the ecosystem we want
to ride. Standards-compliance is also what lets the production trajectory be a
swap-the-trust-anchor change rather than a rewrite.

### V. Spike-Validated Before Specced

Every claim about wallet behavior, protocol shape, or external service compatibility
MUST be backed by working code in [`spike/wallet-integration/`](../../spike/wallet-integration/)
that has been run against real systems before being asserted in the spec. The spike is
the source of truth for what works; the spec describes the spike.

Diagnostic `console.log` traces in spike code MUST be retained even after the bug they
were added for is solved. They are reference material that documents the actual wire
shapes external systems emit, and the production implementation will read them.

**Rationale:** the wwWallet integration uncovered roughly fifteen non-obvious constraints
(DCQL not `presentation_definition`; `client_id` uses `x509_san_dns:<hostname>` Draft-23
syntax; `vp_token` is a JSON-stringified object with string-or-array values; metadata
`Cache-Control: no-store` is required; the `iss` claim must be an HTTPS URL not the
issuer DID; etc.). None of these were discoverable from documentation alone.

### VI. Honest Framing of Demo vs. Production

The spec, demo, and walkthrough MUST distinguish what runs as working code today from
what is documented production trajectory. Stand-in issuers are labeled stand-in, not
"the bar." TIR lookups are slide-only because our did:key isn't TIR-registered (and
couldn't be — accreditation is paperwork-gated even on the conformance environment).
Identity unsealing is explicitly not built. Slides describe what production adds; they
never disguise gaps as features.

There are exactly two categories: **running code** and **production trajectory**.
There is no "we sort of have it" middle ground.

**Rationale:** judges, investors, and regulators can smell handwave. The honest framing
is a stronger pitch than the dishonest one — "we built the cryptographic spine; here's
the production trajectory" beats "and the arbiter can magically unseal" every time.

## Technical Invariants

The following invariants apply across all current and future code paths. They MUST NOT
be violated by future amendments without a MAJOR version bump:

1. **No platform-held decryption keys.** Anything that decrypts must use a key that
   lives in a user's wallet. The platform never possesses private key material that
   could unseal credential content, message content, or hidden PID claims.
2. **EAS attestations are the on-chain handshake.** The engagement contract gates on
   EAS attestations (`verified_lawyer`, `verified_client`, `verified_arbiter`); other
   trust signals (TIR lookups, external registries) feed *into* whether the platform
   writes an attestation, not *replace* it.
3. **Asymmetric capabilities, single identity.** A user's SIWE Ethereum address MAY
   hold any subset of `[verified_client, verified_lawyer]` simultaneously. The
   contract enforces capability requirements per function call. The operator's
   `Manage Capabilities` admin grants `verified_lawyer` / `verified_client` only via
   OID4VP audit trail (never directly), and may revoke any capability when an
   upstream registry signals revocation. The `verified_arbiter` capability and a
   separated arbiter pool are explicit production trajectory; v3 collapses the
   arbiter role into the operator address (Principle III).
4. **Three-entity separation, enforced at the process boundary.** The bar issuer
   (signing JWK + roster), the PID provider (signing JWK + roster), and the platform
   operator (Ethereum address writing EAS attestations) are distinct entities and run
   as **separate Next.js processes** (`apps/bar-issuer`, `apps/pid-issuer`,
   `apps/platform`) with **separate SQLite databases** and **separate signing keys on
   disk**. A single path-routed reverse proxy (`apps/proxy`, port 3000) fronts all three
   so they share one ngrok hostname (free-tier constraint), but the platform process
   has no read access to any issuer's DB or key file. The platform validates an
   issuer's signature only via that issuer's public `.well-known/jwks.json` over HTTP.
   The platform operator MUST NOT be able to forge a credential the bar would have
   signed (they don't hold the bar's key — by process and filesystem isolation, not
   just convention).
5. **Per-engagement message transcripts are tamper-evident.** Each message is signed
   by the sender's wallet key; messages are hashed into a per-engagement Merkle
   transcript whose root is committed on chain at every milestone fund/release event.
   After a milestone is released, the transcript root for everything before that point
   is immutable.
6. **Cooldowns are contract-enforced, not policy-enforced.** Every asymmetric mechanism
   in Principle III MUST be implemented as on-chain checks (`require(...)` in the
   `resolveDispute`/`escalateMilestone` modifiers) rather than off-chain validation
   in the platform code. The contract is the trust anchor for the asymmetric guarantees.

## Demo and Production Discipline

The hackathon demo (`spike/wallet-integration/` + the v3 implementation) is the
immediate scope. Production trajectory items appear in three places: the spec's
"What's no longer in scope" / "Production replacement" sections, the demo's closing
slides, and the walkthrough's glossary entries that contrast v3 with production.

The following are intentionally **not implemented in v3** and MUST stay slide-only
until a future MAJOR-version amendment:

- TIR (Trusted Issuers Registry) lookups — cannot be demonstrated meaningfully against
  self-issued credentials; production requires our did:keys to be registered, which
  requires multi-week TAO accreditation.
- Threshold cryptography for identity escrow (Tier 3.5) — research-grade engineering;
  out of weekend scope.
- Separated arbiter pool — for v3 the operator address is the single arbiter
  (Principle III); a verified-arbiter capability granted to credentialed lawyers,
  with the operator forbidden from acting as arbiter, is explicit production
  trajectory. Multi-sig arbiter committees are a further production-trajectory
  refinement on top of that.
- ERC-5564 stealth addresses for per-engagement client unlinkability — OID4VCI batch
  unlinkability covers the audience-facing claim.
- QES (Qualified Electronic Signatures) via QTSP partner — paperwork-gated onboarding,
  multi-week minimum.
- Full XMTP messaging substrate — the encrypted-localStorage stub captures the same
  cryptographic shape; XMTP is a transport swap, not a protocol change.

The discipline is uniform: every time someone claims "we have X" in the spec or on
stage, X must either be running code or be explicitly labelled as production
trajectory. There is no third category. (See Principle VI.)

## Governance

This constitution supersedes informal norms and undocumented decisions within the
project. Amendments require:

1. A pull request modifying `.specify/memory/constitution.md` with a Sync Impact
   Report prepended as an HTML comment.
2. A version bump per semantic versioning:
   - **MAJOR**: removing a principle, redefining a non-negotiable rule, or relaxing
     a Technical Invariant.
   - **MINOR**: adding a new principle or section, or materially expanding existing
     guidance.
   - **PATCH**: clarifications, wording fixes, non-semantic refinements.
3. Verification that downstream templates (`plan-template.md`, `spec-template.md`,
   `tasks-template.md`, `checklist-template.md`) and runtime guidance (the v3
   spec/demo/walkthrough at `docs/12-spec-v3.md`, `docs/13-demo-v3.md`,
   `docs/14-project-walkthrough-v3.md`) remain consistent with the amended principles.
   Inconsistencies MUST be resolved in the same PR or flagged in the Sync Impact
   Report as deferred items with TODO markers.

Compliance is checked at planning time (each `/speckit-plan` run reads this constitution
for its Constitution Check step) and at code-review time (PR reviewers verify that
changes don't silently violate principles or invariants).

The v3 spec at [docs/12-spec-v3.md](../../docs/12-spec-v3.md) is the canonical
implementation guidance. The wallet-integration spike at
[spike/wallet-integration/](../../spike/wallet-integration/) is the validated reference
for OID4VCI/OID4VP/messaging code paths. Both supersede this constitution for
*implementation details*; this constitution supersedes both for *non-negotiable
principles and invariants*.

**Version**: 2.0.0 | **Ratified**: 2026-05-06 | **Last Amended**: 2026-05-08
