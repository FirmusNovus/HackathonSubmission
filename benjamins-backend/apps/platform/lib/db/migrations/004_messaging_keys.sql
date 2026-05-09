-- Phase 4 / Group E1 / T062-T064.
--
-- Two changes:
--
-- 1. Per-engagement messaging keys. Each party generates a P-256 keypair
--    client-side at engagement open (separate from the secp256k1 wallet key)
--    and publishes the public half here so the counterparty can derive an
--    ECDH shared secret. The platform never sees a private key — Constitution
--    invariant 1.
--
-- 2. Add request_id to engagement_off_chain so we can reach the proposal
--    chain (engagement_proposals.request_id) without an awkward triple-key
--    join. Populated by the indexer when EngagementOpened fires.

ALTER TABLE engagement_off_chain ADD COLUMN request_id INTEGER REFERENCES engagement_requests(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_off_chain_request ON engagement_off_chain(request_id);

CREATE TABLE IF NOT EXISTS engagement_messaging_keys (
    engagement_id    INTEGER NOT NULL REFERENCES engagement_off_chain(engagement_id) ON DELETE CASCADE,
    party_address    TEXT NOT NULL,    -- always lowercased on insert
    public_key_jwk   TEXT NOT NULL,    -- JSON-stringified P-256 JWK (no 'd')
    created_at       INTEGER NOT NULL,
    PRIMARY KEY (engagement_id, party_address)
);
