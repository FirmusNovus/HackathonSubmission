-- Lex Nova MVP — initial off-chain schema (platform DB only).
-- Constitutionally important: this schema MUST NOT contain plaintext message
-- columns or any decryption key columns. The platform stores only what it can
-- read in the clear (matter descriptions, disclosed-attribute subsets, signed
-- proposals/counters) plus opaque ciphertext blobs.
--
-- Note on what is NOT here: persona registries and bar/PID credential
-- attributes live in the issuer-side DBs (apps/bar-issuer, apps/pid-issuer),
-- which the platform never reads. The platform's only knowledge of a user is
-- via on-chain attestations + the disclosed-attribute subset captured in
-- `verified_users` after they onboard.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS verified_users (
    eth_address     TEXT NOT NULL,
    attested_role   TEXT NOT NULL CHECK(attested_role IN ('lawyer', 'client', 'arbiter')),
    attested_at     INTEGER NOT NULL,
    attestation_uid TEXT NOT NULL,
    disclosed_attrs TEXT NOT NULL,
    PRIMARY KEY (eth_address, attested_role)
);

CREATE TABLE IF NOT EXISTS matters (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    client_address          TEXT NOT NULL,
    description             TEXT NOT NULL,
    target_jurisdiction     TEXT NOT NULL,
    target_practice_area    TEXT NOT NULL,
    created_at              INTEGER NOT NULL,
    status                  TEXT NOT NULL CHECK(status IN ('open', 'engaged', 'withdrawn'))
);
CREATE INDEX IF NOT EXISTS idx_matters_client ON matters(client_address);
CREATE INDEX IF NOT EXISTS idx_matters_status ON matters(status);

CREATE TABLE IF NOT EXISTS engagement_proposals (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    matter_id           INTEGER NOT NULL REFERENCES matters(id) ON DELETE CASCADE,
    lawyer_address      TEXT NOT NULL,
    proposer_address    TEXT NOT NULL,
    amount_wei          TEXT NOT NULL,
    note                TEXT,
    signature           TEXT NOT NULL,
    prev_proposal_id    INTEGER REFERENCES engagement_proposals(id),
    superseded_by       INTEGER REFERENCES engagement_proposals(id),
    created_at          INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_proposals_matter ON engagement_proposals(matter_id);

CREATE TABLE IF NOT EXISTS engagement_off_chain (
    engagement_id           INTEGER PRIMARY KEY,
    matter_id               INTEGER NOT NULL REFERENCES matters(id),
    client_address          TEXT NOT NULL,
    lawyer_address          TEXT NOT NULL,
    current_transcript_root TEXT NOT NULL,
    last_anchor_block       INTEGER NOT NULL DEFAULT 0,
    state                   TEXT NOT NULL CHECK(state IN ('active', 'closed'))
);

CREATE TABLE IF NOT EXISTS messages (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id           INTEGER NOT NULL REFERENCES engagement_off_chain(engagement_id),
    sender_address          TEXT NOT NULL,
    ciphertext              BLOB NOT NULL,
    iv                      BLOB NOT NULL,
    salt                    BLOB NOT NULL,
    signature               TEXT NOT NULL,
    created_at              INTEGER NOT NULL,
    transcript_leaf_index   INTEGER NOT NULL,
    transcript_leaf_hash    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_engagement ON messages(engagement_id, transcript_leaf_index);

CREATE TABLE IF NOT EXISTS conflict_commitments (
    lawyer_address  TEXT PRIMARY KEY,
    root            TEXT NOT NULL,
    set_size        INTEGER NOT NULL,
    published_at    INTEGER NOT NULL
);

-- Verifier presentation-state tracking. Used by app/api/verifier/* to coordinate
-- the OID4VP request -> wallet -> response -> result polling cycle. Stored
-- server-side only because the wallet doesn't carry our state across redirects.
CREATE TABLE IF NOT EXISTS verifier_states (
    state           TEXT PRIMARY KEY,
    kind            TEXT NOT NULL CHECK(kind IN ('bar', 'pid')),
    nonce           TEXT NOT NULL,
    request_jws     TEXT NOT NULL,
    status          TEXT NOT NULL CHECK(status IN ('pending', 'verified', 'rejected')),
    verified_attrs  TEXT,
    holder_jwk      TEXT,
    rejected_reason TEXT,
    created_at      INTEGER NOT NULL,
    completed_at    INTEGER
);
