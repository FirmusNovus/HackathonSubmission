# Implementation decisions

These are the implementation-level choices made while writing the MVP that
go beyond what plan.md and research.md prescribe. They are recorded here
so a future contributor (or reviewer) can replay the trade-off.

## D-IMPL-001 — Canonical glossary: "proposal" not "milestone"

**Choice**: the structured payment artifact is named `proposal` everywhere
in code, schema, contract function names, and user copy. The contract
exposes `Proposal` structs, `ProposalState`, `fundProposal`, `markDelivered`
on a proposal index, `releaseProposal`, `disputeProposal`,
`escalateProposal`, `resolveDispute` against the proposal index, and
`mutualRefundProposal`. The off-chain SQLite mirror is `proposals_off_chain`.

**Why**: plan.md §Constraints names this as load-bearing
(`scripts/check-brand-mentions.sh` enforces zero references to the
retired alternative), and the spec's data-model.md and contracts/
documents use the proposal terminology consistently. The CI gate at
`scripts/check-brand-mentions.sh` fails the build on any
re-introduction.

## D-IMPL-002 — Single `LegalEngagementEscrow.sol` covers both consultation and follow-up proposals

**Choice**: one contract handles the dual consultation (FREE vs PAID)
opening path AND the follow-up signed proposals. The PAID consultation
opens an engagement with proposal index 0 already funded; the FREE
consultation opens an engagement with `proposalCount = 0` and the first
proposal arrives later via `fundProposal`. The contract distinguishes
via `Engagement.consultationPaid`.

**Why**: data-model.md §`LegalEngagementEscrow.sol storage` specifies the
`consultationPaid` boolean and the dual entry points
`openFreeEngagement` and `openPaidEngagementAndFundConsultation`. A
single contract keeps state-machine reasoning local and matches the
contract surface listed in `contracts/solidity-surface.md`.

## D-IMPL-003 — Dev-bypass broadcasts on the persona's behalf

**Choice**: when `DEV_BYPASS_EUDI=1`, `apps/platform/lib/dev/persona-broadcast.ts`
derives the persona's anvil-private-key from `ANVIL_MNEMONIC` and
broadcasts on-chain transactions as that persona. The browser does not
hold a real wallet in dev-bypass; the platform stands in.

**Why**: spec FR-D06 requires that persona-pick produces an end-to-end
result equivalent to a fully-onboarded user. The chain side of "fully
onboarded" requires real on-chain transactions (escrow funding, release,
dispute, resolve); without a real wallet, the platform must broadcast
directly. This is documented as dev-only and the helper refuses to run
when `DEV_BYPASS_EUDI` is unset. Constitution Inv 1 is preserved
because the dev-broadcast helper does NOT touch any decryption code
path; messaging keys remain browser-only at
`apps/platform/lib/crypto/client/`.

## D-IMPL-004 — Indexer is on-demand, not a daemon

**Choice**: `apps/platform/lib/chain/indexer.ts` exposes a single
`syncFromChain()` function that pulls events since `lastSyncedBlock` on
each call. API routes that mutate state on chain call it after their
broadcast settles.

**Why**: a persistent watcher daemon would survive across the Next.js
hot-reload boundary awkwardly, and the demo's transaction rate is low
enough that an on-demand pass after each broadcast keeps SQLite
mirrors fresh. Spec quickstart.md describes a 10-minute bring-up; a
daemon adds a moving piece for nothing.

## D-IMPL-005 — Browser-only crypto re-export at `lib/crypto/client/`

**Choice**: `apps/platform/lib/crypto/client/index.ts` re-exports
everything from `@firmus-novus/crypto` plus the per-engagement keypair
helpers in `lib/crypto/client/messaging-keys.ts`. The
`scripts/check-no-server-decryption.sh` gate forbids any server module
under `apps/platform/lib/` (excluding `crypto/client/` and `dev/`)
from importing AES-GCM or ECDH-derive helpers.

**Why**: Constitution Inv 1 — the platform server has no decryption
capability. Centralizing the browser-only surface at one path makes
the gate's allow-list trivial.

## D-IMPL-006 — Indexer does NOT auto-flip consultation status on `ProposalFunded`

**Choice**: the indexer records the funding tx hash on the
consultations row but does NOT transition `REQUESTED → ACCEPTED`.
Acceptance remains a lawyer action surfaced through
`POST /api/consultations/[id]/accept`.

**Why**: PAID consultations are funded as proposal index 0 at booking
time (atomic with `openPaidEngagementAndFundConsultation`); the lawyer
has not yet decided to take the matter. Treating the on-chain funding
event as an automatic acceptance would skip the lawyer's review step.

## D-IMPL-007 — Operator-as-arbiter for the v3 demo

**Choice**: `LegalEngagementEscrow.resolveDispute` gates on
`msg.sender == operator`. There is no separate verified-arbiter
capability schema in the MVP.

**Why**: Constitution v1.1.0 §III collapses the arbiter role into the
operator address for the v3 demo scope. Production trajectory
reintroduces a separated arbiter pool with per-dispute assignment;
the parties' dispute / escalate APIs do not change between v3 and
production, so the swap is contract-only.
