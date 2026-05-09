-- Phase 4 / Group F / T066-T070.
--
-- Local mirror of milestones for the engagement page UI. The contract is
-- still the source of truth; this table is populated by the indexer from
-- MilestoneProposed/Funded/Delivered/Released/Refunded events.
--
-- Dispute states (Disputed, Claimed, Resolved) land in this table too once
-- Phase 5 (US3) wires the dispute UI; for now Group F only writes the
-- happy-path states.

CREATE TABLE IF NOT EXISTS milestones (
    engagement_id   INTEGER NOT NULL REFERENCES engagement_off_chain(engagement_id) ON DELETE CASCADE,
    milestone_index INTEGER NOT NULL,
    amount_wei      TEXT NOT NULL,
    state           TEXT NOT NULL CHECK(state IN (
                        'proposed', 'funded', 'delivered',
                        'released', 'refunded',
                        'disputed', 'claimed', 'resolved'
                    )),
    delivered_at    INTEGER,
    updated_at      INTEGER NOT NULL,
    PRIMARY KEY (engagement_id, milestone_index)
);

CREATE INDEX IF NOT EXISTS idx_milestones_state ON milestones(state);
