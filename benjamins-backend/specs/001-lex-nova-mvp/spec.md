# Feature Specification: Lex Nova MVP — Verified-Pseudonymous Legal Engagement

**Feature Branch**: `001-lex-nova-mvp`
**Created**: 2026-05-06
**Status**: Draft
**Input**: User description: "look into the v3 docs (especially the spec) and the spike project to get an idea what needs to be done"

## Clarifications

### Session 2026-05-06

- Q: What asset denominates milestone escrow funds in the MVP? → A: Native ETH for the MVP, with the escrow contract designed so a stablecoin variant can be deployed later without breaking the public API.
- Q: How long is the lawyer-side dispute cooldown, and when does it start? → A: 30 days, starting only when the lawyer marks the milestone delivered. Time spent before delivery (engagement setup, ongoing communication, drafting work) does not count toward the cooldown.
- Q: How does an engagement end? → A: Close-only-when-clean. Either party may close an engagement only when no milestone is in funded, delivered, or disputed state. Disputed milestones must be arbiter-resolved first; funded-undelivered milestones must be refunded-and-cleared (either party may trigger a full refund of an undelivered milestone) before close. Closing is a single on-chain action that anchors the final transcript root and moves the engagement to a terminal state.
- Q: How is the first milestone amount agreed, and what is negotiable in the engagement handshake? → A: Inverted flow — the client posts the matter (description/jurisdiction/practice-area only, no amount). The client then sends an engagement request referencing the matter and a chosen lawyer. The lawyer either declines or replies with a first-milestone proposal (amount + optional short scoping note, signed by the lawyer's wallet). The client then either accepts by funding the proposed amount, counters with a different amount (+ optional note, signed by the client's wallet), or declines. The two parties iterate signed proposals/counters until one side declines or the milestone is funded. Subsequent milestones (after the first is released) are negotiated through normal in-engagement messaging.
- Q: How is a particular arbiter assigned to a particular dispute? → A: First-claim model. When a milestone enters the disputed state, any wallet holding the verified-arbiter capability MAY claim it; the contract records the claiming arbiter. Once claimed, only the claiming arbiter MAY resolve that dispute. Other arbiters can no longer claim or act on it. For the MVP with a single arbiter (Eva — promoted from her verified-lawyer status by the operator on stage), the queue collapses to one claimable item, but the contract semantics already support a multi-arbiter pool. **Superseded 2026-05-07 — see that session for the simplified single-arbiter model.**

### Session 2026-05-07

- Q: Should the contract support an open arbiter pool (first-claim) or a platform-managed assignment? → A: Platform-managed assignment. The operator continues to grant the `verified_arbiter` capability to a pool of vetted lawyers (unchanged from FR-006 / US5). When a dispute is filed, the operator calls `assignArbiter(engagementId, milestoneIndex, arbiterAddress)` to designate which capability-holder handles that specific dispute; the contract verifies the address holds `verified_arbiter` at assignment time. Once assigned, only that arbiter can resolve that dispute. The first-claim race is replaced with operator selection — same end state (one arbiter is bound to the dispute), simpler mechanics, and it matches the actual MVP workflow where the operator already curates the pool. **Superseded 2026-05-08 — see that session for the operator-as-arbiter scope cut.**
- Q: Which milestone-state-changing actions need to be on-chain, and which can be off-chain signed artifacts? → A: Only ETH movement is on-chain: `fundMilestone`, `releaseMilestone`, `mutualRefundMilestone`, and `resolveDispute` (the arbiter's payout). Milestone *creation* (`proposeMilestone`) becomes an off-chain signed offer carried in `fundMilestone` calldata. `markDelivered` stays on-chain because Constitution Invariant 6 requires the lawyer-side cooldown to be contract-enforced — but in practice the lawyer only calls it when the client is unresponsive and they want to start the 30-day clock; the happy path never touches it. Transcript anchoring drops from "after every milestone tx" to "at engagement close + on dispute escalation."
- Q: Can either party unilaterally refund a funded-undelivered milestone, or does refund require mutual consent? → A: Mutual consent. Both parties sign a `MutualRefundAuthorization` off-chain; the contract verifies both signatures on `mutualRefundMilestone(sigs)`. This closes the loophole where a lawyer could rage-yank a client's deposit without the client's agreement. Arbiter-ruled refunds (full split-to-client) still flow through `resolveDispute`.
- Q: When does the client's `releaseMilestone` become callable — only after `markDelivered`, or any time after `fundMilestone`? → A: Any time after `fundMilestone`. The client clicks release whenever they're satisfied; the contract no longer gates release on the `Delivered` state. This eliminates the lawyer's mandatory `markDelivered` tx in the happy path. The lawyer's signed `DeliveryAttestation` is still surfaced in the chat as evidence and as the cooldown trigger if escalation is later needed.

### Session 2026-05-08

- Q: For the v3 hackathon scope, should the arbiter remain a separated, capability-gated wallet from a vetted pool, or collapse to the platform operator address? → A: Collapse to the operator address. The contract's `resolveDispute` gate becomes `msg.sender == operator`, the `assignArbiter` step is removed entirely, and the `verified_arbiter` capability and its onboarding/admin surface become production trajectory rather than running code. The asymmetric dispute mechanism is preserved verbatim (client immediate, lawyer 30-day cooldown — Constitution Inv 6); only the identity of the resolver changes. This is a deliberate hackathon-scope simplification. The constitution was amended to v2.0.0 to make this change honest rather than a silent caveat — see [.specify/memory/constitution.md](.specify/memory/constitution.md) Sync Impact Report. **This supersedes the 2026-05-07 platform-managed-assignment clarification.**
- Q: For the v3 scope, are conflict-of-interest ZK checks (User Story 4) and the operator capability administration UI (User Story 5) part of the running code? → A: No. Both are now production trajectory only. US4's stub ZK verifier (already in the contract) stays in place and continues to accept any proof; the lawyer-side conflict commitment + Noir circuit + browser-side proof generation are slide-only. US5's operator admin page is not built; capability revocation is performed via direct contract calls when needed. This frees the demo to focus on the core privilege-as-cryptography + asymmetric-escrow narrative without attempting the full regulatory surface in 2-3 weekend days.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pseudonymous client engages a verified lawyer with milestone-based escrow (Priority: P1)

A cross-border EU resident (Marta, a Spanish founder needing German employment-law advice) lands on the platform, connects a wallet, proves she is a real EU resident with selected attributes from her national identity wallet, posts a legal matter (a description of her problem, no price), browses lawyers whose bar credentials have been cryptographically verified, sends an engagement request to one of them, receives the lawyer's signed first-milestone proposal, accepts it by funding the proposed amount into escrow, exchanges end-to-end-encrypted messages with the lawyer, accepts deliverables, and releases the milestone. The lawyer prices the work; the lawyer never learns Marta's birth date, document number, or full address; the platform never sees their conversation in plaintext.

**Why this priority**: This is the core promise of the product — a marketplace where "verify the professional, not the client" works without the client uploading documents to a directory site. Without this slice, there is no platform; everything else (onboarding, disputes) exists to support it. It is also the demo's primary narrative arc.

**Independent Test** (with the ordering caveat below): a fresh client wallet (with a valid PID-equivalent credential) and a fresh lawyer wallet (with a valid bar-equivalent credential) both exist. The client can complete: post a matter (no amount) → see at least one verified lawyer in the directory → send an engagement request → receive the lawyer's signed first-milestone proposal → fund the proposed amount → exchange at least one message round-trip → receive a delivered marker → release funds. The lawyer's recorded view of the client never includes more than the disclosed attribute subset (given name, family name, nationalities, age-over-18, country of residence). **Ordering caveat**: this story relies on a verified lawyer existing in the directory, which is produced by User Story 2's onboarding flow. On a freshly-deployed platform, US2 must run for at least one lawyer before US1 can be exercised end-to-end.

**Acceptance Scenarios**:

1. **Given** a client whose wallet holds a valid EU resident credential and a lawyer whose wallet holds a valid bar credential that has already produced an on-chain attestation, **When** the client connects their wallet, presents the resident credential, and posts a matter, **Then** the platform records the client as verified and the matter as open, without persisting any disclosed-but-redacted attribute.
2. **Given** an open matter and a directory of verified lawyers, **When** the client selects a lawyer and sends an engagement request (matter reference only, no amount), **Then** the lawyer receives the request and can decline or respond with a signed first-milestone proposal (amount + optional scoping note) without learning any client attribute beyond the disclosed subset.
3. **Given** a lawyer's first-milestone proposal, **When** the client either funds the proposed amount or signs and submits a counter-proposal with a different amount, **Then** the engagement transcript records the negotiation and the parties iterate until one side declines or the client funds a proposal; only at the funding moment does the engagement become active.
4. **Given** an active engagement (first milestone funded), **When** the funds are held in escrow under contract control (not in any party's account or the platform's account), **Then** both parties can begin in-engagement messaging.
5. **Given** an active engagement, **When** either party sends a message, **Then** the platform can prove (via on-chain transcript anchoring) that the message existed at a given time without storing or being able to read its contents.
6. **Given** a milestone the lawyer has marked delivered, **When** the client accepts the deliverable, **Then** the funds are released from escrow to the lawyer's address in a single on-chain action.
7. **Given** an engagement with the first milestone released, **When** either party proposes a follow-up milestone through in-engagement messaging, **Then** the parties can iterate (propose → accept/counter → fund → deliver → release) until either party closes the engagement (closure is permitted only when no milestone is funded, delivered, or disputed).

---

### User Story 2 - Lawyer onboards via verifiable bar credential and is attested on-chain (Priority: P1)

A practicing lawyer (Anna, admitted to the German bar) connects her wallet, presents a verifiable bar credential from her wallet, and — if the credential is valid — receives an on-chain attestation that binds her wallet address to "verified lawyer." From that point forward, the engagement contract treats her wallet as eligible to accept client engagements; her profile appears in the directory; and her practising attributes (jurisdiction, specialty area) are visible to clients without revealing the underlying credential.

**Why this priority**: This is the supply side of the marketplace and the substrate of the platform's core defensibility claim ("every lawyer here is currently admitted to a real EU bar"). Without this story, lawyers cannot enter the system, so Story 1 has no counterparty. It is a separate user journey from Story 1 because it is performed by a different actor at a different time and is independently testable.

**Independent Test**: A wallet with a fresh bar credential (no prior attestation) can run end-to-end: connect → present credential → receive on-chain attestation → appear in the public directory with the disclosed practising attributes → be selectable by a client. A wallet without a valid credential is rejected and never gets an attestation.

**Acceptance Scenarios**:

1. **Given** a wallet with a valid, unexpired bar credential, **When** the lawyer initiates onboarding and presents the credential from their wallet, **Then** the platform writes an on-chain attestation associating the wallet address with the disclosed practising attributes.
2. **Given** a wallet with an expired or signature-invalid credential, **When** the lawyer initiates onboarding, **Then** the platform refuses to write an attestation and surfaces a clear, non-technical error.
3. **Given** an attested lawyer wallet, **When** any unauthenticated visitor browses the directory, **Then** they see the lawyer's disclosed attributes (e.g., "Munich Bar, Employment Law") without seeing the underlying credential payload or anything that ties the wallet to a real-world person beyond what the lawyer chose to disclose.
4. **Given** an attested lawyer wallet that an upstream registry later marks as no-longer-admitted, **When** the platform operator revokes the attestation through an administrative action, **Then** the wallet immediately disappears from the directory and cannot accept new engagements.

---

### User Story 3 - Asymmetric dispute resolution by an arbiter (Priority: P2)

When the parties disagree about whether a milestone was delivered, the dispute path is asymmetric. The client may dispute any funded or delivered milestone immediately. The lawyer may only escalate after a cooldown period has elapsed since they marked the milestone delivered on chain (so a non-responsive client cannot strand the funds, but a lawyer cannot pressure a client by threatening immediate escalation). For the v3 demo scope, the platform operator address is the arbiter — the contract's `resolveDispute` gate is `msg.sender == operator`, and the operator decides how to split the parked funds. The operator sees only the parked escrow amount and any evidence the parties choose to surface; identity unsealing is intentionally not implemented and the parties stay pseudonymous. (Production trajectory: a separated arbiter pool of credentialed lawyers, with the operator forbidden from acting as arbiter — see Constitution Principle III.)

**Why this priority**: A marketplace without a dispute path is not a marketplace; users will not fund anything if there is no recourse. The asymmetric mechanism — client immediate, lawyer cooldown — is what makes "the contract enforces fairness, not platform policy" tangible on stage. It is P2 rather than P1 because the demo can run without entering this path on the happy path, but a viable product requires it.

**Independent Test**: An engagement with a funded milestone exists. Two independent flows are testable: (a) the client disputes that milestone immediately (whether or not the lawyer has marked it delivered); the operator resolves it with a split. (b) The lawyer marks the milestone delivered on chain to start the cooldown clock; after the cooldown has elapsed without client action, the lawyer escalates; the operator resolves with a different split. In both flows, the resolved amounts arrive at the correct addresses and the on-chain record reflects the outcome.

**Acceptance Scenarios**:

1. **Given** a milestone in the funded or delivered state, **When** the client triggers a dispute, **Then** the milestone enters a disputed state immediately and the lawyer cannot unilaterally release the funds.
2. **Given** a milestone the lawyer marked delivered less than the cooldown period ago, **When** the lawyer attempts to escalate, **Then** the system refuses and tells the lawyer when escalation will become possible.
3. **Given** a delivered milestone where the cooldown has elapsed and the client has neither released nor disputed, **When** the lawyer escalates, **Then** the milestone enters a disputed state and the operator can resolve it.
4. **Given** a disputed milestone, **When** the platform operator issues a resolution specifying how the parked amount is split between the lawyer and client addresses, **Then** the funds move accordingly in a single on-chain action and the engagement records the outcome.
5. **Given** a disputed milestone, **When** any wallet other than the operator (including the engagement parties) attempts to issue a resolution, **Then** the contract rejects it.
6. **Given** the operator issues a resolution whose split sum does not equal the parked milestone amount, **When** the call is submitted, **Then** the contract reverts and no funds move.
7. **Given** an active dispute, **When** either party chooses to share a portion of the message history with the operator/arbiter (by decrypting it for them out of band), **Then** sharing is the parties' choice; the platform itself never possesses material that could decrypt the history.

---

### User Story 4 - Conflict-of-interest check before engagement (Priority: production trajectory only)

> **Status (2026-05-08):** moved out of v3 scope. The contract retains the
> `StubZKConflictVerifier` (returns true unconditionally), so the engagement
> open path still exercises the verifier interface, but no real ZK proof is
> generated and no lawyer-side conflict commitment UI exists. The full
> design below remains the production target — the interface boundary in
> the contract does not change when this story is built out.

Before the client funds the first milestone, the platform proves to itself (and to the lawyer) that the client is not already a current client of the same lawyer on a conflicting matter — without revealing the client's identity to the lawyer and without the lawyer's existing client list being exposed to the platform. The proof is a zero-knowledge non-membership proof against a commitment to the lawyer's current client set; if it succeeds, engagement may proceed; if it fails, the engagement is blocked with a generic "conflict detected, please contact a different lawyer" message.

**Why this priority**: Conflict-of-interest checks are a regulatory expectation in legal services and a credible objection from professional bodies. The story remains in the spec because the production trajectory needs it as a hard gate, but it is not running code in v3.

**Independent Test (production)**: A lawyer has a published commitment to a (small, simulated) current client set. A client whose pseudonymous identifier is in the set cannot complete engagement; a client whose identifier is not in the set can. Neither outcome reveals the other party's identity to the counterparty.

**Acceptance Scenarios (production trajectory)**:

1. **Given** a lawyer with a published current-client-set commitment and a client whose pseudonymous identifier is not in that set, **When** the client requests engagement, **Then** the conflict check passes and engagement may proceed.
2. **Given** a lawyer with a published current-client-set commitment and a client whose pseudonymous identifier is in that set, **When** the client requests engagement, **Then** the conflict check fails and engagement is blocked.
3. **Given** any conflict check (pass or fail), **When** the result is recorded, **Then** the lawyer's client set membership is not learnable from the recorded artifact, and the client's identifier is not learnable from the lawyer's view.

---

### User Story 5 - Operator capability administration (Priority: production trajectory only)

> **Status (2026-05-08):** moved out of v3 scope. The
> `AttestationManager.revokeCapability` contract path exists and is callable
> directly (e.g., via `cast send`), but no operator admin UI is built.
> Granting `verified_arbiter` is no longer needed in v3 because the operator
> address itself serves as the arbiter (Constitution III, Session 2026-05-08).
> The full admin surface below remains the production target.

The platform operator has an administrative surface for managing the on-chain capabilities that gate behaviour: revoking an attested lawyer or client when an upstream registry signals it. Capability grants for "verified lawyer" and "verified client" are never directly issued from this surface — those only come from completed credential presentations during onboarding — preventing the operator from forging professional standing.

**Why this priority**: The system needs a way to respond to the real world (a lawyer disbarred mid-engagement). The story remains in the spec because production needs the surface, but in v3 those rare events are handled by direct contract calls rather than an admin UI.

**Independent Test (production)**: From a wallet that holds the operator role: revoking a lawyer's verified status removes them from the directory and blocks new engagements with them. Attempting to directly grant verified-lawyer status without a credential presentation is not offered as an action.

**Acceptance Scenarios (production trajectory)**:

1. **Given** the operator wallet, **When** the operator views the capability administration surface, **Then** they see all currently attested wallets with their capabilities and revocation actions.
2. **Given** an attested lawyer wallet, **When** the operator revokes the lawyer's verified status, **Then** the wallet is removed from the directory and cannot accept new engagements; existing engagements continue to their natural completion.
3. **Given** the operator wallet, **When** the operator attempts to grant verified-lawyer status to a wallet that has not presented a bar credential, **Then** the surface offers no such action.

---

### Edge Cases

- A client funds a milestone but the lawyer never marks it delivered: the client can dispute it at any time, and the funds do not get stranded.
- A lawyer marks a milestone delivered but the client neither releases nor disputes: after the cooldown, the lawyer can escalate and the operator resolves it.
- A wallet's credential expires mid-engagement: ongoing engagements continue (the attestation was valid when written); the wallet cannot accept new engagements.
- A client connects without a wallet that holds a valid resident credential: they can browse but cannot post a matter or fund an engagement, and the gating reason is shown clearly.
- A user holds multiple capabilities on the same wallet (e.g., a lawyer who is also a client on a different matter): the system treats each capability check independently per action, not per user.
- A message exceeds the size that fits comfortably in the on-chain anchoring scheme: the message is still delivered and anchored; size limits are enforced per message, not per session.
- The operator wallet is compromised: the operator can revoke capabilities but cannot retroactively decrypt past messages, unseal client identity, or reassign escrow funds; these are guarded by the contract and by the cryptography, not by operator trust.
- The operator wallet (which serves as the arbiter in v3) is compromised: the attacker can split escrow on disputed milestones but cannot decrypt messages, unseal identity, or move funds on non-disputed milestones (release/refund still require the parties' txs/signatures). Production trajectory separates the arbiter role from the operator so this attack surface narrows further.
- A user opens a second browser without their wallet: they can browse public information but cannot view their engagements (decryption keys live in the wallet, not the platform).
- A party tries to close an engagement that has a funded-undelivered or delivered-unreleased milestone: closure is refused; the UI surfaces the blocking milestone and the actions available (mutual refund, release, or wait for the cooldown to elapse and escalate).
- A lawyer abandons mid-work (stops responding) on a funded-undelivered milestone: the client cannot unilaterally yank the deposit. Recourse is to file a dispute (no cooldown for the client side); the operator resolves the split. Mutual refund — the cheaper, gas-light path — only works if the lawyer is reachable enough to countersign.
- The operator goes silent on an active dispute: the v3 design has no automatic reassignment because the operator is the only arbiter. The parked funds wait until the operator acts. Production trajectory introduces a separated arbiter pool with reassignment — see Constitution Principle III.

## Requirements *(mandatory)*

### Functional Requirements

#### Identity, capabilities, and onboarding

- **FR-001**: The platform MUST allow a user to connect a wallet and prove ownership of an Ethereum address before performing any state-changing action.
- **FR-002**: The platform MUST onboard a lawyer only after the lawyer presents a verifiable bar credential from their wallet, and MUST refuse onboarding for credentials that are expired, signature-invalid, or do not contain the expected practising attributes.
- **FR-003**: The platform MUST onboard a client only after the client presents a verifiable EU resident credential from their wallet that discloses age-over-18 and country of residence. The platform MUST persist only those two facts plus the wallet address. Given name, family name, and nationalities MUST NOT be requested by the verifier and MUST NOT be persisted by the platform under any circumstances. The lawyer learns the client's name, if at all, through end-to-end-encrypted in-engagement messaging that the platform cannot read.
- **FR-004**: The platform MUST persist on-chain attestations binding a wallet address to its verified capability (verified lawyer, verified client), and MUST NOT persist the underlying credential payload. (The `verified_arbiter` capability is production trajectory only — see Constitution III.)
- **FR-005**: A single wallet MAY hold any subset of capabilities simultaneously; capability checks MUST be per-action, not per-user.
- **FR-006**: The contract MUST support operator-initiated revocation of any capability via `AttestationManager.revokeCapability`. In v3 this is invoked via direct contract calls (no admin UI is built); production trajectory adds the operator admin surface (US5).
- **FR-007**: The operator MUST NOT be able to directly grant verified-lawyer or verified-client capability — those originate only from completed credential presentations. The contract enforces this via the `_attestSelfPermissioned` semantics in `AttestationManager`.

#### Matters and engagements

- **FR-008**: A verified client MUST be able to post a matter consisting of a free-form description, a target jurisdiction, and a target practice area. A matter MUST NOT carry a proposed amount; pricing is the lawyer's response, not the client's request.
- **FR-009**: The platform MUST display a directory of verified lawyers showing each lawyer's disclosed practising attributes, and MUST allow filtering by jurisdiction and practice area.
- **FR-010**: A verified client MUST be able to send an engagement request to a specific verified lawyer referencing a specific posted matter. The request MUST NOT include a proposed amount.
- **FR-011**: A verified lawyer who has received an engagement request MUST be able to either decline it or respond with a first-milestone proposal consisting of an amount denominated in the milestone's escrow asset and an optional short scoping note. The proposal MUST be signed by the lawyer's wallet.
- **FR-011a**: A verified client who has received a first-milestone proposal MUST be able to (i) accept it by funding the proposed amount into escrow in a single on-chain action, (ii) counter it with a different amount and an optional short note signed by the client's wallet, or (iii) decline it.
- **FR-011b**: After a client counter, the lawyer MUST be able to re-propose (with a new amount + optional note) or decline. The two parties MAY iterate signed proposals/counters until one side declines or the client funds a proposal. Each proposal/counter MUST be appended to the engagement's transcript so the negotiation history is part of the per-engagement record.
- **FR-011c**: An engagement is considered active only after the client funds the first milestone. Until that moment, no in-engagement messaging is available; the matter description and the signed proposals/counters are the entire pre-funding record.
- **FR-011d**: After the first milestone is released, either party MAY propose a follow-up milestone through in-engagement messaging; follow-up proposals follow the same accept/counter/decline pattern but happen inside the active engagement rather than as a fresh request.
- **FR-012**: An engagement record MUST persist: the two parties' addresses, the matter reference, the ordered list of milestones (including any pre-funding proposal/counter history for the first milestone), and a transcript anchor.

#### Milestone escrow

- **FR-013**: The escrow contract MUST hold funds for a milestone from the moment the client funds it until the moment it is released, disputed-and-resolved, or mutually refunded; no other state MAY hold the funds. Milestone amounts MUST be denominated in the chain's native asset (ETH on the demo chain). The contract surface MUST be shaped so that an ERC-20-denominated variant could later be added without changing the engagement, milestone, or dispute APIs visible to clients/lawyers/arbiters.
- **FR-013a**: A milestone MUST be created on chain atomically with its funding transaction. The lawyer's (or, for a counter, the client's) signed `MilestoneOffer` artifact (containing engagementId, amount, optional note, and a nonce) MUST be carried in the calldata of `fundMilestone` and verified on chain against the engagement's lawyer/client address. There MUST NOT be a separate `proposeMilestone` on-chain transaction; milestone proposals are off-chain signed offers exchanged through in-engagement messaging.
- **FR-014**: The lawyer MAY mark a funded milestone as delivered on chain, recording the delivery time. This action is OPTIONAL in the happy path — the client's release does not require it. Its sole on-chain purpose is to start the lawyer-side dispute cooldown clock (FR-017); a lawyer who anticipates client unresponsiveness calls this to enable later escalation. The lawyer SHOULD also post a signed off-chain `DeliveryAttestation` into the engagement transcript as the user-visible "delivered" indicator.
- **FR-015**: The client MUST be able to release a milestone in either the funded or delivered state at any time, sending the funds to the lawyer's address in a single on-chain action. Release MUST NOT be gated on the lawyer having called `markDelivered`.
- **FR-016**: The client MUST be able to dispute a funded or delivered milestone immediately.
- **FR-017**: The lawyer MUST be able to escalate a delivered milestone only after a 30-day cooldown has elapsed since the delivery time. The cooldown clock starts exclusively at the moment the lawyer calls `markDelivered` on chain; no other event (engagement creation, first message, milestone funding, off-chain delivery attestation, or message activity during work) advances or restarts it. The contract MUST enforce this cooldown directly (Constitution Invariant 6); off-chain validation alone is insufficient. Attempts before the cooldown MUST be rejected with a clear message including the time at which escalation becomes possible.
- **FR-018**: A disputed milestone MUST NOT be releasable, refundable, or re-disputable by either party until the arbiter resolves it.

#### Dispute resolution

- **FR-019**: For the v3 demo scope, the platform operator address is the arbiter. The contract's `resolveDispute(engagementId, milestoneIndex, amountToLawyer, amountToClient)` MUST gate on `msg.sender == operator`; any other caller (including the engagement parties) MUST be rejected. The operator decides how the parked amount is split. Production trajectory replaces this with a separated arbiter pool and a per-dispute assignment step (Constitution III); the parties' dispute/escalate APIs do not change between v3 and the production model.
- **FR-019a**: The split MUST equal the parked milestone amount to the wei. The contract MUST reject any resolve call where `amountToLawyer + amountToClient != milestone.amount`.
- **FR-020**: *(Reserved — was the assignable-arbiter capability gate; folded into FR-019 for v3.)*
- **FR-021**: The arbiter (the operator in v3) MUST NOT receive, through any platform-issued action, any ability to decrypt messages, unseal client identity, or affect non-disputed engagements. The privilege boundary stays absolute regardless of who holds the arbiter role.
- **FR-022**: After resolution, the disputed milestone MUST move to a terminal "resolved" state and the engagement MAY continue to subsequent milestones.

#### Engagement closure

- **FR-022a**: Either party MUST be able to close an engagement, but only when no milestone is in funded, delivered, or disputed state. Closing while any such milestone exists MUST be rejected with a message identifying which milestone(s) block closure.
- **FR-022b**: Refunding a funded-undelivered milestone (returning the parked amount to the client's address) MUST require both parties' signatures. Either party MAY initiate the request; the contract executes `mutualRefundMilestone` only when it can verify a valid `MutualRefundAuthorization` signed by both the client and the lawyer. Unilateral refund by either party alone MUST NOT be possible. (Refund as the outcome of a dispute is governed by FR-019/019a — the arbiter splits to the client.)
- **FR-022c**: A closed engagement MUST be terminal — no further milestones, messages, or state transitions are permitted, and the final transcript root MUST be anchored on chain at the moment of closure.

#### End-to-end-encrypted messaging

- **FR-023**: Messages between the parties of an engagement MUST be encrypted with keys derived from the parties' wallet keys, and the platform MUST NOT possess any key material capable of decrypting them.
- **FR-024**: Each message MUST be signed by the sender's wallet and verifiable as originating from that wallet by any party who later receives it.
- **FR-025**: The platform MUST anchor an engagement-scoped transcript commitment on chain at engagement closure (FR-022c) and at the moment a dispute is filed or escalated, such that the transcript up to that point becomes tamper-evident under the arbiter's review and at final settlement. Anchoring MUST NOT fire as a follow-up transaction to every milestone fund / release tx; the off-chain Merkle root advances continuously as messages accumulate, but the on-chain mirror is updated only at the events listed above.
- **FR-026**: A user without their wallet MUST NOT be able to read message history; the platform MUST surface a clear "connect your wallet to view" state instead of partial content.

#### Conflict-of-interest check

- **FR-027** *(production trajectory only — not v3 scope)*: Before the first milestone of an engagement is funded, the platform SHALL verify that the client's pseudonymous identifier is not a member of the lawyer's published current-client-set commitment, and SHALL block the engagement if membership is detected. v3 leaves the contract's `StubZKConflictVerifier` (returns true unconditionally) in place — the on-chain interface boundary is preserved so the production version is a verifier-swap, not a contract change.
- **FR-028** *(production trajectory only — not v3 scope)*: The conflict check SHALL NOT reveal the lawyer's current client set to the client or to the platform, and SHALL NOT reveal the client's identifier to the lawyer beyond what is already disclosed by the engagement.

#### Visibility and pseudonymity

- **FR-029**: A lawyer's *server-rendered* view of a client party they are engaged with MUST contain only the wallet address, country of residence, and the age-over-18 boolean — the same shape as the on-chain `verified_client` attestation. The platform MUST NOT hold any other identifying information about the client. Names or any further detail MUST originate from end-to-end-encrypted in-engagement messaging that the platform cannot read.
- **FR-030**: The public directory MUST show only the disclosed practising attributes of a lawyer, never the underlying credential payload, never the wallet's other engagements, and never any client information.
- **FR-031**: The platform MUST NOT reveal a wallet's full engagement history to anyone but that wallet's owner (and the engagement counterparty for engagements they share).

#### Anti-tamper and audit

- **FR-032**: All capability changes (grant, revoke), all on-chain milestone state transitions (fund, mark-delivered when invoked, release, dispute, escalate, mutual-refund, resolve), and all transcript anchors MUST be recorded on chain. Off-chain signed artifacts (`MilestoneOffer`, `DeliveryAttestation`, `MutualRefundAuthorization`) MUST be preserved by the platform as part of the per-engagement transcript and committed to the on-chain root at the events listed in FR-025.
- **FR-033**: The platform MUST NOT possess the ability to forge, retroactively edit, or backdate any of the on-chain records listed above; modification MUST require a new transaction signed by the appropriate wallet.

### Key Entities

- **User Wallet**: The user's controlled key material in their wallet. Holds zero or more verifiable credentials. Is uniquely identified by an Ethereum address. May hold zero or more capabilities (verified-lawyer, verified-client, operator). All authentication, signing, and messaging keys derive from this wallet. (verified-arbiter is production trajectory; in v3 the operator wallet itself acts as arbiter.)
- **Capability Attestation**: An on-chain record binding a wallet address to a single capability. Issued only after the gating preconditions are met (credential presentation for lawyer/client; operator role is constitutional). Revocable. The arbiter capability path exists in `AttestationManager` but is not exercised by v3.
- **Matter**: A free-form legal question posted by a verified client, scoped to a target jurisdiction and practice area. Carries no amount — pricing is the lawyer's response, not part of the matter. Has zero or more associated engagement requests.
- **MilestoneOffer**: A wallet-signed record consisting of `{engagementId, amount, optional note, nonce, signer}`. Lawyer-signed when proposing; client-signed when countering. For the first milestone, exchanged through engagement-request messages before any on-chain action. For follow-up milestones, exchanged through in-engagement messaging. The accepted offer is carried in the calldata of `fundMilestone`, where the contract verifies the signature against the engagement's lawyer (or client, for an accepted counter). The full offer chain is part of the engagement transcript.
- **DeliveryAttestation**: A lawyer-signed off-chain record `{engagementId, milestoneIndex, deliveredAt, optional message}` posted into the engagement transcript when the lawyer completes the work. Surfaced in the chat and milestones panel as the user-visible "delivered" indicator. Distinct from the on-chain `markDelivered` action, which is a separate, optional, lawyer-only transaction that starts the dispute cooldown clock.
- **MutualRefundAuthorization**: A pair of wallet signatures (client + lawyer) over `{engagementId, milestoneIndex, nonce}` authorizing the contract to refund a funded milestone to the client. Either party may originate the request; the contract executes `mutualRefundMilestone` only when both signatures are present and valid.
- **Engagement**: An accepted bilateral agreement between a verified client and a verified lawyer to work on a specific matter through one or more milestones. Carries an off-chain transcript that accumulates continuously and an on-chain root anchored only at closure or dispute escalation. Has a lifecycle of active → closed; closure is permitted only when no milestone is in a non-terminal state (funded, delivered, or disputed).
- **Milestone**: A unit of paid work within an engagement. Has an amount denominated in the chain's native asset (ETH for the MVP), a state (`funded` → optional `delivered` (lawyer-initiated, on chain only when escalation is anticipated) → terminal: `released` | `refunded` | `disputed → resolved`), an optional on-chain delivery timestamp (when `markDelivered` was invoked), and a recorded resolution split (when operator-resolved as arbiter). Off-chain signed `MilestoneOffer`, `DeliveryAttestation`, and `MutualRefundAuthorization` artifacts are tied to the milestone and live in the engagement transcript.
- **Message**: A piece of communication between the engagement parties. Encrypted at rest with keys the platform does not possess. Signed by the sender. Accumulates into a per-engagement transcript whose root is committed on chain at engagement closure or dispute escalation.
- **Conflict-of-Interest Commitment**: A lawyer-published cryptographic commitment to their current client set, used as the verifying reference for a non-membership proof at engagement time.
- **Disclosed Attribute Set**: The subset of credential attributes a user explicitly chose to reveal at onboarding (a lawyer's practising attributes; a client's name, nationality, age-over-18, country). The only attributes the platform persists about the user.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time client with a credential-equipped wallet can go from landing on the platform to a funded first milestone with a chosen lawyer in under five minutes (excluding any wall-clock wait for the lawyer to respond to the engagement request with a first-milestone proposal), performing no more than one wallet credential presentation and one wallet signature for the funding transaction.
- **SC-002**: A first-time lawyer with a credential-equipped wallet can complete onboarding (connect → present credential → see their on-chain attestation → appear in the directory) in under three minutes.
- **SC-003**: When the platform is asked (by any party other than the engagement counterparty) for the contents of any message, no readable content can be produced — the response is provably ciphertext with no key path to plaintext from the platform's data.
- **SC-004**: A lawyer cannot escalate a delivered milestone before the cooldown has elapsed; one hundred percent of pre-cooldown escalation attempts are refused with a message stating when escalation will become available.
- **SC-005**: An arbiter resolution moves the disputed-milestone funds in a single on-chain action whose total transferred amount equals the parked amount to the wei.
- **SC-006**: For any engagement, the lawyer's persisted view of the client contains only the disclosed attribute set; an audit of all platform records that reference that engagement reveals no additional client attributes.
- **SC-007**: A conflict-of-interest check that succeeds adds less than five seconds to the engagement-creation flow; a check that fails blocks the engagement with a generic "conflict detected" message and reveals nothing about the lawyer's client set or the client's identifier in any artifact.
- **SC-008**: An attestation revocation by the operator removes the affected wallet from the directory and prevents new engagements within a single page refresh on any client device.
- **SC-009**: The platform's operational records — read in full — contain no key material capable of decrypting any message, unsealing any client identity beyond their disclosed attributes, or forging any capability attestation.
- **SC-010**: All five core paths (lawyer onboarding, client onboarding, fund→deliver→release, client-immediate dispute resolution, lawyer-cooldown-then-escalate resolution) can each be demonstrated end-to-end against a single running instance of the platform without changes to configuration.

## Assumptions

- The hackathon scope is a single coherent application running in one process and against a single local chain instance; production deployment topology, multi-region operations, and high-availability are out of scope.
- Stand-in credential issuers (for the bar credential and the EU resident credential) are acceptable for the demonstration; the underlying protocols are real-world standards, and the production trajectory is to swap stand-ins for accredited issuers without changing the protocol surface.
- The wallet used by clients and lawyers is a hosted EU-resident-credential-compatible web wallet known to interoperate with the standards the platform speaks.
- A time-skip mechanism is acceptable on the local chain to demonstrate the cooldown without waiting real-world calendar time during a demo.
- A small set of personas (a handful of lawyers, one to two clients, one operator) is registered with the issuer-side stand-in for the demonstration; each must complete the real onboarding flow before they appear on the platform. The operator address itself serves as the arbiter for v3 — no separate arbiter persona is onboarded.
- Identity unsealing for fraud or regulatory escalation is intentionally not implemented; if asked, the platform answers "production trajectory" rather than "we do not need it."
- A trusted-issuers-registry lookup is intentionally not exercised at runtime; the equivalent capability is satisfied for the demo by the operator's review step before issuing an attestation, with the production trajectory being a real registry lookup gating the same step.
- The conflict-of-interest commitment for each lawyer is small enough to be enumerable without breaking the privacy claim; production-scale set sizes are out of scope.
- Threshold cryptography for distributed identity escrow, multi-signature arbiter committees, stealth addresses for per-engagement client unlinkability, qualified electronic signatures, and a full encrypted-messaging transport substrate are all intentionally out of scope and stay slide-only until a future iteration.
- The platform operator is a single Ethereum address controlled by the project; the bar issuer, resident-credential issuer, and platform are distinct entities running as separate Next.js processes with their own databases and signing keys, fronted by a single path-routed reverse proxy so they share one public hostname.
- Milestone funds are paid in native ETH on the local demo chain; ERC-20 stablecoin support is intentionally out of scope for the MVP, with the contract surface shaped so a stablecoin variant can be added later without API changes for clients/lawyers/arbiters.
