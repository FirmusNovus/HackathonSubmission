# Next.js API Route Surface

Routes live across three Next.js apps that share a single public origin via the `apps/proxy` reverse proxy on port 3000:

- `/api/issuer/bar/*` → `apps/bar-issuer` (port 3001)
- `/api/issuer/pid/*` → `apps/pid-issuer` (port 3002)
- everything else → `apps/platform` (port 3010)

All routes are App Router route handlers. Conventions: JSON request/response unless noted; `application/x-www-form-urlencoded` accepted on OID4VCI token endpoint per RFC. Every issuer/verifier metadata response sets `Cache-Control: no-store` (validated wwWallet quirk).

## Issuer (OID4VCI) — bar credential

Stand-in for an EU bar association. Runs as its own Next.js process; signing key persisted at `apps/bar-issuer/data/signing-key.jwk` and only readable by that process.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/issuer/bar/.well-known/openid-credential-issuer` | Issuer metadata. `credential_configurations_supported` advertises `urn:lex-nova:LegalProfessionalAccreditation` with SD-JWT VC format. `batch_credential_issuance.batch_size = 5`. |
| GET | `/api/issuer/bar/.well-known/jwks.json` | JWKS containing the bar issuer's public key (P-256). |
| POST | `/api/issuer/bar/credential-offer` | Generates a pre-auth code + tx_code for a chosen persona; returns the `openid-credential-offer://` deep link. |
| POST | `/api/issuer/bar/token` | OID4VCI token endpoint. Pre-auth grant. Issues access token + DPoP nonce. |
| POST | `/api/issuer/bar/credential` | Issues SD-JWT VC. Accepts `proofs.jwt[]` array for batch issuance. Reads holder binding from each proof. |

## Issuer (OID4VCI) — PID

Stand-in for an EUDI PID provider. Separate Next.js process; signing key at `apps/pid-issuer/data/signing-key.jwk`, only readable by that process.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/issuer/pid/.well-known/openid-credential-issuer` | Advertises `urn:eudi:pid:1`. |
| GET | `/api/issuer/pid/.well-known/jwks.json` | |
| POST | `/api/issuer/pid/credential-offer` | |
| POST | `/api/issuer/pid/token` | |
| POST | `/api/issuer/pid/credential` | |

## Verifier (OID4VP) — bar presentation + PID presentation

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/verifier/x509-cert.pem` | Self-signed RSA cert generated at boot via `openssl` child process; CN = the public hostname. Required for `x509_san_dns:<hostname>` Draft-23 client_id. |
| POST | `/api/verifier/request` | Creates a presentation request (kind ∈ {`bar`, `pid`}). Returns the `openid4vp://` deep link with a signed `request_object` containing the DCQL query. |
| GET | `/api/verifier/request/:state/object` | Returns the signed JWS request_object (HTTP GET as wwWallet expects). Headers: `Cache-Control: no-store`. |
| POST | `/api/verifier/response/:state` | Receives the wallet's `vp_token`. Parses both the string and array shapes. Verifies SD-JWT VC signature against the issuer's JWKS, then writes the appropriate EAS attestation via `AttestationManager`. |
| GET | `/api/verifier/result/:state` | Polled by the browser to learn whether the presentation succeeded. Returns 200 + verified attribute subset, 202 (pending), or 4xx with reason. |

DCQL queries (full bodies in [credential-shapes.md](credential-shapes.md)):

- Bar: `vct = "urn:lex-nova:LegalProfessionalAccreditation"`, claims = `[given_name, family_name, jurisdiction, bar_admission_date, bar_admission_number, valid_until]`. `jurisdiction` is an ISO country code (e.g. `"DE"`); the chamber/locality lives inside `bar_admission_number` (e.g. `"RAK-Muenchen-2018-04321"`). Practice area is intentionally absent — bar associations don't certify what areas a lawyer specialises in.
- PID: `vct = "urn:eudi:pid:1"`, claims = `[age_equal_or_over.18, address.country]`. **Nothing else** — no name, no nationalities, no birth date, no document number. FR-003 (tightened) at the protocol layer: the verifier asks only for the two atoms the platform persists, the wallet's consent dialog shows only those two fields, anything else stays in the wallet. The lawyer learns the client's name, if at all, through E2EE in-engagement messaging.

## Auth (SIWE)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/siwe/nonce` | Returns a fresh nonce. |
| POST | `/api/auth/siwe/verify` | Verifies the SIWE message + signature. On success, sets a session cookie binding the SIWE address. |
| POST | `/api/auth/siwe/logout` | Clears the session cookie. |

## Matters

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/matters` | Creates a matter. Body: `{description, target_jurisdiction, target_practice_area}`. **No amount accepted.** | verified_client |
| GET | `/api/matters/mine` | Lists the caller's matters. | verified_client |
| GET | `/api/matters/:id` | Reads one matter. | session-bound |
| DELETE | `/api/matters/:id` | Withdraws an unengaged matter. | only matter owner |

## Engagement handshake (pre-funding negotiation)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/engagements/request` | Client sends an engagement request. Body: `{matter_id, lawyer_address}`. **No amount.** Creates a record visible to the lawyer; no on-chain side effect. | verified_client |
| GET | `/api/engagements/inbox` | Lawyer reads pending requests directed at them. | verified_lawyer |
| POST | `/api/engagements/:requestId/decline` | Lawyer declines. | requested lawyer |
| POST | `/api/engagements/:requestId/propose` | Lawyer proposes a first-milestone amount + optional note. Body: `{amount_wei, note?, signature}`. The signature is verified server-side against the lawyer's address. | requested lawyer |
| POST | `/api/engagements/:requestId/counter` | Client counters. Body: `{amount_wei, note?, signature}`. Server verifies signature against the client's address. | request-owning client |
| POST | `/api/engagements/:requestId/fund` | Client funds the latest lawyer-proposed amount. This is the call that opens the engagement on-chain via `openEngagementAndFundFirstMilestone`. The route returns the calldata for the wallet to sign + broadcast (so the user's wallet provides the signature, not the server). Server stages the ZK conflict proof so the calldata bundles it. | request-owning client |

Once `fund` succeeds and the on-chain `EngagementOpened` event is observed, the proposal chain is frozen and copied as the initial leaves of the engagement transcript.

## Active engagement (post-funding)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/engagements/mine` | Lists the caller's engagements (as client or lawyer). | verified_client OR verified_lawyer |
| GET | `/api/engagements/:id` | Reads engagement state (mirror of on-chain) including milestone list. | engagement party |
| POST | `/api/engagements/:id/messages` | Posts an encrypted message envelope. Body: `{ciphertext_b64, signature, sender_pubkey_hint}`. Server appends to transcript, returns leaf index + new root. **The server MUST NOT accept a plaintext field.** | engagement party |
| GET | `/api/engagements/:id/messages` | Lists ciphertext envelopes. The browser decrypts using ECDH-derived keys. | engagement party |
| POST | `/api/engagements/:id/anchor-transcript` | Returns calldata for a manual `anchorTranscript` call (rarely needed; usually called automatically by milestone state transitions). | engagement party |
| POST | `/api/engagements/:id/milestones` | Propose a follow-up milestone. Both client and lawyer can call. | engagement party |

For all on-chain transitions (mark delivered, release, dispute, refund, close) the server returns the calldata and the user's wallet broadcasts. The server never holds a private key for client/lawyer/arbiter wallets.

## Arbiter

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/arbiter/disputes/queue` | Lists unclaimed Disputed milestones across all engagements. | verified_arbiter |
| POST | `/api/arbiter/disputes/:engagementId/:milestoneIndex/claim` | Returns calldata for `claimDispute(...)`. | verified_arbiter |
| GET | `/api/arbiter/disputes/mine` | Lists disputes claimed by this wallet. | verified_arbiter |
| POST | `/api/arbiter/disputes/:engagementId/:milestoneIndex/resolve` | Returns calldata for `resolveDispute(amountToLawyer, amountToClient)`. | claiming arbiter |

The arbiter sees a redacted view: engagement parties' addresses, the matter description, the milestone amount, the disclosed-attribute subset of each party (matching what the lawyer already saw of the client), and any plaintext message history that either party chose to manually share *out of band* (the platform itself provides no decryption). The server-side route NEVER returns decryption keys.

## Operator (capability admin)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/operator/capabilities` | Lists all attested wallets with their capabilities. | operator session |
| POST | `/api/operator/capabilities/revoke` | Body: `{subject, schemaId}`. Returns calldata for the operator to broadcast. | operator session |
| POST | `/api/operator/capabilities/grant-arbiter` | Body: `{subject}`. Subject MUST already hold `verified_lawyer` (server-side pre-check + contract-side check via `onlyLawyerHolder` modifier). | operator session |

The operator UI MUST NOT offer endpoints to grant `verified_lawyer` or `verified_client` directly (FR-007). The route layer reflects this — those routes simply do not exist.

## Conflict-of-interest commitment

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/conflict/commitment` | Body: `{root, set_size}`. The lawyer publishes a Pedersen-hashed root over their current client set. Returns calldata for `setConflictRoot`. | verified_lawyer |
| POST | `/api/conflict/proof` | Browser-side helper that returns the witness format for the Noir circuit; the actual proof is generated client-side via `bb.js`. | verified_client |

## Indexer (internal, not user-facing)

A lightweight viem `watchContractEvent` daemon embedded in the Next.js process listens for `EngagementOpened`, `Milestone*`, `TranscriptAnchored`, `EngagementClosed`, and `Attested`/`Revoked` and updates the SQLite mirrors. This keeps the off-chain `engagement_off_chain` and `verified_users` tables consistent with on-chain state without requiring page refreshes to RPC.
