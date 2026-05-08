# Phase 1 Data Model — Verified Legal Engagement

State lives in two places: on chain (canonical for capability + escrow
+ transcript anchors) and SQLite (off-chain for matters,
ciphertext blobs, transcript leaves, signed proposals/counters, and
persona registry). The privilege boundary is *also* a data-shape
boundary — the platform never persists key material that could decrypt
a message or unseal a client identity.

## On-chain entities

### EAS attestations (read-only from app perspective)

Two EAS schemas registered at deploy time by `AttestationManager.sol`:

| Schema | Body | Recipient | Issuer | Revocable |
|---|---|---|---|---|
| `verified_lawyer` | `string jurisdiction, string barAdmissionNumber, uint64 admittedAt, uint64 validUntil` | the lawyer's wallet | platform operator | yes |
| `verified_client` | `string countryOfResidence, bool ageOver18` | the client's wallet | platform operator | yes |

Capability check helper exposed by `AttestationManager`:

```text
function hasCapability(address subject, bytes32 schemaId) external view returns (bool);
```

`bytes32 schemaId` is the EAS-assigned UID of the schema. Cached in
app code as `SCHEMA_LAWYER`, `SCHEMA_CLIENT`. (The
`verified_arbiter` capability is production trajectory; the MVP collapses
the arbiter role into the operator address per Constitution III.)

### `LegalEngagementEscrow.sol` storage

```text
struct Engagement {
  address client;
  address lawyer;
  bytes32 matterRef;        // keccak256(description || jurisdiction || practiceArea)
  EngagementState state;    // Active | Closed
  bytes32 transcriptRoot;   // current per-engagement Merkle root
  uint256 proposalCount;    // monotonic; consultation is index 0 if paid, otherwise proposals start at index 0
  bool consultationPaid;    // true if the engagement was opened with a paid consultation
}
mapping(uint256 => Engagement) engagements;          // engagementId -> Engagement
mapping(uint256 => mapping(uint256 => Proposal)) proposals;  // engagementId -> proposalIndex -> Proposal

struct Proposal {
  uint256 amount;           // wei
  ProposalState state;      // Issued | Funded | Delivered | Released | Disputed | Resolved | Refunded
  uint64 deliveredAt;       // 0 unless Delivered/Disputed/Resolved
  uint256 amountToLawyer;   // resolution split, 0 unless Resolved
  uint256 amountToClient;   // resolution split, 0 unless Resolved
}
```

State machines:

```text
Engagement: Active -> Closed
  transition to Closed only when all proposals are in {Released, Resolved, Refunded}

Proposal:
  Issued    -> Funded                   (client funds, attaches lawyer's signed proposal artifact)
  Funded    -> Delivered                (lawyer marks delivered, optional in happy path; starts cooldown)
  Funded    -> Released                 (client releases, NOT gated on Delivered)
  Delivered -> Released                 (client releases)
  Funded    | Delivered -> Disputed     (client disputes; immediate, no cooldown)
  Delivered -> Disputed                 (lawyer escalates; requires deliveredAt + 30 days <= block.timestamp)
  Disputed  -> Resolved                 (operator splits; sum must equal proposal.amount)
  Funded    -> Refunded                 (mutual refund: BOTH parties' signatures verified on chain)
```

Note the *Consultation* is treated as proposal index 0 when the
consultation is paid (FR-013). If the consultation is free, no
on-chain proposal is created at the consultation step; the engagement
opens with `proposalCount = 0` and the first proposal arrives later
when the lawyer issues one. The contract distinguishes via the
`consultationPaid` boolean.

Events:

```text
event EngagementOpened(uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef, bool consultationPaid)
event ProposalFunded(uint256 indexed engagementId, uint256 indexed proposalIndex, uint256 amount)
event ProposalDelivered(uint256 indexed engagementId, uint256 indexed proposalIndex, uint64 deliveredAt)
event ProposalReleased(uint256 indexed engagementId, uint256 indexed proposalIndex)
event ProposalDisputed(uint256 indexed engagementId, uint256 indexed proposalIndex, address by)
event ProposalResolved(uint256 indexed engagementId, uint256 indexed proposalIndex, uint256 toLawyer, uint256 toClient)
event ProposalRefunded(uint256 indexed engagementId, uint256 indexed proposalIndex)
event TranscriptAnchored(uint256 indexed engagementId, bytes32 root, uint64 atBlock)
event EngagementClosed(uint256 indexed engagementId)
```

### Conflict-of-interest commitment (production trajectory)

```text
mapping(address => bytes32) public lawyerConflictRoot;    // lawyer -> Pedersen-hashed root
function setConflictRoot(bytes32 newRoot) external;       // onlyVerifiedLawyer
```

The `IZKConflictVerifier.verifyProof(bytes proof, bytes32 root, bytes32 nullifier)`
interface is called by the engagement-open path. the MVP deploys
`StubZKConflictVerifier` which returns `true` unconditionally; the
production verifier is bb-generated from
[circuits/src/main.nr](../../circuits/src/main.nr).

## Off-chain entities (SQLite)

State is partitioned across **two** SQLite databases to enforce the
constitution's process-isolation invariant. Each runs in its own
Next.js process and is reachable only by that process — neither the
platform nor the issuer can read each other's state directly.

| DB file | Owner process | Contents |
|---|---|---|
| `apps/issuer/data/db.sqlite` | issuer (port 3001) | `subjects` (combined PID + bar roster), OID4VCI flow state |
| `apps/platform/data/db.sqlite` | platform (port 3010) | `verified_users`, `lawyer_profiles`, `engagements_off_chain`, `consultations`, `proposals_off_chain`, `messages`, `transcript_leaves`, `mutual_refund_authorizations`, `disputes_off_chain`, `nonces`, `verifier_states` |

Cross-DB lookups (e.g., the verifier validating an SD-JWT VC's
signature) are done over HTTP via the issuer's standard
`.well-known/jwks.json` endpoint, not by reading the issuer's DB or
key file directly.

All schemas use `INTEGER` primary keys and explicit `CHECK`
constraints where state enums are involved.

### Issuer DB — `subjects`

The combined roster of admitted lawyers + EU residents. Defines the
data the issuer will write into a credential when a registered wallet
asks for one. Lives only in the issuer process.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `eth_address` | TEXT NOT NULL | Anvil-derived |
| `credential_type` | TEXT CHECK(credential_type IN ('pid','bar')) | |
| `display_name` | TEXT | "Anna Schmidt", … |
| `given_name` | TEXT | both types |
| `family_name` | TEXT | both types |
| `birthdate` | TEXT | PID only — ISO date "YYYY-MM-DD" |
| `nationalities` | TEXT | PID only — JSON array of country codes |
| `address_json` | TEXT | PID only — JSON `{street_address, …, country, formatted}` |
| `place_of_birth` | TEXT | PID only — JSON |
| `sex` | INTEGER | PID only — ISO 5218 |
| `email`, `phone_number` | TEXT | PID only |
| `personal_administrative_number`, `document_number` | TEXT | PID only |
| `issuing_authority`, `issuing_country`, `issuing_jurisdiction` | TEXT | PID only |
| `jurisdiction` | TEXT | bar only — ISO country code, e.g. "DE", "ES" |
| `bar_admission_date` | TEXT | bar only — ISO date "YYYY-MM-DD" |
| `bar_admission_number` | TEXT | bar only — formal registry, e.g. "RAK-Muenchen-2018-04321" |
| `valid_until` | TEXT | bar only — ISO date |
| `has_minted` | BOOLEAN | true after the wallet successfully completes OID4VCI for this credential type |

Composite uniqueness on `(eth_address, credential_type)`.

### Issuer DB — OID4VCI flow state

`issuer_pre_auth_codes`, `issuer_access_tokens`, `credential_offers` —
short-lived rows tracking the OID4VCI dance, expired and cleaned up
after 10 minutes.

### Platform DB — `verified_users`

| Column | Type | Notes |
|---|---|---|
| `eth_address` | TEXT | the SIWE-bound address |
| `attested_role` | TEXT CHECK(attested_role IN ('client','lawyer')) | one row per (address, role) |
| `attested_at` | INTEGER | unix seconds |
| `attestation_uid` | TEXT | EAS UID for traceability |
| `disclosed_attrs` | TEXT | JSON of the disclosed-attribute subset only |
| `message_pubkey` | TEXT | per-engagement P-256 public-half (base64 SPKI), registered at first engagement open |
| `revoked_at` | INTEGER NULL | unix seconds; non-null = capability revoked |

Composite primary key `(eth_address, attested_role)`.

For clients: `disclosed_attrs = {country_of_residence, age_equal_or_over_18}` — exactly two keys plus the wallet address.

For lawyers: `disclosed_attrs = {given_name, family_name, jurisdiction, bar_admission_date, bar_admission_number, valid_until}`. Lawyer cleartext name is intentional — lawyers are public-facing professionals.

### Platform DB — `lawyer_profiles`

| Column | Type | Notes |
|---|---|---|
| `user_id` | TEXT PK | matches `verified_users.eth_address` for `attested_role='lawyer'` |
| `slug` | TEXT UNIQUE | URL slug derived from name |
| `city` | TEXT | self-declared |
| `headline` | TEXT | self-declared |
| `bio` | TEXT CHECK(length(bio) >= 40) | self-declared |
| `specialties` | TEXT | JSON string array (Family / Estate / Property / Employment / Immigration / Business / Tax / IP) |
| `languages` | TEXT | JSON string array |
| `jurisdictions` | TEXT | JSON string array; superset of credential's `jurisdiction` allowed |
| `years_experience` | INTEGER | self-declared, >= 0 |
| `consultation_type` | TEXT CHECK(consultation_type IN ('FREE','PAID')) | self-declared |
| `hourly_rate_wei` | TEXT | wei-as-string (SQLite has no uint256); used for proposal line items |
| `pricing_kind` | TEXT CHECK(pricing_kind IN ('HOURLY','FIXED','SUBSCRIPTION','SUCCESS')) | |
| `pricing_headline` | TEXT | "From 0.012 ETH per consultation" |
| `consultation_rate_30_wei` | TEXT | used for paid consultations |
| `consultation_rate_60_wei` | TEXT | used for paid consultations |
| `pricing_items` | TEXT | JSON array of `{title, desc, price, unit}`; used for non-HOURLY kinds |
| `tags` | TEXT | JSON string array |
| `availability` | TEXT | JSON; free-form weekday × hours grid for the MVP |
| `avatar_url` | TEXT NULL | stable path WITHOUT variant suffix; e.g. `/uploads/avatars/<userId>/<contentHash>` |
| `avatar_uploaded_at` | INTEGER NULL | unix seconds |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |

Visibility in the public directory is gated on a currently-valid
`verified_lawyer` attestation, NOT on a column flag (FR-043 + FR-046).

### Platform DB — `engagements_off_chain`

| Column | Type | Notes |
|---|---|---|
| `engagement_id` | INTEGER PK | matches on-chain ID |
| `client_address` | TEXT | |
| `lawyer_address` | TEXT | |
| `matter_description` | TEXT | client's case description (cleartext — posted by client, not encrypted) |
| `target_jurisdiction` | TEXT | from lawyer's profile |
| `target_practice_area` | TEXT | from consultation request |
| `current_transcript_root` | TEXT | hex |
| `last_anchor_block` | INTEGER | block at which the root was last anchored on chain |
| `state` | TEXT CHECK(state IN ('Active','Closed')) | |
| `created_at` | INTEGER | |
| `closed_at` | INTEGER NULL | |

### Platform DB — `consultations`

The user-facing booking-shaped view paired one-to-one with an
engagement.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `engagement_id` | INTEGER FK engagements_off_chain.engagement_id UNIQUE | |
| `client_id` | TEXT | wallet address |
| `lawyer_user_id` | TEXT | wallet address |
| `scheduled_at` | INTEGER | unix seconds |
| `duration_minutes` | INTEGER CHECK(duration_minutes IN (30,60)) | |
| `practice_area` | TEXT | one of the 8 canonical specialties |
| `case_description` | TEXT CHECK(length(case_description) >= 20) | |
| `consultation_kind` | TEXT CHECK(consultation_kind IN ('FREE','PAID')) | snapshotted from lawyer's profile at request time |
| `consultation_fee_wei` | TEXT | wei-as-string; 0 for FREE |
| `platform_fee_wei` | TEXT | wei-as-string; 5% of consultation_fee_wei |
| `status` | TEXT CHECK(status IN ('REQUESTED','ACCEPTED','IN_PROGRESS','COMPLETED','DECLINED','EXPIRED','CANCELLED','DISPUTED')) | |
| `escrow_funding_tx_hash` | TEXT NULL | for PAID kind only |
| `escrow_release_tx_hash` | TEXT NULL | set when consultation completes |
| `expires_at` | INTEGER | unix seconds; `created_at + 7 days` for REQUESTED rows (FR-015a) |
| `cancelled_by_client_at` | INTEGER NULL | for CANCELLED state |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |

### Platform DB — `proposals_off_chain`

The off-chain mirror of `LegalEngagementEscrow.proposals[engagementId][proposalIndex]`,
plus the lawyer-signed offer artifact and the line items / deliverables.

| Column | Type | Notes |
|---|---|---|
| `engagement_id` | INTEGER | |
| `proposal_index` | INTEGER | matches on-chain index; index 0 is the paid consultation if any |
| `kind` | TEXT CHECK(kind IN ('CONSULTATION','PROPOSAL')) | distinguishes the auto-created consultation index from lawyer-issued follow-ups |
| `lawyer_address` | TEXT | proposer; same as engagement.lawyer for the MVP |
| `total_wei` | TEXT | sum of line-items' subtotals; equals on-chain `proposal.amount` |
| `platform_fee_wei` | TEXT | 5% of total_wei |
| `line_items` | TEXT | JSON array; each: `{id, title, description?, kind: "hourly"\|"fixed", hours?, ratePerHour?, fixedPrice?, subtotal}`. EMPTY for auto-created consultation index. |
| `deliverables` | TEXT | JSON array; each: `{id, title, description?}`. EMPTY for auto-created consultation index. |
| `lawyer_offer_signature` | TEXT | hex-encoded wallet signature over keccak256(engagementId, proposalIndex, totalWei, lineItems, deliverables, nonce). Verified on chain in `fundProposal`. EMPTY for auto-created consultation index. |
| `state` | TEXT CHECK(state IN ('Issued','Funded','Delivered','Released','Disputed','Resolved','Refunded')) | mirrors on-chain state |
| `funded_tx_hash` | TEXT NULL | |
| `delivered_tx_hash` | TEXT NULL | |
| `delivered_at_block_timestamp` | INTEGER NULL | from ProposalDelivered event; cooldown-clock origin |
| `released_tx_hash` | TEXT NULL | |
| `disputed_tx_hash` | TEXT NULL | |
| `dispute_filed_by` | TEXT NULL | 'client' \| 'lawyer' |
| `resolved_tx_hash` | TEXT NULL | |
| `amount_to_lawyer_wei` | TEXT NULL | only on Resolved |
| `amount_to_client_wei` | TEXT NULL | only on Resolved |
| `refunded_tx_hash` | TEXT NULL | |
| `created_at` | INTEGER | |
| `updated_at` | INTEGER | |

Composite primary key `(engagement_id, proposal_index)`.

### Platform DB — `messages`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `engagement_id` | INTEGER | |
| `sender_address` | TEXT | |
| `ciphertext` | BLOB | AES-GCM ciphertext |
| `iv` | BLOB | 12-byte IV |
| `salt` | BLOB | 16-byte HKDF salt |
| `signature` | TEXT | sender's ECDSA signature over keccak256(ciphertext || iv || salt || sender || engagementId) |
| `created_at` | INTEGER | unix seconds |
| `transcript_leaf_index` | INTEGER | index in the per-engagement Merkle tree |
| `transcript_leaf_hash` | TEXT | SHA-256(ciphertext || signature || sender || index) |

The platform never persists a plaintext column. There is no
decryption key column anywhere in this schema. Indexed on
`(engagement_id, created_at)`.

### Platform DB — `mutual_refund_authorizations`

Stores both parties' wallet signatures over a per-proposal
authorization until one party broadcasts.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `engagement_id` | INTEGER | |
| `proposal_index` | INTEGER | |
| `nonce` | TEXT | random; used in the signed digest |
| `client_signature` | TEXT NULL | hex; verified server-side against client_address before insertion |
| `lawyer_signature` | TEXT NULL | hex; verified server-side against lawyer_address before insertion |
| `created_at` | INTEGER | |
| `broadcast_tx_hash` | TEXT NULL | non-null after the contract executes the refund |

### Platform DB — `disputes_off_chain`

Mirrors on-chain `Disputed` proposals for fast queue rendering on
`/operator/disputes`.

| Column | Type | Notes |
|---|---|---|
| `engagement_id` | INTEGER | |
| `proposal_index` | INTEGER | |
| `state` | TEXT CHECK(state IN ('disputed','resolved')) | |
| `filed_by` | TEXT CHECK(filed_by IN ('client','lawyer')) | |
| `filed_at` | INTEGER | |
| `delivered_at` | INTEGER NULL | mirror of on-chain deliveredAt |
| `resolved_at` | INTEGER NULL | |
| `amount_to_lawyer_wei` | TEXT NULL | |
| `amount_to_client_wei` | TEXT NULL | |
| `dispute_tx_hash` | TEXT | |
| `resolve_tx_hash` | TEXT NULL | |

Composite primary key `(engagement_id, proposal_index)`.

### Platform DB — `nonces`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `nonce` | TEXT UNIQUE | one-time SIWE nonce |
| `used` | BOOLEAN | reuse fails authentication |
| `created_at` | INTEGER | |

### Platform DB — `verifier_states`

Short-lived OID4VP state rows tracking pending presentations. Cleaned
up after 10 minutes.

## Mapping spec entities → storage

| Spec entity | On-chain | Off-chain |
|---|---|---|
| User Wallet | (implicit: `address`) | `verified_users` row per (address, role) |
| Capability Attestation | EAS attestations + `AttestationManager.hasCapability` | `verified_users.attestation_uid` |
| Lawyer Profile | — | `lawyer_profiles` |
| Engagement | `Engagement` struct | `engagements_off_chain` mirror |
| Consultation (FREE) | — (no on-chain object) | `consultations` row |
| Consultation (PAID) | `Proposal` struct at index 0 | `consultations` + `proposals_off_chain` (kind='CONSULTATION') |
| Proposal | `Proposal` struct at higher indices | `proposals_off_chain` (kind='PROPOSAL') |
| Message | transcript root only | `messages` |
| Mutual Refund Authorization | — (signatures consumed in calldata) | `mutual_refund_authorizations` |
| Disclosed Attribute Set | — | `verified_users.disclosed_attrs` (JSON, schema-validated) |

## Validation rules (reflecting spec FRs)

- `verified_users.disclosed_attrs` for clients MUST contain *exactly*
  these keys: `country_of_residence`, `age_equal_or_over_18`. Anything
  else MUST NOT be persisted (FR-002, FR-049, SC-006). For lawyers the
  keys are `given_name`, `family_name`, `jurisdiction`,
  `bar_admission_date`, `bar_admission_number`, `valid_until`.
- `consultations.case_description` MUST be ≥ 20 characters (FR-011).
- `consultations.duration_minutes` MUST be 30 or 60 (FR-011).
- `consultations.consultation_fee_wei` MUST be 0 for `consultation_kind = 'FREE'`.
- `consultations.expires_at = created_at + 7 days` for `status = 'REQUESTED'` (FR-015a).
- `lawyer_profiles.bio` MUST be ≥ 40 characters (FR-045 implicit).
- `lawyer_profiles.consultation_rate_30_wei` and `..._60_wei` MUST be > 0 if `consultation_kind='PAID'`.
- `lawyer_profiles.avatar_url` is nullable; when set it points at a
  stable path WITHOUT variant suffix; consumers append
  `-profile.webp` or `-card.webp` based on context.
- `messages.ciphertext` MUST NOT be readable server-side; the API
  layer rejects any request that includes a plaintext field
  (FR-035..FR-040).
- `proposals_off_chain.lawyer_offer_signature` for `kind='PROPOSAL'`
  MUST verify against `lawyer_address` before insertion (FR-018).
- A proposal in `Disputed` state MUST refuse `resolveDispute` calls
  unless `msg.sender == operator` (FR-027).
- A proposal in `Funded` state MUST refuse `mutualRefundProposal`
  unless BOTH client and lawyer signatures are present and verify
  against the appropriate addresses (FR-031, FR-032).
- A proposal in `Delivered` state with
  `block.timestamp - delivered_at_block_timestamp < 30 days` MUST
  refuse `escalateProposal` calls — contract-enforced, not
  app-enforced (FR-025, Inv 6).
