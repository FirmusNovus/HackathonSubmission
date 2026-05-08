# Phase 1 Data Model — Lex Nova MVP

State lives in two places: on chain (canonical for capability + escrow + transcript anchors), and SQLite (off-chain for matters, ciphertext blobs, transcript leaves, signed proposals/counters, and persona registry). The privilege boundary is *also* a data-shape boundary — the platform never persists key material that could decrypt a message or unseal a client identity.

## On-chain entities

### EAS attestations (read-only from app perspective)

Three EAS schemas registered at deploy time by `AttestationManager.sol`:

| Schema | Body | Recipient | Issuer | Revocable |
|---|---|---|---|---|
| `verified_lawyer` | `string jurisdiction, string barAdmissionNumber, uint64 admittedAt, uint64 validUntil` | the lawyer's wallet | platform operator | yes |
| `verified_client` | `string countryOfResidence, bool ageOver18` | the client's wallet | platform operator | yes |
| `verified_arbiter` | `string note` (free-form, used for "promoted by operator on date X") | the arbiter's wallet | platform operator | yes |

Capability check helper exposed by `AttestationManager`:

```text
function hasCapability(address subject, bytes32 schemaId) external view returns (bool);
```

`bytes32 schemaId` is the EAS-assigned UID of the schema. Cached in app code as `SCHEMA_LAWYER`, `SCHEMA_CLIENT`, `SCHEMA_ARBITER`.

### `LegalEngagementEscrow.sol` storage

```text
struct Engagement {
  address client;
  address lawyer;
  bytes32 matterRef;        // keccak256 of the matter description + jurisdiction + practiceArea
  EngagementState state;    // Active | Closed
  bytes32 transcriptRoot;   // current per-engagement Merkle root
  uint256 milestoneCount;   // monotonic
}
mapping(uint256 => Engagement) engagements;          // engagementId -> Engagement
mapping(uint256 => mapping(uint256 => Milestone)) milestones;  // engagementId -> milestoneIndex -> Milestone

struct Milestone {
  uint256 amount;           // wei
  MilestoneState state;     // Proposed | Funded | Delivered | Released | Disputed | Claimed | Resolved | Refunded
  uint64 deliveredAt;       // 0 unless Delivered/Disputed/Claimed/Resolved
  address arbiter;          // 0x0 unless claimed by an arbiter
  uint256 amountToLawyer;   // resolution split, 0 unless Resolved
  uint256 amountToClient;   // resolution split, 0 unless Resolved
}
```

State machines:

```text
Engagement: Active -> Closed
  transition Closed only when all milestones are in {Released, Resolved, Refunded}

Milestone:
  Proposed -> Funded                      (client funds, attaches ZK conflict proof)
  Funded -> Delivered                     (lawyer marks delivered)
  Delivered -> Released                   (client releases)
  Funded | Delivered -> Disputed          (client disputes; immediate)
  Delivered -> Disputed                   (lawyer escalates; requires deliveredAt + 30 days <= block.timestamp)
  Disputed -> Claimed                     (any verified-arbiter claims)
  Claimed -> Resolved                     (claiming arbiter resolves with split)
  Funded -> Refunded                      (either party invokes refund on a funded-undelivered milestone)
```

Events:

```text
event EngagementOpened(uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef)
event MilestoneProposed(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 amount)
event MilestoneFunded(uint256 indexed engagementId, uint256 indexed milestoneIndex)
event MilestoneDelivered(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint64 deliveredAt)
event MilestoneReleased(uint256 indexed engagementId, uint256 indexed milestoneIndex)
event MilestoneDisputed(uint256 indexed engagementId, uint256 indexed milestoneIndex, address by)
event MilestoneClaimedByArbiter(uint256 indexed engagementId, uint256 indexed milestoneIndex, address indexed arbiter)
event MilestoneResolved(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 toLawyer, uint256 toClient)
event MilestoneRefunded(uint256 indexed engagementId, uint256 indexed milestoneIndex)
event TranscriptAnchored(uint256 indexed engagementId, bytes32 root, uint64 atBlock)
event EngagementClosed(uint256 indexed engagementId)
```

### Conflict-of-interest commitment

```text
mapping(address => bytes32) public lawyerConflictRoot;   // lawyer -> Pedersen-hashed root
function setConflictRoot(bytes32 newRoot) external;      // onlyVerifiedLawyer; lawyer publishes their own
```

The Noir verifier contract `IZKConflictVerifier.verifyProof(bytes proof, bytes32 root, bytes32 nullifier)` is called by `LegalEngagementEscrow.fundFirstMilestone(...)` to gate the first funding action.

## Off-chain entities (SQLite)

State is partitioned across **three** SQLite databases to enforce the
constitution's process-isolation invariant. Each runs in its own Next.js
process and is reachable only by that process — neither the platform nor the
two issuers can read each other's state directly:

| DB file | Owner process | Contents |
|---|---|---|
| `apps/platform/data/lexnova.db` | platform (port 3010) | `verified_users`, `matters`, `engagement_proposals`, `engagement_off_chain`, `messages`, `conflict_commitments`, `verifier_states` |
| `apps/bar-issuer/data/db.sqlite` | bar-issuer (port 3001) | `subjects` (lawyer roster), OID4VCI flow state |
| `apps/pid-issuer/data/db.sqlite` | pid-issuer (port 3002) | `subjects` (citizen roster, EUDI ARF claim shape), OID4VCI flow state |

Cross-DB lookups (e.g., the verifier validating an SD-JWT VC's signature) are
done over HTTP via the issuer's standard `.well-known/jwks.json` endpoint, not
by reading the issuer's DB or key file directly.

All schemas use `INTEGER` primary keys and explicit `CHECK` constraints where
state enums are involved.

### Bar-issuer DB — `subjects`

The bar association's roster of admitted lawyers. Defines the data the issuer
will write into a credential when a registered wallet asks for one. Lives only
in the bar-issuer process.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `display_name` | TEXT | "Anna Schmidt", … |
| `eth_address` | TEXT NOT NULL UNIQUE | anvil-derived |
| `given_name` | TEXT | |
| `family_name` | TEXT | |
| `jurisdiction` | TEXT | ISO country code, e.g. "DE", "ES", "IT", "CZ" |
| `bar_admission_date` | TEXT | ISO date "YYYY-MM-DD", e.g. "2018-09-15" |
| `bar_admission_number` | TEXT | formal bar registry, e.g. "RAK-Muenchen-2018-04321", "ICAM-2014-08327", "ČAK ev. č. 14302". Bar associations don't certify practice area — that is intentionally absent and lives as a self-declared profile field on the platform, not in the credential. |

### PID-issuer DB — `subjects`

The PID provider's roster of natural persons. Mirrors the EUDI ARF
(`urn:eudi:pid:1`) claim shape — full ARF set including the nested address,
place_of_birth, and age_equal_or_over objects. Lives only in the pid-issuer
process. Derived fields (`age_in_years`, `age_birth_year`,
`age_equal_or_over.{14,16,18,21,65}`, `date_of_issuance`, `date_of_expiry`) are
computed at issuance time, not stored.

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `display_name` | TEXT | |
| `eth_address` | TEXT NOT NULL UNIQUE | |
| `given_name`, `family_name` | TEXT | |
| `birth_given_name`, `birth_family_name` | TEXT | |
| `birthdate` | TEXT | ISO date "YYYY-MM-DD" |
| `sex` | INTEGER | ISO 5218 |
| `email`, `phone_number` | TEXT | |
| `nationalities` | TEXT | JSON array of country codes |
| `place_of_birth` | TEXT | JSON `{locality, region, country}` |
| `address` | TEXT | JSON `{street_address, house_number, postal_code, locality, region, country, formatted}` |
| `personal_administrative_number`, `document_number` | TEXT | |
| `issuing_authority`, `issuing_country`, `issuing_jurisdiction` | TEXT | |

The platform-side filter narrows what is *actually persisted* after a
presentation to only `address.country` and `age_equal_or_over.18` (see
`verified_users.disclosed_attrs` below) — the issuer carries the full PID so
the wallet's credential card and any non-platform verifier sees a realistic
EUDI PID, but lex-nova never sees more than those two fields.

### Both issuer DBs — OID4VCI flow state

`issuer_pre_auth_codes`, `issuer_access_tokens`, `credential_offers` —
short-lived rows tracking the OID4VCI dance. Schema applied automatically by
`@lex-nova/oid4vci`'s `ISSUER_TABLES_SQL`.

### Platform DB — `verified_users` (what the platform has actually attested)

| Column | Type | Notes |
|---|---|---|
| `eth_address` | TEXT PK | the SIWE-bound address |
| `attested_role` | TEXT CHECK(attested_role IN ('lawyer','client','arbiter')) | one row per (address, role) — composite PK actually |
| `attested_at` | INTEGER | unix seconds |
| `attestation_uid` | TEXT | EAS UID for traceability |
| `disclosed_attrs` | TEXT | JSON of the disclosed attribute subset only. **For clients**: `{ country_of_residence, age_equal_or_over_18 }` — same two fields already on chain via `verified_client`. No name, no nationalities; the platform stores no human-readable identifier of the client. **For lawyers**: `{ given_name, family_name, jurisdiction, bar_admission_date, bar_admission_number, valid_until }`. Lawyer cleartext name is intentional — lawyers are public-facing professionals and clients vet them by name + bar registry; their name lives in a public bar association registry already. Client names are kept off the platform; they flow only through E2EE in-engagement messaging. |

Composite primary key `(eth_address, attested_role)` enforces that the same address may hold multiple roles independently.

### `matters`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `client_address` | TEXT FK verified_users.eth_address | |
| `description` | TEXT | free-form |
| `target_jurisdiction` | TEXT | |
| `target_practice_area` | TEXT | |
| `created_at` | INTEGER | |
| `status` | TEXT CHECK(status IN ('open','engaged','withdrawn')) | |

A matter MUST NOT have a price column. Pricing is the lawyer's response, not part of the matter (per spec FR-008).

### `engagement_proposals` (the negotiation chain BEFORE the first milestone is funded)

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `matter_id` | INTEGER FK matters.id | |
| `lawyer_address` | TEXT | |
| `proposer_address` | TEXT | the side that signed this particular proposal/counter |
| `amount_wei` | TEXT | string-encoded for SQLite safety |
| `note` | TEXT | optional short scoping note |
| `signature` | TEXT | hex-encoded ECDSA signature over (matter_id, amount_wei, note, prev_proposal_id) |
| `prev_proposal_id` | INTEGER NULL | linked-list back-pointer for the chain of proposals/counters |
| `created_at` | INTEGER | |
| `superseded_by` | INTEGER NULL | id of the next proposal in the chain (NULL = head) |

Once a proposal is funded by the client (becoming milestone 0), the chain is frozen and copied into the engagement transcript as the first set of leaves.

### `engagement_off_chain` (off-chain mirror of on-chain state, for fast queries)

| Column | Type | Notes |
|---|---|---|
| `engagement_id` | INTEGER PK | matches on-chain ID |
| `matter_id` | INTEGER FK matters.id | |
| `client_address` | TEXT | |
| `lawyer_address` | TEXT | |
| `current_transcript_root` | TEXT | hex |
| `last_anchor_block` | INTEGER | block at which the root was last anchored on chain |
| `state` | TEXT CHECK(state IN ('active','closed')) | |

### `messages`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK | |
| `engagement_id` | INTEGER FK engagement_off_chain.engagement_id | |
| `sender_address` | TEXT | |
| `ciphertext` | BLOB | AES-GCM ciphertext + IV |
| `signature` | TEXT | sender's ECDSA signature over the ciphertext envelope |
| `created_at` | INTEGER | |
| `transcript_leaf_index` | INTEGER | index in the per-engagement Merkle tree |
| `transcript_leaf_hash` | TEXT | SHA-256 of (ciphertext || signature || sender || index) |

The platform never persists a plaintext column. There is no decryption key column anywhere in this schema.

### `conflict_commitments` (lawyer-published)

| Column | Type | Notes |
|---|---|---|
| `lawyer_address` | TEXT PK | |
| `root` | TEXT | hex Pedersen-hashed root, mirrors on-chain `lawyerConflictRoot` |
| `set_size` | INTEGER | for MVP, fixed = 8 |
| `published_at` | INTEGER | |

The lawyer's actual current-client set is held client-side in their wallet (or a small encrypted blob keyed by their wallet); only the commitment lands in this table.

## Mapping spec entities → storage

| Spec entity | On-chain | Off-chain |
|---|---|---|
| User Wallet | (implicit: `address`) | `verified_users` row per (address, role) |
| Capability Attestation | EAS attestations + `AttestationManager.hasCapability` | `verified_users.attestation_uid` |
| Matter | — | `matters` |
| Engagement | `Engagement` struct | `engagement_off_chain` mirror |
| Milestone | `Milestone` struct | derived from chain; not duplicated in SQLite except via event-indexer cache |
| Message | transcript root only | `messages` |
| First-Milestone Proposal | — | `engagement_proposals` |
| Conflict-of-Interest Commitment | `lawyerConflictRoot` | `conflict_commitments` mirror |
| Disclosed Attribute Set | — | `verified_users.disclosed_attrs` (JSON, schema-validated) |

## Validation rules (reflecting spec FRs)

- `verified_users.disclosed_attrs` MUST contain *exactly* these keys for clients: `country_of_residence`, `age_equal_or_over_18`. Anything else — name, family name, nationalities — MUST NOT be persisted (FR-003 tightened, FR-029, SC-006, SC-009). For lawyers, the keys are `given_name`, `family_name`, `jurisdiction`, `bar_admission_date`, `bar_admission_number`, `valid_until` — lawyer name is intentionally kept cleartext.
- `matters` MUST NOT have an `amount` column or any equivalent (FR-008 clarification).
- `messages.ciphertext` MUST NOT be readable server-side; the API layer rejects any request that tries to obtain a plaintext form (FR-023).
- `engagement_proposals.signature` MUST verify against `proposer_address` before the row is written (FR-011 / FR-011a/b for handshake integrity).
- A milestone in `Disputed` state without a `Claimed` transition MUST refuse `resolveDispute` calls (FR-019/019a).
- A milestone in `Funded` state with `block.timestamp - milestone.deliveredAt < 30 days` MUST refuse `escalateMilestone` calls (FR-017, contract-enforced not app-enforced — invariant 6).
