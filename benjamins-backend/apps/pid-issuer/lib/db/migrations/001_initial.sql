-- EU PID provider issuer DB.
-- Holds the registry of natural persons known to the stand-in PID provider
-- plus OID4VCI flow state. Constitutionally separate from lex-nova: this DB
-- only exists in the pid-issuer process.

PRAGMA foreign_keys = ON;

-- A pid-side subject. id is local to this DB; eth_address is the foreign key
-- the wallet presents. Mirrors EUDI ARF (urn:eudi:pid:1) shape; matches the
-- spike's PID claim set.
CREATE TABLE IF NOT EXISTS subjects (
    id                              INTEGER PRIMARY KEY,
    display_name                    TEXT NOT NULL,
    eth_address                     TEXT NOT NULL UNIQUE,
    given_name                      TEXT NOT NULL,
    family_name                     TEXT NOT NULL,
    birth_given_name                TEXT NOT NULL,
    birth_family_name               TEXT NOT NULL,
    birthdate                       TEXT NOT NULL,    -- ISO date "YYYY-MM-DD"
    sex                             INTEGER NOT NULL, -- ISO 5218
    email                           TEXT NOT NULL,
    phone_number                    TEXT NOT NULL,
    nationalities                   TEXT NOT NULL,    -- JSON array of ISO country codes
    place_of_birth                  TEXT NOT NULL,    -- JSON object: {locality, region, country}
    address                         TEXT NOT NULL,    -- JSON object: full EUDI address
    personal_administrative_number  TEXT NOT NULL,
    document_number                 TEXT NOT NULL,
    issuing_authority               TEXT NOT NULL,
    issuing_country                 TEXT NOT NULL,
    issuing_jurisdiction            TEXT NOT NULL
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
