// Owner spec: 001-verified-legal-engagement.

import type Database from 'better-sqlite3';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS subjects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eth_address TEXT NOT NULL,
    credential_type TEXT NOT NULL CHECK(credential_type IN ('pid','bar')),
    display_name TEXT NOT NULL,
    given_name TEXT NOT NULL,
    family_name TEXT NOT NULL,
    birthdate TEXT,
    nationalities TEXT,
    address_json TEXT,
    place_of_birth TEXT,
    sex INTEGER,
    email TEXT,
    phone_number TEXT,
    personal_administrative_number TEXT,
    document_number TEXT,
    issuing_authority TEXT,
    issuing_country TEXT,
    issuing_jurisdiction TEXT,
    jurisdiction TEXT,
    bar_admission_date TEXT,
    bar_admission_number TEXT,
    valid_until TEXT,
    has_minted INTEGER NOT NULL DEFAULT 0,
    UNIQUE (eth_address, credential_type)
  )`,
  `CREATE TABLE IF NOT EXISTS issuer_pre_auth_codes (
    code TEXT PRIMARY KEY,
    eth_address TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS issuer_access_tokens (
    token TEXT PRIMARY KEY,
    c_nonce TEXT NOT NULL,
    eth_address TEXT NOT NULL,
    credential_type TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS credential_offers (
    id TEXT PRIMARY KEY,
    credential_type TEXT NOT NULL,
    pre_auth_code TEXT NOT NULL,
    eth_address TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS issuer_nonces (
    nonce TEXT PRIMARY KEY,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
];

export function runSchema(db: Database.Database) {
  const tx = db.transaction(() => {
    for (const s of STATEMENTS) db.exec(s);
  });
  tx();
}
