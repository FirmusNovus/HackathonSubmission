# Next.js API Route Surface

Routes live across two Next.js apps that share a single public origin
via the `apps/proxy` reverse proxy on port 3000:

- `/api/issuer/*` and `/issuer/*` → `apps/issuer` (port 3001)
- everything else → `apps/platform` (port 3010)

All routes are App Router route handlers. JSON request/response unless
noted; `application/x-www-form-urlencoded` accepted on the OID4VCI
token endpoint per RFC. Every issuer/verifier metadata response sets
`Cache-Control: no-store` (validated wwWallet quirk).

## Issuer (OID4VCI) — PID

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/issuer/pid/.well-known/openid-credential-issuer` | Issuer metadata. `credential_configurations_supported` advertises `urn:eudi:pid:1` with SD-JWT VC format. |
| GET | `/api/issuer/pid/.well-known/jwks.json` | JWKS containing the issuer's PID public key (P-256). |
| POST | `/api/issuer/pid/credential-offer` | Generates a pre-auth code + tx_code for the SIWE-bound persona; returns the HTTPS handoff URL `https://demo.wwwallet.org/cb?credential_offer_uri=...`. |
| POST | `/api/issuer/pid/token` | OID4VCI token endpoint. Pre-auth grant. Issues access token + DPoP nonce. |
| POST | `/api/issuer/pid/credential` | Issues SD-JWT VC. Accepts `proofs.jwt[]` array for batch issuance. Reads holder binding from each proof. |

## Issuer (OID4VCI) — bar

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/issuer/bar/.well-known/openid-credential-issuer` | Advertises `urn:firmus-novus:LegalProfessionalAccreditation`. |
| GET | `/api/issuer/bar/.well-known/jwks.json` | Bar issuer's public key (P-256, distinct from PID's). |
| POST | `/api/issuer/bar/credential-offer` | Gates on `subjects WHERE eth_address=<wallet> AND credential_type='bar'`; 403 if not on the bar roster. |
| POST | `/api/issuer/bar/token` | |
| POST | `/api/issuer/bar/credential` | |

## Issuer auth

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/issuer/auth/siwe/nonce` | Returns a fresh issuer-side nonce. |
| POST | `/api/issuer/auth/siwe/verify` | Verifies the SIWE message; sets the issuer's session cookie (separate from the platform's). |

## Issuer UI route handlers (server actions)

| Method | Path | Purpose |
|---|---|---|
| GET | `/issuer/` | Credential picker UI. Shows tiles for the credential types the SIWE-bound wallet is eligible to mint. |
| POST | `/issuer/mint` | Server action that initiates the OID4VCI flow for the chosen credential type and renders the HTTPS handoff button. |

## Platform — verifier (OID4VP)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/verifier/x509-cert.pem` | Self-signed RSA cert generated at boot via `openssl` child process; CN = the public ngrok hostname. Required for `x509_san_dns:<hostname>` Draft-23 client_id. |
| POST | `/api/verifier/request` | Creates a presentation request (`kind` ∈ `{pid, bar}`). Stores the signed JWS request object at `request_uri`; returns the HTTPS handoff URL `https://demo.wwwallet.org/cb?client_id=...&request_uri=...`. |
| GET | `/api/verifier/request/:state/object` | Returns the signed JWS request_object (HTTP GET as wwWallet expects). Headers: `Cache-Control: no-store`. |
| POST | `/api/verifier/response/:state` | Receives the wallet's `vp_token`. Parses both string and array shapes (wwWallet quirk). Verifies SD-JWT VC signature against the issuer's JWKS, holder binding against SIWE-bound address, validity end-date. On success, writes the appropriate EAS attestation via `AttestationManager`. |
| GET | `/api/verifier/result/:state` | Polled by the browser. Returns 200 + verified attribute subset, 202 (pending), or 4xx with reason. |

DCQL queries:

- **PID**: `vct = "urn:eudi:pid:1"`, claims = `[age_equal_or_over.18, address.country]`. **Nothing else** — no name, no nationalities, no birth date, no document number. Spec FR-002 + Constitution II.
- **Bar**: `vct = "urn:firmus-novus:LegalProfessionalAccreditation"`, claims = `[given_name, family_name, jurisdiction, bar_admission_date, bar_admission_number, valid_until]`. Spec FR-003.

## Platform — auth

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/auth/siwe/nonce` | Returns a fresh nonce. |
| POST | `/api/auth/siwe/verify` | Verifies the SIWE message + signature. On success, sets a session cookie binding the SIWE address. |
| POST | `/api/auth/siwe/logout` | Clears the session cookie. |

## Platform — chain health

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/chain-health` | Lightweight `eth_blockNumber` probe. Result cached for 5 seconds. Returns `{healthy: boolean, lastBlock?: number, lastChecked: number}`. The platform UI uses this to disable funds-touching actions when `healthy === false` (FR-060). |

## Platform — directory + lawyer profile

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/lawyers` | Public directory. Filters: `specialty`, `language`, `pricingKind`. Joins `verified_users` (where `attested_role='lawyer'` AND `revoked_at IS NULL` AND not expired) with `lawyer_profiles`. | none |
| GET | `/api/lawyers/[id]` | One lawyer's public profile. 404 if attestation revoked / expired / no row. | none |
| PATCH | `/api/lawyer/profile` | Update self-declared profile fields. zod-validated; rejects unknown fields (defense-in-depth against credential-derived edits). | LAWYER session, owner |
| POST | `/api/lawyer/avatar` | Multipart form upload. zod-validates `content-type` ∈ `{image/jpeg, image/png, image/webp}`, size ≤ 5 MB. Transcodes via `sharp` to two WebP variants (480 px / 192 px square, center-cropped). Stores under `apps/platform/data/uploads/avatars/<userId>/<contentHash>-{profile,card}.webp`. Updates `lawyer_profiles.avatar_url`. | LAWYER session, owner |
| DELETE | `/api/lawyer/avatar` | Clears `avatar_url`, deletes both stored variants. Idempotent. | LAWYER session, owner |
| GET | `/uploads/avatars/<userId>/<filename>` | Public-readable. `Content-Type: image/webp`. `Cache-Control: public, max-age=86400`. | none |

## Platform — consultations (client-initiated)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/consultations` | Client submits a consultation request. Body: `{lawyerProfileId, scheduledAt, durationMinutes, practiceArea, caseDescription}`. zod-validated. Snapshots `consultation_kind` from the lawyer's profile. For PAID, returns calldata for `openPaidEngagementAndFundConsultation`; for FREE, opens the engagement off-chain only and writes via `openFreeEngagement` after the client's wallet signs (zero ETH). | verified_client |
| GET | `/api/consultations/mine` | Lists the caller's consultations (as client or lawyer). | session-bound |
| GET | `/api/consultations/[id]` | Reads one consultation, including the paired engagement and conversation. | engagement party |
| POST | `/api/consultations/[id]/accept` | Lawyer accepts. Updates `status` from REQUESTED → ACCEPTED. Pure off-chain transition. | lawyer-owner |
| POST | `/api/consultations/[id]/decline` | Lawyer declines. Updates `status` to DECLINED. For PAID, initiates the mutual-refund authorization flow (lawyer signs immediately). | lawyer-owner |
| POST | `/api/consultations/[id]/cancel` | Client cancels an unaccepted request. Updates `status` to CANCELLED. For PAID, initiates the mutual-refund authorization flow (client signs immediately). | client-owner |
| POST | `/api/consultations/[id]/complete` | Client marks the consultation complete. For PAID, returns calldata for `releaseProposal(engagementId, 0)`. For FREE, just transitions status off-chain. | client-owner |

A scheduled job (or per-request lazy check) auto-transitions
`REQUESTED` consultations to `EXPIRED` when `expires_at < now()` and
the lawyer hasn't acted (FR-015a). For PAID expired requests, the
mutual-refund flow is initiated automatically; the lawyer must
counter-sign before the parked escrow returns.

## Platform — proposals (lawyer-initiated)

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/proposals` | Lawyer issues a new proposal in an active engagement. Body: `{engagementId, lineItems, deliverables, lawyerSignature, nonce}`. Server verifies the signature against the engagement's lawyer address. Server inserts a system message into the engagement's chat for the client to see. | lawyer-engagement-party |
| GET | `/api/proposals/[engagementId]/[proposalIndex]` | Reads one proposal's full state (mirror of on-chain plus line items / deliverables). | engagement party |
| POST | `/api/proposals/[engagementId]/[proposalIndex]/fund` | Returns calldata for `fundProposal(engagementId, amount, lineItemsHash, deliverablesHash, nonce, lawyerSignature)`. The client's wallet broadcasts. | client-engagement-party |
| POST | `/api/proposals/[engagementId]/[proposalIndex]/mark-delivered` | Returns calldata for `markDelivered(engagementId, proposalIndex)`. The lawyer's wallet broadcasts. | lawyer-engagement-party |
| POST | `/api/proposals/[engagementId]/[proposalIndex]/release` | Returns calldata for `releaseProposal(engagementId, proposalIndex)`. The client's wallet broadcasts. | client-engagement-party |
| POST | `/api/proposals/[engagementId]/[proposalIndex]/mutual-refund/initiate` | Records one party's signature on a `MutualRefundAuthorization`. | engagement party |
| POST | `/api/proposals/[engagementId]/[proposalIndex]/mutual-refund/broadcast` | Returns calldata for `mutualRefundProposal(...)` once both signatures are present. | engagement party |

## Platform — disputes

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/api/disputes/[engagementId]/[proposalIndex]/file` | Returns calldata for `disputeProposal(engagementId, proposalIndex)`. The client's wallet broadcasts (or the lawyer's after cooldown via `escalate`). | client-engagement-party |
| POST | `/api/disputes/[engagementId]/[proposalIndex]/escalate` | Returns calldata for `escalateProposal(engagementId, proposalIndex)`. | lawyer-engagement-party |
| GET | `/api/operator/disputes` | Lists all `Disputed` proposals across all engagements. | operator session |
| POST | `/api/operator/disputes/[engagementId]/[proposalIndex]/resolve` | Returns calldata for `resolveDispute(engagementId, proposalIndex, amountToLawyer, amountToClient)`. The form rejects sums that don't equal the parked amount before broadcast; contract enforces too. | operator session |

The `/operator/*` route prefix is gated by middleware that compares
`session.user.address` to the deployed contract's `operator()` getter.
Mismatch returns 404, not 403, to avoid leaking the path's existence.

## Platform — engagement

| Method | Path | Purpose | Auth |
|---|---|---|---|
| GET | `/api/engagements/[id]` | Reads engagement state including all proposals (mirror of on-chain). | engagement party |
| POST | `/api/engagements/[id]/messages` | Posts an encrypted message envelope. Body: `{ciphertext_b64, iv_b64, salt_b64, signature, sender}`. zod schema rejects `plaintext` fields. Server verifies signature against `sender`'s address. Appends to transcript, returns leaf index + new root. | engagement party |
| GET | `/api/engagements/[id]/messages` | Lists ciphertext envelopes. Browser decrypts client-side using ECDH-derived keys. | engagement party |
| POST | `/api/engagements/[id]/anchor-transcript` | Returns calldata for an explicit `anchorTranscript` call (rarely needed; usually invoked automatically by funds-touching transitions inside the contract). | engagement party |
| POST | `/api/engagements/[id]/close` | Returns calldata for `closeEngagement(id, finalRoot)`. UI surfaces blocking proposals if any are non-terminal. | engagement party |

For all on-chain transitions (mark delivered, release, dispute,
escalate, mutual refund, resolve, close, fund) the server returns the
calldata and the user's wallet broadcasts. The server NEVER holds a
private key for client / lawyer / arbiter wallets.

## Platform — dev bypass (FR-056)

| Method | Path | Purpose |
|---|---|---|
| GET | `/dev/personas` | Renders the persona picker. 404 unless `DEV_BYPASS_EUDI=1`. |
| POST | `/api/dev/login` | Body: `{persona: <id>}`. Server-side performs all the bypass seeding (insert `verified_users` rows, idempotent EAS attestation writes via operator key, insert fixture `lawyer_profiles` row for lawyer personas, load dev P-256 private key into the dev-only browser store via Set-Cookie or session). Returns the platform session cookie. 404 unless `DEV_BYPASS_EUDI=1`. |
| POST | `/api/dev/reset` | Clears all platform DB rows (verified_users, lawyer_profiles, engagements_off_chain, consultations, proposals_off_chain, messages, etc.) and redeploys the contracts against a fresh Anvil snapshot via `evm_revert`. 404 unless `DEV_BYPASS_EUDI=1`. |
| POST | `/api/dev/skip-time` | Body: `{seconds: number}`. Calls `evm_increaseTime` + `evm_mine` on Anvil. 404 unless `DEV_BYPASS_EUDI=1`. Used by Playwright suites for the lawyer-cooldown beat. |

## Indexer (internal, not user-facing)

A lightweight viem `watchContractEvent` daemon embedded in the Next.js
process listens for `EngagementOpened`, `Proposal*`, `TranscriptAnchored`,
`EngagementClosed`, and `Attested`/`Revoked` events and updates the
SQLite mirrors. Keeps `engagements_off_chain`, `proposals_off_chain`,
`disputes_off_chain`, and `verified_users` consistent with on-chain
state without requiring page refreshes to RPC. When the chain is
unreachable, the indexer simply waits and reconciles when the chain
recovers (FR-061).

The indexer never writes plaintext, never decrypts, never holds key
material that could.
