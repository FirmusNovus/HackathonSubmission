-- Phase 4 / Group D1 / T057.
--
-- Tie engagement_proposals to the originating engagement_request. Without
-- this, a single matter that received requests from / to multiple lawyers
-- couldn't keep its proposal chains separate.
--
-- The column is nullable at the SQL level (SQLite ALTER TABLE limitation)
-- but enforced as required by the propose / counter API routes — every row
-- inserted by this codebase has a non-null request_id.
ALTER TABLE engagement_proposals ADD COLUMN request_id INTEGER REFERENCES engagement_requests(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_proposals_request ON engagement_proposals(request_id);
