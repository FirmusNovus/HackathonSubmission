-- Phase 4 / V2 gas-reduction redesign (2026-05-07).
--
-- The V2 escrow surface moves milestone proposal, delivery attestation, and
-- refund consent off chain — only ETH-moving actions and the cooldown anchor
-- (`markDelivered`) remain as on-chain transactions. This migration adds the
-- platform-side persistence for those signed off-chain artifacts.
--
-- Why this matters: the contract trusts the platform's API layer to verify
-- these signatures before accepting an action (e.g. funding a follow-up
-- milestone). The transcript anchor at engagement close commits all of these
-- artifacts to the on-chain root, so a future audit can reconstruct the full
-- lifecycle even though the chain log on its own is intentionally sparse.

-- ============================================================
-- milestone_offers — V2 follow-up milestone offers
-- ============================================================
--
-- The first milestone is still negotiated through engagement_proposals
-- (pre-engagement-open table). Once the engagement is active, either party
-- may propose follow-ups via this table; the client materializes one by
-- calling `fundMilestone(engagementId, amount)` on chain. The indexer's
-- MilestoneFunded handler then sets accepted_milestone_index on whichever
-- offer matched the funded amount + chronological "head" of the chain.
CREATE TABLE IF NOT EXISTS milestone_offers (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id            INTEGER NOT NULL REFERENCES engagement_off_chain(engagement_id) ON DELETE CASCADE,
    proposer_address         TEXT NOT NULL,
    amount_wei               TEXT NOT NULL,
    note                     TEXT,
    nonce                    TEXT NOT NULL,
    signature                TEXT NOT NULL,
    prev_offer_id            INTEGER REFERENCES milestone_offers(id),
    superseded_by            INTEGER REFERENCES milestone_offers(id),
    accepted_milestone_index INTEGER,
    created_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_milestone_offers_engagement
    ON milestone_offers(engagement_id);
-- "Head" offer = most recent for an engagement, not yet superseded or
-- accepted. The UI shows this one to the counterparty as the active offer.
CREATE INDEX IF NOT EXISTS idx_milestone_offers_open
    ON milestone_offers(engagement_id)
    WHERE superseded_by IS NULL AND accepted_milestone_index IS NULL;

-- ============================================================
-- delivery_attestations — V2 lawyer-signed "delivered" markers
-- ============================================================
--
-- Distinct from the on-chain `markDelivered` action. The on-chain version
-- is a separate, optional, lawyer-only transaction that exists solely to
-- start the escalation cooldown (Constitution Inv 6); it is invoked only
-- when the lawyer anticipates needing to escalate against an unresponsive
-- client. The off-chain attestation here is the user-visible "delivered"
-- marker shown in chat — the path the happy-path takes.
CREATE TABLE IF NOT EXISTS delivery_attestations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id   INTEGER NOT NULL REFERENCES engagement_off_chain(engagement_id) ON DELETE CASCADE,
    milestone_index INTEGER NOT NULL,
    delivered_at    INTEGER NOT NULL,
    message         TEXT,
    signature       TEXT NOT NULL,
    created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_delivery_attestations_milestone
    ON delivery_attestations(engagement_id, milestone_index);

-- ============================================================
-- refund_authorizations — V2 mutual refund EIP-712 signatures
-- ============================================================
--
-- Each row is a single party's EIP-712 sig over MutualRefundAuthorization.
-- When both parties have rows for the same (engagement_id, milestone_index),
-- the UI surfaces a "submit refund" button that builds calldata for the
-- contract's `mutualRefundMilestone(engId, msIdx, clientSig, lawyerSig)`.
-- One sig per signer per milestone — UNIQUE prevents duplicate rows; if a
-- party wants to update their sig (rare), they delete-then-re-sign through
-- a different code path.
CREATE TABLE IF NOT EXISTS refund_authorizations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id   INTEGER NOT NULL REFERENCES engagement_off_chain(engagement_id) ON DELETE CASCADE,
    milestone_index INTEGER NOT NULL,
    signer_address  TEXT NOT NULL,
    signature       TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    UNIQUE(engagement_id, milestone_index, signer_address)
);
CREATE INDEX IF NOT EXISTS idx_refund_auths_milestone
    ON refund_authorizations(engagement_id, milestone_index);

-- ============================================================
-- milestones — assigned arbiter mirror (V2 dispute model)
-- ============================================================
--
-- The on-chain V2 contract records the operator-assigned arbiter against
-- each disputed milestone. The indexer mirrors that into this column so
-- the UI can show "Dispute assigned to <arbiter>" without re-reading the
-- chain on every page load. NULL until ArbiterAssigned fires; mutable
-- across reassignments while the milestone is still in disputed state.
ALTER TABLE milestones ADD COLUMN assigned_arbiter TEXT;
