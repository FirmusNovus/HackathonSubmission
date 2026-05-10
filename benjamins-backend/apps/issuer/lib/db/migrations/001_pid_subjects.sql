-- Combined-issuer schema. PID side: holds the natural-person registry the
-- stand-in PID provider knows about, plus the OID4VCI flow tables shared
-- across both credential types (the `kind` column distinguishes pid vs bar).
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS pid_subjects (
    id                              INTEGER PRIMARY KEY,
    display_name                    TEXT NOT NULL,
    eth_address                     TEXT NOT NULL UNIQUE,
    given_name                      TEXT NOT NULL,
    family_name                     TEXT NOT NULL,
    birth_given_name                TEXT NOT NULL,
    birth_family_name               TEXT NOT NULL,
    birthdate                       TEXT NOT NULL,
    sex                             INTEGER NOT NULL,
    email                           TEXT NOT NULL,
    phone_number                    TEXT NOT NULL,
    nationalities                   TEXT NOT NULL,
    place_of_birth                  TEXT NOT NULL,
    address                         TEXT NOT NULL,
    personal_administrative_number  TEXT NOT NULL,
    document_number                 TEXT NOT NULL,
    issuing_authority               TEXT NOT NULL,
    issuing_country                 TEXT NOT NULL,
    issuing_jurisdiction            TEXT NOT NULL
);

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
