// Owner spec: 001-verified-legal-engagement.
// Platform DB schema migration runner. Tables match data-model.md.

import type Database from 'better-sqlite3';

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS verified_users (
    eth_address TEXT NOT NULL,
    attested_role TEXT NOT NULL CHECK(attested_role IN ('client','lawyer')),
    attested_at INTEGER NOT NULL,
    attestation_uid TEXT NOT NULL,
    disclosed_attrs TEXT NOT NULL,
    message_pubkey TEXT,
    revoked_at INTEGER,
    PRIMARY KEY (eth_address, attested_role)
  )`,
  `CREATE TABLE IF NOT EXISTS lawyer_profiles (
    user_id TEXT PRIMARY KEY,
    slug TEXT NOT NULL UNIQUE,
    city TEXT NOT NULL,
    headline TEXT NOT NULL,
    bio TEXT NOT NULL,
    specialties TEXT NOT NULL,
    languages TEXT NOT NULL,
    jurisdictions TEXT NOT NULL,
    years_experience INTEGER NOT NULL,
    consultation_type TEXT NOT NULL CHECK(consultation_type IN ('FREE','PAID')),
    hourly_rate_wei TEXT NOT NULL DEFAULT '0',
    pricing_kind TEXT NOT NULL DEFAULT 'HOURLY' CHECK(pricing_kind IN ('HOURLY','FIXED','SUBSCRIPTION','SUCCESS')),
    pricing_headline TEXT NOT NULL DEFAULT '',
    consultation_rate_30_wei TEXT NOT NULL DEFAULT '0',
    consultation_rate_60_wei TEXT NOT NULL DEFAULT '0',
    pricing_items TEXT NOT NULL DEFAULT '[]',
    tags TEXT NOT NULL DEFAULT '[]',
    availability TEXT NOT NULL DEFAULT '{}',
    avatar_url TEXT,
    avatar_uploaded_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS engagements_off_chain (
    engagement_id INTEGER PRIMARY KEY,
    client_address TEXT NOT NULL,
    lawyer_address TEXT NOT NULL,
    matter_description TEXT NOT NULL DEFAULT '',
    target_jurisdiction TEXT NOT NULL DEFAULT '',
    target_practice_area TEXT NOT NULL DEFAULT '',
    current_transcript_root TEXT NOT NULL DEFAULT '',
    last_anchor_block INTEGER,
    state TEXT NOT NULL DEFAULT 'Active' CHECK(state IN ('Active','Closed')),
    created_at INTEGER NOT NULL,
    closed_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS consultations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id INTEGER NOT NULL UNIQUE,
    client_id TEXT NOT NULL,
    lawyer_user_id TEXT NOT NULL,
    scheduled_at INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK(duration_minutes IN (30,60)),
    practice_area TEXT NOT NULL,
    case_description TEXT NOT NULL CHECK(length(case_description) >= 20),
    consultation_kind TEXT NOT NULL CHECK(consultation_kind IN ('FREE','PAID')),
    consultation_fee_wei TEXT NOT NULL DEFAULT '0',
    platform_fee_wei TEXT NOT NULL DEFAULT '0',
    status TEXT NOT NULL DEFAULT 'REQUESTED' CHECK(status IN ('REQUESTED','ACCEPTED','IN_PROGRESS','COMPLETED','DECLINED','EXPIRED','CANCELLED','DISPUTED')),
    escrow_funding_tx_hash TEXT,
    escrow_release_tx_hash TEXT,
    expires_at INTEGER NOT NULL,
    cancelled_by_client_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (engagement_id) REFERENCES engagements_off_chain(engagement_id)
  )`,
  `CREATE TABLE IF NOT EXISTS proposals_off_chain (
    engagement_id INTEGER NOT NULL,
    proposal_index INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('CONSULTATION','PROPOSAL')),
    lawyer_address TEXT NOT NULL,
    total_wei TEXT NOT NULL,
    platform_fee_wei TEXT NOT NULL DEFAULT '0',
    line_items TEXT NOT NULL DEFAULT '[]',
    deliverables TEXT NOT NULL DEFAULT '[]',
    items_hash TEXT NOT NULL DEFAULT '',
    nonce TEXT NOT NULL DEFAULT '',
    lawyer_offer_signature TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL CHECK(state IN ('Issued','Funded','Delivered','Released','Disputed','Resolved','Refunded')),
    funded_tx_hash TEXT,
    delivered_tx_hash TEXT,
    delivered_at_block_timestamp INTEGER,
    released_tx_hash TEXT,
    disputed_tx_hash TEXT,
    dispute_filed_by TEXT,
    resolved_tx_hash TEXT,
    amount_to_lawyer_wei TEXT,
    amount_to_client_wei TEXT,
    refunded_tx_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (engagement_id, proposal_index)
  )`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id INTEGER NOT NULL,
    sender_address TEXT NOT NULL,
    ciphertext BLOB NOT NULL,
    iv BLOB NOT NULL,
    salt BLOB NOT NULL,
    signature TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    transcript_leaf_index INTEGER NOT NULL,
    transcript_leaf_hash TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_messages_engagement_created ON messages(engagement_id, created_at)`,
  `CREATE TABLE IF NOT EXISTS mutual_refund_authorizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    engagement_id INTEGER NOT NULL,
    proposal_index INTEGER NOT NULL,
    nonce TEXT NOT NULL,
    client_signature TEXT,
    lawyer_signature TEXT,
    created_at INTEGER NOT NULL,
    broadcast_tx_hash TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS disputes_off_chain (
    engagement_id INTEGER NOT NULL,
    proposal_index INTEGER NOT NULL,
    state TEXT NOT NULL CHECK(state IN ('disputed','resolved')),
    filed_by TEXT NOT NULL CHECK(filed_by IN ('client','lawyer')),
    filed_at INTEGER NOT NULL,
    delivered_at INTEGER,
    resolved_at INTEGER,
    amount_to_lawyer_wei TEXT,
    amount_to_client_wei TEXT,
    dispute_tx_hash TEXT NOT NULL,
    resolve_tx_hash TEXT,
    PRIMARY KEY (engagement_id, proposal_index)
  )`,
  `CREATE TABLE IF NOT EXISTS nonces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nonce TEXT NOT NULL UNIQUE,
    used INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS verifier_states (
    state TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('pid','bar')),
    bound_address TEXT,
    request_jws TEXT NOT NULL,
    nonce TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result_json TEXT,
    error TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  )`,
];

export function runSchema(db: Database.Database): void {
  const tx = db.transaction(() => {
    for (const stmt of STATEMENTS) db.exec(stmt);
  });
  tx();
}
