-- Bar association issuer DB.
-- Holds the registry of admitted lawyers (so the issuer "knows" what to write
-- into a credential when address X asks for one) plus the OID4VCI flow state.
-- Constitutionally separate from the lex-nova platform's DB: this DB only
-- exists in the bar-issuer process; lex-nova never sees it.

PRAGMA foreign_keys = ON;

-- A bar-association-side subject. id is local to this DB; eth_address is the
-- foreign key the wallet presents. given_name / family_name / jurisdiction etc.
-- are the data this institution attests to.
CREATE TABLE IF NOT EXISTS subjects (
    id                      INTEGER PRIMARY KEY,
    display_name            TEXT NOT NULL,
    eth_address             TEXT NOT NULL UNIQUE,
    given_name              TEXT NOT NULL,
    family_name             TEXT NOT NULL,
    jurisdiction            TEXT NOT NULL,            -- ISO country code
    bar_admission_date      TEXT NOT NULL,            -- ISO date YYYY-MM-DD
    bar_admission_number    TEXT NOT NULL
);

-- OID4VCI flow state (matches @lex-nova/oid4vci's ISSUER_TABLES_SQL).
CREATE TABLE IF NOT EXISTS issuer_pre_auth_codes (
    code            TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    persona_id      INTEGER NOT NULL,
    tx_code         TEXT,
    created_at      INTEGER NOT NULL,
    consumed_at     INTEGER
);

CREATE TABLE IF NOT EXISTS issuer_access_tokens (
    token           TEXT PRIMARY KEY,
    kind            TEXT NOT NULL,
    persona_id      INTEGER NOT NULL,
    dpop_nonce      TEXT NOT NULL,
    c_nonce         TEXT NOT NULL,
    created_at      INTEGER NOT NULL,
    expires_at      INTEGER NOT NULL,
    issued_at       INTEGER
);

CREATE TABLE IF NOT EXISTS credential_offers (
    offer_id        TEXT PRIMARY KEY,
    pre_auth_code   TEXT NOT NULL UNIQUE REFERENCES issuer_pre_auth_codes(code) ON DELETE CASCADE,
    created_at      INTEGER NOT NULL
);
