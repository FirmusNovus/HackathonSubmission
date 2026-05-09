-- Phase 5 / 2026-05-08 — operator-as-arbiter dispute disclosure.
--
-- When a party files a dispute, their browser bundles the entire engagement
-- chat (decrypted plaintexts + signed envelopes + Merkle inclusion proofs +
-- off-chain proposal/offer/attestation rows), encrypts the bundle to the
-- operator's published P-256 public key via fresh-ephemeral ECDH, and POSTs
-- the ciphertext here. The platform never sees plaintext — it stores
-- ciphertext only and serves it back to the operator's SIWE session, who
-- decrypts in their browser.
--
-- Constitution Inv 1 (no platform-held decryption keys) is preserved: the
-- operator's private key never leaves their browser (IndexedDB, mirroring
-- the per-engagement messaging-key pattern). The disputer's ephemeral
-- pubkey is stored alongside the ciphertext so the operator can derive
-- the same shared secret on their end.

CREATE TABLE IF NOT EXISTS operator_messaging_key (
    operator_address    TEXT PRIMARY KEY,
    public_key_jwk      TEXT NOT NULL,
    created_at          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS dispute_bundles (
    id                       INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id            INTEGER NOT NULL REFERENCES engagement_off_chain(engagement_id) ON DELETE CASCADE,
    milestone_index          INTEGER NOT NULL,
    sender_address           TEXT NOT NULL,
    -- AES-GCM ciphertext of the JSON-serialized dispute bundle.
    ciphertext               BLOB NOT NULL,
    iv                       BLOB NOT NULL,
    salt                     BLOB NOT NULL,
    -- The disputer's ephemeral P-256 public key (JWK-serialized). The
    -- operator runs ECDH(operator_priv, ephemeral_pub) to derive the
    -- same key the disputer used.
    ephemeral_public_key_jwk TEXT NOT NULL,
    -- personal_sign over a canonical message tying the ciphertext hash
    -- to (engagement_id, milestone_index). Verified server-side against
    -- the SIWE-bound caller, who must be a party to the engagement.
    signature                TEXT NOT NULL,
    created_at               INTEGER NOT NULL,
    UNIQUE(engagement_id, milestone_index, sender_address)
);
CREATE INDEX IF NOT EXISTS idx_dispute_bundles_milestone
    ON dispute_bundles(engagement_id, milestone_index);
