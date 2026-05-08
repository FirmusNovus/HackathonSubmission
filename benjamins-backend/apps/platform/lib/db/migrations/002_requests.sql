-- Engagement requests (Phase 4 / Group C / T055).
--
-- A client posts a matter, then sends an engagement_request to a specific
-- verified lawyer referencing that matter. The request carries no amount —
-- pricing is the lawyer's response (recorded later in `engagement_proposals`).
--
-- Lifecycle (off-chain, prior to any on-chain tx):
--   pending     — created by client; awaiting lawyer's response
--   declined    — lawyer declined
--   accepted    — engagement opened on chain (terminal off-chain state;
--                 from this point engagement_off_chain holds the truth)
--   withdrawn   — client revoked before lawyer responded

CREATE TABLE IF NOT EXISTS engagement_requests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    matter_id       INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    client_address  TEXT NOT NULL,
    lawyer_address  TEXT NOT NULL,
    status          TEXT NOT NULL CHECK(status IN ('pending', 'declined', 'accepted', 'withdrawn')),
    created_at      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_requests_matter ON engagement_requests(matter_id);
CREATE INDEX IF NOT EXISTS idx_requests_lawyer ON engagement_requests(lawyer_address);
CREATE INDEX IF NOT EXISTS idx_requests_client ON engagement_requests(client_address);

-- Disallow more than one *active* request for the same (matter, lawyer) pair.
-- Declined/withdrawn requests are kept for auditability; only pending and
-- accepted count against the uniqueness constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_active_unique
    ON engagement_requests(matter_id, lower(lawyer_address))
    WHERE status IN ('pending', 'accepted');
