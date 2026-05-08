// Owner spec: 001-verified-legal-engagement.

import type Database from 'better-sqlite3';
import { ISSUER_TABLES_SQL } from '@firmus-novus/oid4vci';

// Subjects table: one row per (eth_address, credential_type). Columns are
// the union of PID + bar fields; nullable for the columns the other type
// doesn't use.
const SUBJECTS_SQL = `
CREATE TABLE IF NOT EXISTS subjects (
    id                              INTEGER PRIMARY KEY AUTOINCREMENT,
    eth_address                     TEXT NOT NULL,
    credential_type                 TEXT NOT NULL CHECK(credential_type IN ('pid','bar')),
    display_name                    TEXT NOT NULL,
    given_name                      TEXT NOT NULL,
    family_name                     TEXT NOT NULL,
    -- PID-only fields
    birth_given_name                TEXT,
    birth_family_name               TEXT,
    birthdate                       TEXT,
    sex                             INTEGER,
    nationalities                   TEXT,
    place_of_birth                  TEXT,
    address_json                    TEXT,
    email                           TEXT,
    phone_number                    TEXT,
    personal_administrative_number  TEXT,
    document_number                 TEXT,
    issuing_authority               TEXT,
    issuing_country                 TEXT,
    issuing_jurisdiction            TEXT,
    -- bar-only fields
    jurisdiction                    TEXT,
    bar_admission_date              TEXT,
    bar_admission_number            TEXT,
    valid_until                     TEXT,
    UNIQUE (eth_address, credential_type)
);
`;

export function runSchema(db: Database.Database) {
  const tx = db.transaction(() => {
    db.exec(SUBJECTS_SQL);
    db.exec(ISSUER_TABLES_SQL);
  });
  tx();
}
