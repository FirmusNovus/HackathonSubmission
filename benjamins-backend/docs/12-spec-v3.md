# Spec v3 — Pan-EU Pseudonymous Legal Advice Platform

This is the consolidated build spec after six rounds of research ([04](04-research-findings.md), [05](05-deeper-research.md), [06](06-simpler-paths.md), [07](07-ecosystem-finds.md), [08](08-zktls-and-iterations.md)), the round-9 design dialog, and the **wallet-integration spike** (see [`spike/wallet-integration/`](../spike/wallet-integration/)) that validated the OID4VCI/OID4VP path end-to-end against the real wwWallet. Round-1 spec at [02-spec.md](02-spec.md) and v2 at [09-spec-v2.md](09-spec-v2.md) preserved for the diff. **Build from this doc.** Demo script lives at [13-demo-v3.md](13-demo-v3.md). Plain-English walkthrough at [14-project-walkthrough-v3.md](14-project-walkthrough-v3.md).

## Product framing — two tiers implemented, one demonstrated

Lex Nova's product surface is **two tiers** with a demonstrable escalation path between them:

- **Tier 2 — Pseudonymous-but-credentialed advice (the implemented core).** Verified lawyer; pseudonymous client (PID claims partially disclosed via OID4VP); E2EE messaging keyed off the wallets; milestone-based escrow with on-chain hash commitments to the message transcript. This is what runs live on stage. *(The original task description listed an additional Tier 1 — anonymous public legal information — we've dropped it: it's a separate product surface and not load-bearing for the cryptographic story.)*
- **Tier 3 — Arbitrated dispute resolution (demonstrated as escalation).** When a milestone is disputed and the parties can't resolve it, the engagement transitions to a `Disputed` status and the funds park. **Dispute rights are asymmetric**: the client can dispute any `Funded` or `Delivered` milestone immediately, but the lawyer can only escalate after a 30-day cooldown post-delivery (preventing weaponization of dispute as a "pay me or I escalate" lever — see §5). The arbiter has **escrow authority only** — they can call `resolveDispute(engagementId, milestoneIndex, amountToLawyer, amountToClient)` to split the parked funds, but cannot decrypt messages or unseal client identity. Either party submits their decrypted messages + Merkle proofs to the arbiter as evidence (off-chain); the arbiter weighs the submissions, with non-cooperation by either party leaning the ruling against them by arbiter discretion (same as civil arbitration where ignoring proceedings = default loss). The **cryptographic privilege boundary stays absolute** — even the arbiter cannot read messages without a party voluntarily disclosing them. **Identity unsealing is explicitly out of scope** for the hackathon; in production, fraud/regulator/AML escalation would add a separate identity-escrow mechanism (threshold-encrypted PID blob, court-order-gated decryption) that is documented in the closing-slide trajectory only.

## Five claims defensible on stage

1. **Lawyers cryptographically verified as real EU bar members** — `@sd-jwt/sd-jwt-vc` issues (off-stage, via a stand-in issuer service that plays the role of a bar association) and verifies (live, on platform) a `LegalProfessionalAccreditation` SD-JWT VC. Format `vc+sd-jwt`, vct `urn:lex-nova:LegalProfessionalAccreditation`. Issuer is a `did:key` persisted to disk so it survives Next.js hot reload (production: bar association as a Qualified Trust Service Provider issuing a (Q)EAA per eIDAS 2). Holder key binding via `cnf.jwk` extracted from the wallet's OID4VCI proof JWT. Selectively-disclosable claims: `given_name`, `family_name`, `jurisdiction`, `bar_admission_date`, `bar_admission_number`, `valid_until` (no `specialty` — bar associations don't certify free-form practice areas, only formal *Fachanwalt*-style designations; lawyers self-declare specialties on their platform profile). Validated end-to-end against the real wwWallet via the round-9 spike.
2. **Clients pseudonymous to the lawyer, with conflict-of-interest checking** — PID issued by our same stand-in issuer in `urn:eudi:pid:1` shape (production: each member-state's eIDAS-notified PID provider, validated via EBSI's Trusted Issuers Registry). Selective disclosure of `given_name`, `family_name`, `nationalities`, `age_equal_or_over.18`, `address.country` — birth date, full address, document number stay hidden. Plus a Noir non-membership ZK proof at engagement-creation time over a hashed prior-client commitment set. *(Stand-in PID instead of eudiw.dev's hosted issuer because the spike confirmed eudiw.dev is incompatible with wwWallet — RFC 9207 `iss` mismatch, `https://issuer.eudiw.dev/oidc` vs `https://issuer.eudiw.dev`.)*
3. **Lawyer-client communication is E2EE; the platform is cryptographically blind to message content.** Messages are encrypted client-side with keys derived from each party's wallet holder key; the platform stores ciphertext only (or with XMTP, no plaintext anywhere on platform infra). Each message is signed by the sender's holder key, hashed into a per-engagement Merkle transcript, with the transcript root committed on chain as part of the EAS engagement attestation at milestone events. Non-repudiation + tamper-evidence + privilege-preserving = the foundation Tier 3 arbitration runs on. This is the trust pivot: not "we promise we don't read your messages," but "we cryptographically cannot."
4. **Engagement is milestone-based with asymmetric dispute rights.** A single engagement can hold many sequentially-scoped milestones (initial consultation → quote for follow-on work → execution → revisions, etc.). Per milestone: lawyer proposes; client accepts-and-funds; lawyer signals delivery (`markDelivered`) which starts a cooldown clock; client releases (happy path) or disputes (immediate, no cooldown — `disputeMilestone`). If the client neither releases nor disputes, the lawyer can `escalateMilestone` after `LAWYER_DISPUTE_COOLDOWN` (30 days production, 30 seconds in the demo deploy). Both routes transition the milestone into `Disputed`; per-milestone disputes route into Tier 3 without nuking the whole engagement.
5. **Money flows through smart-contract escrow with milestone release and arbiter-resolved disputes.** `LegalEngagementEscrow.sol` on local anvil, gated by EAS attestations, per-milestone fund + deliver + release/dispute/escalate, 15% platform take rate at release, signed live with MetaMask. The arbiter has **escrow authority only** — they call `resolveDispute(engagementId, milestoneIndex, amountToLawyer, amountToClient)` to split parked funds; they have no cryptographic access to messages or identities. Either party voluntarily submits decrypted messages + Merkle proofs to the arbiter as evidence; non-cooperation = default loss by arbiter discretion (same as civil arbitration).

If any of these is mocked, the cryptographic story collapses. All five are real working code. Tier 3 arbiter resolution (`resolveDispute`) is also real working code — the arbiter is a single hardcoded address in the demo (production: multi-sig of accredited arbitrators). Identity unsealing is **not** present in v3 in any form, on purpose; that's a separate production mechanism documented in the closing-slide trajectory.

## Architecture, four subsystems

```
┌─ Issuance (off-stage, before stage) ──────────┐
│  Next.js Route Handlers under /api/issuer/*    │
│  serve as TWO stand-in issuers in one binary:  │
│    • Bar association (vct=urn:lex-nova:Legal-  │
│      ProfessionalAccreditation)                │
│    • Member-state PID provider                 │
│      (vct=urn:eudi:pid:1)                      │
│  Operator UI at /operator/issue picks 1 of 6   │
│  personas + 1 of 2 credential types. wwWallet  │
│  consumes via OID4VCI batch issuance (5        │
│  instances per credential for unlinkability).  │
└────────────────────────────────────────────────┘
                       │
                       ▼
┌─ Onboarding (live, eager — at landing) ───────┐
│  Marta lands on /, clicks Connect Wallet.     │
│  SIWE → not registered → /onboard runs the    │
│  PID OID4VP. EAS client attestation written.  │
│  Profile = [verified_client]. → /dashboard.   │
│                                                │
│  Optionally: from /dashboard, Marta could    │
│  click "Become a verified lawyer →" which     │
│  triggers the bar-credential OID4VP. Anna did │
│  exactly this off-stage; same Ethereum addr   │
│  now holds [verified_client, verified_lawyer].│
│                                                │
│  Linear funnel: verify once on first visit,   │
│  use everywhere after. Returning users skip   │
│  onboarding (SIWE recognizes them → dashboard).│
└────────────────────────────────────────────────┘
                       │
                       ▼
┌─ Marketplace (live) ──────────────────────────┐
│  /dashboard → Post a matter → /find-lawyer    │
│  → click Engage Anna → /engagement/new        │
│  Browser generates Noir ZK proof of non-      │
│   membership in Anna's prior-client set.      │
│  LegalEngagementEscrow.createEngagement(...)  │
│  with milestone[0] in Proposed state.         │
└────────────────────────────────────────────────┘
                       │
                       ▼
┌─ E2EE messaging layer (live, per engagement) ─┐
│  After engagement created, Marta and Anna     │
│  have an encrypted thread scoped to its       │
│  engagementId. Keys derived from their wallet │
│  holder keys (PID-side cnf.jwk × cnf.jwk via  │
│  ECDH). Messages encrypted client-side; the   │
│  platform stores ciphertext only. Each msg    │
│  signed; per-engagement Merkle transcript root│
│  committed on chain at every milestone event. │
│  Demo: encrypted-localStorage stub. Prod: XMTP│
└────────────────────────────────────────────────┘
                       │
                       ▼
┌─ Milestone-based engagement (live) ────────────┐
│  Per-milestone state machine:                  │
│    proposeMilestone(lawyer) ───→ Proposed      │
│    acceptAndFundMilestone(client) ─→ Funded    │
│    markDelivered(lawyer) ─→ Delivered          │
│       (starts LAWYER_DISPUTE_COOLDOWN clock)   │
│    releaseMilestone(client) ─→ Released ✓      │
│      85/15 split, transcriptRoot committed.    │
│  Dispute paths (asymmetric — see Tier 3):      │
│    disputeMilestone(client, anytime) ───┐      │
│    escalateMilestone(lawyer, after      │      │
│       cooldown post-delivery) ──────────┤      │
│                                          │      │
└──────────────────────────────────────────┼──────┘
                                           │
                                           ▼
┌─ Tier 3 arbitration (declared, demo'd) ────────┐
│  Either party flagging a milestone parks the   │
│  funds; engagement enters Disputed.            │
│  Asymmetric trigger rights:                    │
│    • Client: can dispute any Funded/Delivered  │
│      milestone immediately. No cooldown.       │
│    • Lawyer: can ONLY escalate after 30-day    │
│      cooldown post-delivery. Anti-harassment   │
│      guardrail.                                │
│                                                 │
│  Arbiter has ESCROW AUTHORITY ONLY:            │
│    • Calls resolveDispute(eng, ms, toLawyer,   │
│      toClient) to split parked funds           │
│    • Cannot decrypt messages — privilege       │
│      boundary stays absolute                   │
│    • Cannot unseal client identity (no such    │
│      mechanism in v3)                          │
│                                                 │
│  Evidence flow:                                │
│    Either party submits decrypted messages +   │
│    Merkle paths off-chain to the arbiter.      │
│    Non-cooperation = default loss by arbiter   │
│    discretion (same as civil arbitration       │
│    where ignoring proceedings = default).      │
│                                                 │
│  Production: arbitration multi-sig of          │
│  accredited arbitrators (with EBSI credentials)│
│  Demo: single arbiter address, hardcoded.      │
└────────────────────────────────────────────────┘
```

**Keys in play.** Issuer did:key (persisted, signs both bar cred + PID); verifier RSA cert (persisted, signs OID4VP request_objects via x509_san_dns); per-credential holder JWKs in wwWallet (batch issuance gives 5 instances per credential type for cross-verifier unlinkability — one set for the bar cred, a *different* set for the PID); user SIWE Ethereum addresses (link the two thumbprints into one platform identity); messaging derived keys (per-engagement, derived from each party's PID-side holder JWK via ECDH so messages are tied to the same identity that proved KYC). The platform never holds private keys for any of these. **The arbiter has no keys at all in v3** — they're an authorized address with the on-chain authority to call `resolveDispute(...)`, nothing more. They can't decrypt anything; they only adjudicate based on what the parties choose to reveal.

## Tech stack

### Backend (single Next.js app — issuer + verifier + platform all bundled)

The issuer, verifier, and platform are **one Next.js process**. The spike's standalone Express services were a useful intermediate form (easy to lift); for the platform they collapse into Next.js API routes that share the same SQLite DB, the same ngrok tunnel, and the same lifecycle. Smart contracts run separately on anvil, as before.

- Node 20+, TypeScript, **Next.js 14+ App Router** — one app for FE, API routes, OID4VCI endpoints, OID4VP endpoints, SSE streams.
- **`@sd-jwt/sd-jwt-vc` + `@sd-jwt/core`** — primary. Issues and verifies SD-JWT VCs (`vc+sd-jwt` format) for both lawyer and PID credentials. wwWallet's OID4VCI consume path requires SD-JWT VC or mDoc; W3C JWT VC is silently dropped (round-9 finding). Lift the `SDJwtVcInstance` setup from `spike/wallet-integration/issuer.mjs` into `lib/sdjwt.ts`. JWT header `typ` must be `dc+sd-jwt`.
- `@cef-ebsi/key-did-resolver` — `util.createDid(jwk)` for generating did:key strings, `getResolver()` for resolving them back to DID documents. wwWallet uses the same library, so did:key compatibility is mechanical.
- `jose` for keypair generation and JWT signing/verification helpers, plus `SignJWT` for the OID4VP signed request_object.
- WebCrypto (`crypto.webcrypto.subtle` in Node, `window.crypto.subtle` in browsers) — used by the `SDJwtVcInstance`'s signer/verifier callbacks AND by the messaging layer (ECDH P-256 key agreement between PID-side `cnf.jwk`s, AES-GCM symmetric encryption, ECDSA signatures over each ciphertext message). All client-side; the server never sees plaintext or session keys.
- **OpenSSL via child_process** for the verifier's self-signed RSA cert — Node's built-in crypto module doesn't expose x.509 cert generation, and the `selfsigned` npm package is broken on Node 22+. The cert must have `subjectAltName=DNS:<ngrok-hostname>` to satisfy wwWallet's x509_san_dns scheme.
- **`better-sqlite3`** — synchronous SQLite client, single file, no daemon. Tables: `profiles` (keyed by SIWE Ethereum address), `matters` (landing-page form submissions, draft + active), `engagements` (mirrors on-chain state for fast listing, indexes lawyer + client addresses), `messages` (per-engagement ciphertext blobs + sender sigs + message hashes — server stores only ciphertext), `oid4vci_offers` + `oid4vci_tokens` (TTL'd OID4VCI issuance state), `oid4vp_requests` (TTL'd OID4VP request_object state + presentation results). Synchronous API matters because Next.js API routes can call it without async wrapping ceremony.
- **Disk-persisted issuer did:key + verifier x.509 cert.** Generate on first boot, write to a `.lex-nova-keys/` directory (gitignored), read back on subsequent boots. **Critical for Next.js dev: hot reload re-runs server-side modules on every save** — without persistence the issuer's did:key gets regenerated and every credential already in wwWallet becomes unverifiable (issuer key mismatch). One-time fix; don't skip.
- **`siwe`** — Sign-In with Ethereum library, ~3 lines to integrate. SIWE Ethereum address is the platform-level identity that links the two holder JWK thumbprints (bar + PID, distinct per OID4VCI batch unlinkability) into a single user.
- **`@noir-lang/noir_js` + `@aztec/bb.js`** — noir_js handles ABI encoding + witness generation; bb.js (`UltraHonkBackend`) handles UltraHonk proof generation and verification. Both client (browser) and backend (Node verifier) need both. Round-8 verified: witness 51ms, proof ~1s, verify 128ms, proof size 16 KB.
- `viem` for anvil RPC + EAS contract interaction.
- **ngrok** — single tunnel exposing the Next.js app publicly so wwWallet can reach our OID4VCI/OID4VP endpoints. No path-routing proxy needed (the spike needed it because two services shared one tunnel; with everything in one Next.js app, one tunnel goes straight at the app). Reserved domain recommended for stage so the URL is stable across restarts.
- SSE endpoint at `/api/trace/[sessionId]` for live trace streaming to the side panel.

### Smart contracts + chain (separate from the Next.js app)

The Next.js app talks to the chain over `viem`, but the chain itself is a separate process. Two pieces:

- **Anvil** — local fake Ethereum node from Foundry. Started before the Next.js app; the platform reads its RPC at `http://localhost:8545` (chain ID 31337). For stage: `anvil --load-state state.json` with all contracts pre-deployed gives a 2-second cold start. `make demo-reset` kills + restarts + replays deploy in <10s.
- **Foundry contracts** — Solidity 0.8.28 (matches `eas-contracts` v1.4.0 pragma):
  - EAS contracts deployed from source — `eas-contracts` v1.4.0 from `ethereum-attestation-service/eas-contracts`.
  - **OpenZeppelin v5.2.0 specifically** — EAS v1.4.0 `package.json` pins this version; v5.0.x ABIs are off-by-enough that EAS deploy reverts.
  - **Optimizer required** in `foundry.toml` — without it, EAS bytecode exceeds the 24 KB EIP-170 contract-size limit and deployment reverts with `CreateContractSizeLimit`.
  - `LegalEngagementEscrow.sol` — our contract gating engagement on EAS attestations.

### ZK

- Noir 1.0.0-beta.20+ (verified in round 7), `nargo` toolchain
- `@noir-lang/noir_js` for browser proof generation
- Circuit: `conflict_check` — non-membership over N=8 Pedersen-hashed commitments
- Pre-warm proving key on engagement-page load to keep generation under 3s

### Frontend (same Next.js app)

- Tailwind CSS
- **`wagmi` + `viem` + `@rainbow-me/rainbowkit`** for MetaMask connection and SIWE flow
- SSE consumer for the side panel trace
- Three pages: `/lawyer/onboard`, `/client/onboard`, `/engagement/[id]`

### Wallets

- **wwWallet** at `https://demo.wwwallet.org` — both lawyer and client wallet. Pre-staged with credentials before stage.
- **MetaMask** — for SIWE login and engagement-tx signing. Configured per laptop with anvil custom network and a prefunded private key imported.

## Component breakdown

### 1a. Stand-in issuer (Next.js API routes; the bar AND the PID provider)

The issuer lives **inside the Next.js app** as a set of API routes under `app/api/issuer/*`. Same did:key signs both credential types within a session; the keypair is generated on first boot and **persisted to disk** at `.lex-nova-keys/issuer.jwk` so Next.js dev hot-reload doesn't regenerate it (which would invalidate every credential already issued into wwWallet). The reference implementation lives at [`spike/wallet-integration/issuer.mjs`](../spike/wallet-integration/issuer.mjs) — the spike's logic ports 1:1 to Next.js handlers; only the framing changes from Express to Route Handlers.

**Configuration:**

- Six personas hardcoded in a `PERSONAS` map: 5 EU lawyers (Anna Schmidt — RAK München; Lukas Weber — RAK Berlin; Sophie Lefèvre — Barreau de Paris; Marco Rossi — Ordine di Milano; Eva Novák — Česká advokátní komora) each with both a `bar` profile and a `pid` profile, plus 1 client (John Doe — US/GR) with `pid` only.
- Two credential configurations advertised at `/.well-known/openid-credential-issuer`:
  - `LegalProfessionalAccreditation_sdjwt` — vct `urn:lex-nova:LegalProfessionalAccreditation`, claims `given_name`, `family_name`, `jurisdiction`, `bar_admission_date`, `bar_admission_number`, `valid_until`.
  - `EudiPid_sdjwt` — vct `urn:eudi:pid:1`, EUDI ARF PID claims (full set: name + birth name, birthdate, age_in_years, age_birth_year, age_equal_or_over.{14,16,18,21,65}, sex, nationalities, email, phone_number, place_of_birth.{locality,region,country}, address.{formatted,street_address,house_number,postal_code,locality,region,country}, personal_administrative_number, document_number, issuing_authority/country/jurisdiction, date_of_expiry, date_of_issuance — NO `picture`, intentionally omitted as a few-KB-saving simplification).
- Both credential types use a 10-year `exp`. Disclosure frames are nested for the PID so each leaf claim (e.g. `address.country`, `age_equal_or_over.18`) is independently disclosable.

**OID4VCI endpoints (Next.js Route Handlers under `app/api/issuer/`; all validated against real wwWallet via the spike):**

- `GET /api/issuer/.well-known/openid-credential-issuer` — metadata, with `Cache-Control: no-store` (essential — wwWallet's HttpProxy caches issuer metadata for 30 days by default; without no-store, iterating the issuer requires manually purging the wallet's IndexedDB).
- `GET /api/issuer/.well-known/oauth-authorization-server` — advertises `dpop_signing_alg_values_supported: ["ES256"]` (omitting this triggers a wwWallet null-deref on TokenRequest.ts:215).
- `POST /api/issuer/offer` (operator UI calls this with `{ persona, credential_type }`) → writes an offer row to SQLite (with TTL) and returns a `credential_offer_uri` that wwWallet can fetch.
- `GET /api/issuer/credential-offer/[id]` → returns the actual credential offer JSON from SQLite. **Use credential_offer_uri, not inline credential_offer**: wwWallet's `CredentialOfferSchema` (in wallet-common) doesn't accept the `pre-authorized_code` grant in zod parsing; routing via uri bypasses that validation.
- `POST /api/issuer/token` — pre-authorized_code grant, returns `c_nonce`. Access token persisted to SQLite (with TTL).
- `POST /api/issuer/credential` — accepts both `proof.jwt` (Draft <14) and `proofs.jwt[]` (Draft 14+, what wwWallet sends); returns both `credential` (singular) and `credentials[]` shapes for backwards compat.
- Batch issuance advertised at `batch_credential_issuance.batch_size: 5` — wwWallet generates 5 holder keypairs and asks for 5 credentials in one round; each is bound to a different `cnf.jwk` so the wallet cycles through them across verifiers (cross-verifier unlinkability).

> wwWallet must reach these URLs publicly. In dev: ngrok tunnel pointed at the Next.js dev server, the metadata's `credential_issuer` field set to `https://<ngrok>.ngrok-free.dev/api/issuer`. In stage: a reserved ngrok domain.

**Operator UI:** Next.js page at `/operator/issue` (or behind an admin route — not user-accessible during the demo). Two sections (bar credential / PID), each with a persona dropdown. Generates a one-click `https://demo.wwwallet.org/cb?credential_offer_uri=…` link; operator clicks, wwWallet runs the full issuance dance, credential lands in the wallet's IndexedDB.

The issuer is **the bar** *and* **the PID provider** — same process, two roles, two `vct`s. Honest framing on stage: "in production these are 28+ regional Rechtsanwaltskammern under BRAK plus each member-state's eIDAS-notified PID provider, validated via EBSI's Trusted Issuers Registry. We collapse to one stand-in process because the protocol mechanics are identical regardless of issuer count."

### 1b. Platform verifier (live during onboarding)

The verifier also lives **inside the Next.js app** as API routes under `app/api/verifier/*` and `app/api/onboarding/*`. Reference impl is [`spike/wallet-integration/verifier.mjs`](../spike/wallet-integration/verifier.mjs) — same 1:1 port to Route Handlers. Distinct from the issuer in two ways:

1. **Separate keypair** — an RSA cert (not the issuer's did:key) signs OID4VP request_objects. Generated on first boot via `openssl req -x509 …` (Node's crypto module doesn't expose cert generation; the `selfsigned` npm package is broken on Node 22+). Like the issuer keypair, **persist to disk** at `.lex-nova-keys/verifier.{key,crt}` so hot reload doesn't regenerate it. The cert's `subjectAltName=DNS:<ngrok-hostname>` must match the prefixed `client_id` (`x509_san_dns:<hostname>`).
2. **Different lifecycle** — the verifier holds short-lived state per presentation (request_object JWT, nonce, expected DCQL credential id) keyed by a `requestId` UUID. This goes in SQLite with a 5-minute TTL, not in-memory, so a hot reload mid-flow doesn't invalidate an in-flight presentation.

**`POST /api/auth/login`** — SIWE entry point. See §Authentication below.

**`POST /api/onboarding/lawyer`** — invoked when a SIWE'd user with no profile visits `/lawyer/onboard`:

1. Construct an **OID4VP request** using **DCQL** (not `presentation_definition` — wwWallet ignores the older shape and returns `MISSING_DCQL_QUERY`). Two presentations needed; do them as two sequential `/presentation/request` calls (one bar, one PID), each with its own DCQL query:

   ```js
   // Lawyer credential query
   { credentials: [{ id: "lawyer-cred", format: "vc+sd-jwt",
       meta: { vct_values: ["urn:lex-nova:LegalProfessionalAccreditation"] },
       claims: [{path:["given_name"]}, {path:["family_name"]},
                {path:["jurisdiction"]}, {path:["bar_admission_date"]},
                {path:["valid_until"]}] }],
     credential_sets: [{ options: [["lawyer-cred"]], purpose: "…" }] }

   // PID query
   { credentials: [{ id: "client-pid", format: "vc+sd-jwt",
       meta: { vct_values: ["urn:eudi:pid:1"] },
       claims: [{path:["given_name"]}, {path:["family_name"]},
                {path:["nationalities"]}, {path:["age_equal_or_over","18"]},
                {path:["address","country"]}] }],
     credential_sets: [{ options: [["client-pid"]], purpose: "…" }] }
   ```

2. Build a signed OID4VP **request_object** JWT (`typ: oauth-authz-req+jwt`, `x5c: [<our-cert-DER>]`, RS256-signed). Wallet-common's `supportedClientIdSchemes` is `{x509_san_dns, x509_hash}` — encode the scheme as a prefix on `client_id` (Draft-23 syntax: `client_id: "x509_san_dns:<verifier-hostname>"`). The hostname must match the cert's SAN DNS entry. Place the request_object behind a `request_uri` and reference it from the `openid4vp://` URL — both URL and request-object client_ids must use the prefixed form, otherwise wwWallet rejects with `non_supported_client_id_scheme` before fetching the request_object.
3. Return the wwWallet one-click URL `https://demo.wwwallet.org/cb?client_id=<prefixed-client-id>&request_uri=…` for the operator UI.
4. Wait for wwWallet's `direct_post` callback at `/presentation/callback?id=<requestId>`. The body's `vp_token` is a **JSON-stringified** object keyed by the DCQL credential id (e.g. `{"lawyer-cred": "<sd-jwt-vc>"}`); the value is either a string or an array depending on wallet-common version, handle both. Inner SD-JWT VC has format `<header>.<payload>.<sig>~<disclosure1>~…~<kbjwt>`.
5. For each presented SD-JWT VC:
   - Parse the JWT header, extract `kid` (e.g. `did:key:z2dmzD…#z2dmzD…` from our stand-in issuer; in production a TIR-registered DID).
   - Build a fresh `SDJwtVcInstance` with a verifier callback that resolves the issuer JWK from the kid (did:key via `@cef-ebsi/key-did-resolver`).
   - Call `verify(sdJwtVc)`. Returns the verified payload with disclosed claims.
   - Compute holder identifier from `cnf.jwk` via RFC-7638 thumbprint over `{crv, kty, x, y}`. **Note:** holder thumbprint differs between bar and PID credentials due to OID4VCI batch issuance (each issuance mints fresh holder keypairs for cross-verifier unlinkability) — link them at the platform layer via the SIWE Ethereum address, not via thumbprint matching.
6. Write two EAS attestations to anvil under the verifier's signing key:
   - Lawyer schema: `(ethAddress, holderJwkThumbprintBar, jurisdiction, barAdmissionDate, verifiedAt)`
   - Client schema: `(ethAddress, holderJwkThumbprintPid, nationality, over18, addressCountry, verifiedAt)` — `nationality` stores `nationalities[0]`, `addressCountry` stores `address.country`, `over18` stores `age_equal_or_over.18`
7. Persist profile keyed by `ethAddress`: `{ ethAddress, capabilities: ["verified_lawyer", "verified_client"], barHolderThumbprint, pidHolderThumbprint, lawyerAttestationUid, clientAttestationUid }`. Two thumbprints, one address.
8. Stream trace events via SSE.

**`POST /api/onboarding/client`** — for users visiting `/client/onboard`:

Same flow, but only the PID query runs (no bar credential). One EAS attestation written under the client schema. Profile gains `verified_client` only.

The whole stack — DCQL query construction, x509_san_dns request_object signing, vp_token unwrapping, did:key issuer resolution, holder thumbprint computation — is exactly the working code in `spike/wallet-integration/verifier.mjs`. Lift it as `lib/verifier.ts` in the platform package.

#### Trust model: what EAS attestations represent (and what they don't)

Three distinct entities are in play, even though for hackathon convenience they share a single Next.js process:

1. **The bar association** (issuer) — owns `.lex-nova-keys/issuer.jwk`. Signs `LegalProfessionalAccreditation` SD-JWT VCs into wallets at issuance time. Production: the actual bar.
2. **The PID provider** (issuer) — also uses `.lex-nova-keys/issuer.jwk` as a single stand-in in the demo. Production: each member-state's eIDAS-notified provider.
3. **Lex-nova platform** — owns the verifier RSA cert (signs OID4VP request_objects), the platform operator's Ethereum address (anvil #0; writes EAS attestations), and the Treasury address.

**EAS attestation = the platform's on-chain record that it cryptographically verified a credential at attestation time.** Specifically: when a user presents an SD-JWT VC via OID4VP, the platform validates the signature against the issuer's did:key, validates the holder binding via `cnf.jwk`, validates the selective disclosure proofs, and *then* writes an EAS attestation under the user's SIWE Ethereum address. The attestation is the persistent on-chain record the engagement contract gates on — `createEngagement` reverts if either party's relevant attestation is missing or revoked.

**What EAS attestations DON'T do in v3:** they don't prove the issuer is a recognized member of any trust hierarchy. The signature check confirms "this credential was signed by the holder of `did:key:z2dmzD…`" — but in v3 the platform trusts that DID by *implicit hardcoded acceptance* (it's the only issuer the verifier accepts). The platform IS the trust anchor for v3; that's the trade-off of running our own stand-in issuer.

**Production trajectory: TIR closes that gap.** When real bar associations register their DIDs (typically `did:ebsi:...`) in EBSI's Trusted Issuers Registry, the platform's verifier adds one extra step before writing the EAS attestation: `GET https://api-conformance.ebsi.eu/trusted-issuers-registry/v5/issuers/{issuerDid}`. If the lookup returns valid issuer data + accreditation chain, the attestation gets written; if it returns 404, the platform refuses to attest (the credential was signed by a real key, but that key isn't recognized by the trust hierarchy — could be a rogue issuer). **TIR is the production trust source; EAS remains the on-chain handshake the contract reads.** Neither replaces the other; they compose.

We considered adding a TIR lookup to the spike for trace-legibility, but since our stand-in issuer's did:key isn't registered (couldn't be — TAO accreditation requires multi-week paperwork), every lookup would just return 404. Zero new information per call. The honest move is to keep TIR slide-only and frame v3 as "platform-trusted; production-trusted-via-TIR."

**Revocation flow:**

- **In v3:** the platform operator's `Manage Capabilities` admin page can revoke any EAS attestation it issued. Grant power is asymmetric per capability (see §6) — `verified_lawyer`/`verified_client` are only granted via OID4VP audit trail, never directly by operator click.
- **In production:** TIR revocation events propagate to the platform — when a bar association deregisters a lawyer in TIR (or its own accreditation gets revoked at a higher level), the platform calls `EAS.revoke(...)` on the corresponding `verified_lawyer` attestations. Existing in-flight engagements survive on chain (their attestations were valid when created), but new milestones from a revoked attestation get rejected at `createEngagement`.

### 1c. wwWallet pre-staging procedure

Before each demo run, on each laptop:

1. Open the demo Chrome profile (must be a profile dedicated to the demo, so wwWallet's IndexedDB persists).
2. Navigate to `https://demo.wwwallet.org` and log in (passkey via Google account works, Bitwarden does not — wwWallet uses WebAuthn PRF which Bitwarden doesn't yet support).
3. Start the chain + app:

   ```bash
   anvil --load-state state.json &           # in background
   pnpm dev                                  # Next.js dev server on :3000
   ngrok http --domain=<reserved> 3000 &     # public URL for wwWallet
   ```

4. Open the operator UI at `https://<ngrok-domain>/operator/issue` (or whatever route houses the persona-issuance page).
5. Pick the persona from the **Bar credential** dropdown, click "Generate bar credential offer", then click the resulting "Open in wwWallet" button. Approve in wwWallet.
6. Same in the **PID** section, same persona. Approve. (For the client laptop: only PID, persona = "John Doe".)
7. Verify wwWallet's "Credentials" tab shows the expected credentials with the rendered card art.

wwWallet's IndexedDB persists across browser sessions, so this seeding is one-time per laptop until the browser profile is cleared. The issuer sets `Cache-Control: no-store` so changes to issuer metadata propagate without manual cache flushing — but a one-time IndexedDB purge of `proxyCache` is required if the wallet was used against an older version of the issuer.

### 1d. Validated wwWallet constraints (round-9 spike)

These are constraints that the spike work uncovered and worked around. Each one is a non-obvious thing the platform implementation must respect:

- **Format must be `vc+sd-jwt`** (or `dc+sd-jwt`, or `mso_mdoc`). `jwt_vc_json` is silently dropped during OID4VCI consume.
- **JWT header `typ` must be `dc+sd-jwt`** (not `vc+sd-jwt`) for the SD-JWT itself.
- **Issuer `iss` claim must be an HTTPS URL**, not the issuer DID. wwWallet's SD-JWT VC parser fetches `<iss>/.well-known/openid-credential-issuer` for display metadata; if `iss` is `did:key:…` the fetch is invalid and the credential renders without friendly claim labels.
- **Use `credential_offer_uri` not inline `credential_offer`**. Inline offers go through wallet-common's `CredentialOfferSchema` zod parsing, which strips the `pre-authorized_code` grant.
- **Advertise `dpop_signing_alg_values_supported`** in `/.well-known/oauth-authorization-server`. Without it, wwWallet null-derefs in `TokenRequest.ts:215`.
- **Accept both `proof.jwt` (singular) and `proofs.jwt[]` (array)** at the credential endpoint. Self-test sends the singular form; wwWallet (Draft 14+) sends the array.
- **Return both `credential` (singular) and `credentials[]` (array of `{credential}`)** in the response. wwWallet reads `credentials[].credential` (Draft 14+); the singular keeps backwards-compat.
- **Advertise `batch_credential_issuance.batch_size: 5`** to get unlinkable instances. wwWallet generates 5 holder keypairs and asks for 5 credentials, each bound to a different `cnf.jwk`.
- **`Cache-Control: no-store` on issuer metadata.** Otherwise wwWallet's HttpProxy caches it for 30 days.
- **OID4VP `client_id` uses Draft-23 prefixed syntax** (`x509_san_dns:<hostname>` or `x509_hash:<hash>`), NOT a separate `client_id_scheme` field. Both URL-level and request-object-level client_ids must use the prefix; URL-level is checked before the request_object is even fetched.
- **OID4VP request_object signed JWT** with `typ: oauth-authz-req+jwt`, `x5c: [<base64-DER cert>]`, RS256. Self-signed cert with `subjectAltName=DNS:<verifier-hostname>` matching the prefixed client_id is sufficient (wwWallet's SAN DNS strict-check defaults to false).
- **OID4VP requires DCQL**, not `presentation_definition`. The older shape is silently ignored, returning `MISSING_DCQL_QUERY`.
- **`vp_token` shape from DCQL is JSON-stringified, keyed by credential id**: `{"lawyer-cred": "<sd-jwt-vc>"}` — the value is a string OR an array of strings depending on wallet-common version, handle both.
- **DCQL `credential_sets[].purpose` is currently ignored** (wallet-common hardcodes `purposeNotSpecified` at `OpenID4VPServerAPI.ts:251`). Set it anyway so it surfaces once wwWallet ships proper DCQL purpose support.
- **`credential_metadata.display` + `credential_metadata.claims`** in the issuer metadata is what drives wwWallet's card rendering (background image, colours, friendly claim labels). Without claim metadata, only well-known claim names like `given_name` get friendly labels in the wallet UI.

**Optional fallback:** if a future wwWallet release breaks something here, swap the bar's DID method to **did:web** (host `/.well-known/did.json` over HTTPS via Cloudflare Tunnel during dev). Functionally identical from the verifier's perspective. We didn't need this in the spike.

### 2. Client PID — selective disclosure only, no ZK here

Round-1 spec ran the ZK conflict check during client onboarding. **Moved.** ZK now runs at engagement-creation time (component 4), where it conceptually belongs.

Client onboarding is therefore *just* PID verification — `@sd-jwt/sd-jwt-vc` parses the SD-JWT VC, validates the issuer's signature against the stand-in issuer's did:key, extracts the disclosed claims (`given_name`, `family_name`, `nationalities`, `age_equal_or_over.18`, `address.country`), writes the EAS attestation. ~2 seconds end to end. **Why our own PID issuer:** see "Three claims" §2 above — eudiw.dev is incompatible with wwWallet (RFC 9207 strict iss mismatch).

### 3. ZK conflict-check — at engagement-creation time

**Circuit (Noir, verified compiling in round 7):**

```rust
fn main(
    client_secret: Field,                    // private — derived from client's PID claims + did:key
    prior_commitments: pub [Field; 8],       // public — lawyer's hashed prior clients under fresh salt
    salt: pub Field                          // public — fresh per engagement attempt
) {
    let commitment = std::hash::pedersen_hash([client_secret, salt]);
    for i in 0..8 {
        assert(commitment != prior_commitments[i]);
    }
}
```

**Flow at engagement creation:**

1. Client clicks "Engage Hans" (the chosen lawyer) in the UI.
2. Frontend hits `POST /api/engagements/preflight` with `{ lawyerEthAddress, clientEthAddress }`.
3. Backend generates a fresh 32-byte salt. Looks up the lawyer's prior-client identity list. Computes `prior_commitments[i] = pedersen_hash(prior_client_id[i], salt)`.
4. Returns `{ priorCommitments, salt }` to the browser.
5. Browser computes `client_secret = pedersen_hash([hash(disclosed_nationalities[0]), hash(disclosed_address_country), age_over_18 ? 1 : 0, holder_jwk_thumbprint])` from the client's stored disclosed PID claims (claim names per the validated PID payload: `nationalities[]`, `address.country`, `age_equal_or_over.18`).
6. Browser uses `@noir-lang/noir_js` (with prewarmed proving key) to generate the proof. ~2.3s.
7. Browser POSTs `{ proof, publicInputs: { priorCommitments, salt } }` to `/api/engagements/verify-zk`.
8. Backend verifies via `@noir-lang/noir_js`. ~50ms.
9. On pass, frontend enables the "Create Engagement" button (which then triggers MetaMask).

**Why N=8:** keeps browser proof generation under ~3 seconds. Production scales to a Merkle tree of thousands. Honest framing on stage.

**Pre-warm the proving key** on engagement-page load so the only delay during demo is the actual proof generation, not WASM load.

For prior-client data: we hardcode 8 fake "prior clients" for Hans in the seed script. Each prior client has a synthetic identity hash. Marta's commitment is computed deterministically from her PID claims so the proof is non-trivial.

### 4. EAS contracts deployed from source on anvil

Round 2 finding: anvil has no Base predeploys. We deploy EAS ourselves.

**Required Foundry config** (verified in round 7 — without these, deploy reverts):

`contracts/foundry.toml`:

```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
optimizer = true
optimizer_runs = 1000000
solc = "0.8.28"
```

`contracts/remappings.txt`:

```text
eas-contracts/=lib/eas-contracts/contracts/
forge-std/=lib/forge-std/src/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
```

**Required dependency installs:**

```bash
forge install foundry-rs/forge-std
forge install ethereum-attestation-service/eas-contracts
forge install OpenZeppelin/openzeppelin-contracts@v5.2.0
```

OpenZeppelin v5.2.0 specifically — EAS v1.4.0 pins this version in its `package.json`. v5.0.x is close but not ABI-compatible enough; deploy reverts.

**Foundry deploy script** (`script/Deploy.s.sol`):

```solidity
contract DeployScript is Script {
    function run() external {
        vm.startBroadcast();

        SchemaRegistry registry = new SchemaRegistry();
        EAS eas = new EAS(registry);

        bytes32 lawyerSchemaUid = registry.register(
            "address lawyer, string holderJwkThumbprintBar, string jurisdiction, string barAdmissionDate, uint64 verifiedAt",
            address(0), true
        );
        bytes32 clientSchemaUid = registry.register(
            "address client, string holderJwkThumbprintPid, string nationality, bool over18, string addressCountry, uint64 verifiedAt",
            address(0), true
        );
        // Engagement schema: written when an engagement is created. matterDigest
        // commits to the off-chain matter description; transcriptRoot is the
        // running Merkle root of the messaging transcript, updated at each
        // milestone fund/release tx.
        bytes32 engagementSchemaUid = registry.register(
            "uint256 engagementId, address lawyer, address client, bytes32 matterDigest, bytes32 transcriptRoot, uint64 createdAt",
            address(0), true
        );

        LegalEngagementEscrow escrow = new LegalEngagementEscrow(
            address(eas), lawyerSchemaUid, clientSchemaUid, engagementSchemaUid, TREASURY
        );

        // Write addresses to deployments/anvil.json for the platform to read
        vm.stopBroadcast();
    }
}
```

`make demo-reset`: kill anvil, restart, replay the deploy. Under 10 seconds.

**Pre-warm** `state.json` before stage and start anvil with `--load-state state.json`. Two-second cold start, all addresses ready, but **no profiles or attestations yet** — those are created live during the demo.

### 4b. E2EE messaging layer

The lawyer-client thread is the heart of Tier 2: it's where the actual legal work happens. The platform must not be in the trust path for content; that's required for attorney-client privilege to hold (cryptographically, not contractually).

**Security goals:**

1. **Confidentiality** — only lawyer + client can read message content. Platform stores ciphertext only.
2. **Authenticity + non-repudiation** — every message is signed by the sender's PID-side wallet holder key. Either party can prove "X said Y at time T" to an arbitrator without the platform's cooperation.
3. **Integrity** — messages are hashed into a per-engagement Merkle transcript; root committed on chain at each milestone event. Neither party can plant or rewrite a message after a milestone has settled.
4. **Forward secrecy** — per-engagement key derivation; compromise of a wallet's holder key in 2030 doesn't reveal 2026 messages on already-closed engagements.

**Demo transport (encrypted-localStorage stub):**

- Each engagement gets a symmetric session key derived client-side from a Diffie-Hellman between the two parties' PID-side holder JWKs (both ECDH P-256 — extracted from `cnf.jwk` of each party's PID credential, accessible because each user is logged into their own wwWallet).
- Messages composed in a chat panel on the engagement page; encrypted with the session key (AES-GCM); the ciphertext + sender signature is POSTed to `/api/engagements/[id]/messages`.
- Server stores the ciphertext blob + sender signature in SQLite. Server cannot decrypt; private keys never leave the wallets.
- Each new message: client computes `messageHash = sha256(ciphertext || senderSig || timestamp)`, appends to the local Merkle tree, recomputes the root.
- At each milestone fund/release tx, the latest transcript root is included as a parameter; the contract updates `engagement.transcriptRoot`.

**Production transport (XMTP MLS):**

- Same crypto shape, different wire. XMTP handles the messaging substrate (MLS group of two, decentralized message storage) so the platform isn't even storing ciphertext. Same per-engagement key derivation, same per-milestone transcript-root commitment.
- Slide-deck framing on stage: "the demo uses a localStorage-backed stub; production swaps in XMTP without changing any of the on-chain semantics or the privilege guarantee."

**Threat model:**

| Threat | Defended? | How |
|---|---|---|
| Platform operators reading content | ✓ | E2EE; keys in wallets |
| Subpoena for content | ✓ | Platform doesn't have plaintext |
| Either party tampering with the record | ✓ | On-chain transcript root + per-message signatures |
| Lawyer leaking client identity off-platform | ✗ | Out of scope; same as today's legal practice; lawyer reputation-staked via verified credential |
| Compromised wallet | Partial | Forward secrecy on past closed engagements; future messages compromised until key rotation |
| Active platform-level metadata analysis (who → who, when, frequency) | Partial in demo, full in production | Demo transport leaks metadata; XMTP relays obscure it |

**API surface (Next.js Route Handlers under `app/api/engagements/[id]/messages/`):**

- `POST /` — receive ciphertext + sender sig; store in SQLite; return `messageHash`. No decryption.
- `GET /` — return all ciphertexts + sigs for this engagement (paginated). Frontend decrypts client-side.
- `POST /transcript-root` — compute and return the current Merkle root over all stored message hashes. Used by the engagement page right before milestone fund/release calls so the on-chain commitment matches what was sent.

**Demo beat:** during the engagement segment, audience sees Marta type "Quick question — does the 25k capital need to sit in a German account before incorporation, or can it transfer at close?" and hit send. Side panel: `→ POST /api/engagements/0x12.../messages — 248 bytes ciphertext, signature 0x9a7c…`. Anna's view shows the same message decrypted on her side. When Marta releases the milestone, side panel: `transcriptRoot 0xa42b… committed to engagement on chain (block 24)`. The audience sees: real chat, encrypted in transit, hashes locked on chain. Concrete and visceral.

### 5. LegalEngagementEscrow contract — milestone-based with asymmetric dispute

The round-1 contract was single-amount. v3 spec replaces it with a **milestone-based** structure with **asymmetric dispute rights** + an **arbiter with escrow authority only**. The lawyer-side cooldown isn't there because lawyer disputes can break pseudonymity (they can't, in v3 — arbiters have no decryption authority); it's there because lawyer-triggered disputes drag the client into arbitration proceedings, with the cost of evidence preparation, attention overhead, and reputational tax of being on the receiving end of a complaint. Without a cooldown, "pay me or I drag you into arbitration tomorrow" still works as a coercion lever even if the arbiter can't see anything. The 30-day post-delivery wait makes that lever cost the lawyer 30 days of patience.

**Engagement lifecycle:**

1. Lawyer accepts a matter from her inbox; a quote for milestone 0 (the initial consultation) is auto-populated from her posted rate-card.
2. Lawyer calls `createEngagement(client, lawyerAttUid, clientAttUid, matterDigest, initialMilestone)` — engagement created with milestone 0 in `Proposed` state. Funded amount: 0.
3. Client calls `acceptAndFundMilestone(engagementId, 0)` payable — milestone advances `Proposed → Funded`. Engagement is now active.
4. Lawyer + client communicate via the E2EE messaging layer (§4b). Lawyer does the work.
5. Lawyer calls `markDelivered(engagementId, 0)` to signal completion. Milestone advances `Funded → Delivered`; `deliveredAt` timestamp recorded; the lawyer's escalation cooldown clock starts.
6. From `Delivered`, three paths:
   - Client calls `releaseMilestone(engagementId, 0, transcriptRoot)` → 85% to lawyer, 15% to platform treasury. Milestone `Delivered → Released`. Transcript root committed to the engagement EAS attestation. **Happy path.**
   - Client calls `disputeMilestone(engagementId, 0)` → milestone `Delivered → Disputed`. Client-triggered, no cooldown — the client is the funder of the locked amount, so disputing locks their own ETH; limited harassment potential.
   - Lawyer calls `escalateMilestone(engagementId, 0)` after `block.timestamp >= deliveredAt + LAWYER_DISPUTE_COOLDOWN` → milestone `Delivered → Disputed`. Lawyer-triggered, cooldown-gated. Reverts if the cooldown hasn't elapsed.
7. **For follow-on work:** lawyer calls `proposeMilestone(engagementId, descriptionHash, amount)` → milestone N appended in `Proposed` state. Goto step 3.

**State machine per milestone:** `Proposed → Funded → Delivered → Released` happy path; `Funded → Disputed` (rare; client-only, when client wants to dispute *before* the lawyer signals delivery — e.g., lawyer ghosted entirely after funding); `Delivered → Disputed` escalates to Tier 3 via either party (asymmetric: client immediate, lawyer only after cooldown).

**Engagement-level metadata stored on chain:**

- `lawyer`, `client` addresses
- `lawyerAttestationUid`, `clientAttestationUid` — EAS UIDs that gate the engagement
- `matterDigest` — bytes32 hash of the matter description (off-chain text hashed and committed)
- `transcriptRoot` — bytes32 Merkle root of the per-engagement message transcript, updated at each milestone fund/release event
- `Milestone[] milestones` — the array of milestones, each with `descriptionHash`, `amount`, `status`, `proposedAt`, `fundedAt`, `deliveredAt`, `releasedAt`

**Contract surface (key functions):**

```solidity
// Constructor params
uint256 public immutable LAWYER_DISPUTE_COOLDOWN; // 30 days prod, 30s demo
address public immutable ARBITER;                  // multi-sig in prod, single addr in demo

// Lifecycle
function createEngagement(address client, bytes32 lawyerAttUid, bytes32 clientAttUid,
                         bytes32 matterDigest, MilestoneInput calldata initial)
                         external returns (uint256 engagementId);
function proposeMilestone(uint256 engagementId, bytes32 descriptionHash, uint256 amount)
                         external onlyLawyer(engagementId);
function acceptAndFundMilestone(uint256 engagementId, uint256 milestoneIndex)
                                external payable onlyClient(engagementId);
function markDelivered(uint256 engagementId, uint256 milestoneIndex)
                       external onlyLawyer(engagementId);
function releaseMilestone(uint256 engagementId, uint256 milestoneIndex, bytes32 transcriptRoot)
                          external onlyClient(engagementId);

// Dispute paths — asymmetric
function disputeMilestone(uint256 engagementId, uint256 milestoneIndex)
                          external onlyClient(engagementId);
                          // requires status == Funded || Delivered
                          // no cooldown — client can dispute any time

function escalateMilestone(uint256 engagementId, uint256 milestoneIndex)
                           external onlyLawyer(engagementId);
                           // requires status == Delivered
                           // requires block.timestamp >= deliveredAt + LAWYER_DISPUTE_COOLDOWN
                           // reverts otherwise

// Arbiter resolution — escrow authority only
function resolveDispute(uint256 engagementId, uint256 milestoneIndex,
                        uint256 amountToLawyer, uint256 amountToClient)
                        external onlyArbiter;
                        // requires status == Disputed
                        // requires amountToLawyer + amountToClient + platformTake == milestone.amount
                        // (15% platform take on whichever portion goes to the lawyer)
                        // transfers funds, milestone status: Disputed → Resolved
                        // arbiter has NO authority to decrypt messages or unseal identity;
                        // they can only split the parked funds.
```

**Why on-chain transcript roots:** the messaging layer (§4b) computes a running Merkle root over signed message hashes per engagement. Updating that root in the engagement contract at each milestone event means: (a) at any point in the future, either party can prove a specific message was part of the conversation by revealing the message + its Merkle path, and (b) neither party can plant or rewrite a message after a milestone has been settled. This is the on-chain audit trail that the original task description called out, and it's what makes the arbiter's job possible without breaking E2EE.

**Evidence flow on dispute:** the arbiter has no decryption keys. To make a case, either party voluntarily decrypts the messages they want the arbiter to see and submits them off-chain (e.g., via a "Submit evidence" panel on the engagement page that delivers the package — plaintext + Merkle path + sender signature for each message — to the arbiter's inbox, possibly encrypted to the arbiter's public key for transport security). The arbiter then verifies on-chain: each Merkle path resolves to the engagement's `transcriptRoot`, each signature checks against the relevant party's wallet address. Anything that doesn't verify is rejected. **Selective disclosure is bounded** — a party that reveals only flattering messages risks the arbiter weighing the silence ("you're showing me 3 messages but the transcript root commits to 12 — what about the others?"). The other party can then submit the missing messages to fill in the picture. **Non-cooperation = default loss** by arbiter discretion: a party that refuses to engage with the arbitration entirely (won't submit evidence, won't respond to inquiries) is effectively conceding, same as in real civil arbitration.

**Take rate:** `TAKE_RATE_BPS = 1500` applied per milestone release, not at engagement creation. Lawyer earns when work is actually delivered AND released.

**Demo demonstration of the cooldown:** the contract takes `LAWYER_DISPUTE_COOLDOWN` as an immutable constructor parameter. Production deploy passes `30 days`; demo deploy passes `30 seconds`. On stage we can also showcase the guardrail mid-demo via anvil's time-warp:

```bash
# Lawyer clicks "Escalate" too early → contract reverts:
#   Error: LawyerCooldownNotElapsed(deliveredAt=N, requiredAt=N+30s, now=N+5s)
# Operator runs:
cast rpc evm_increaseTime 30   # fast-forward 30 seconds
cast rpc evm_mine               # mine a block to apply the time bump
# Lawyer clicks "Escalate" again → success.
```

The audience sees the guardrail enforce itself in real time. (Without the time-warp the demo would have to wait the full cooldown — an option, but slower.)

**Who is the arbiter — and why arbiters are verified lawyers.** In v3, the `ARBITER` constructor param is a single hardcoded address. In production, the arbiter check in the contract becomes a lookup against the EAS attestations: `onlyArbiter` checks that `msg.sender` has a non-revoked `verified_arbiter` attestation under the platform's signing key. The platform issues `verified_arbiter` only to addresses that already hold `verified_lawyer` (i.e., already presented a valid bar credential), and only after manual platform review (legal background, arbitration experience, conflict-of-interest disclosures, institutional memberships such as CEPANI/DIS/ICC). Three reasons this composition matters:

1. **Domain expertise** — disputes about whether legal work was scoped properly require legal training; non-lawyer maintainers shouldn't rule on lawyer-quality questions.
2. **Regulatory clean-room** — if the platform itself were the arbiter, it would be providing legal services (restricted under BRAO and equivalents); putting arbitration into the hands of credentialed lawyers preserves the Stripe-equivalent payment-rails framing.
3. **Conflict-of-interest separation** — the platform takes 15% on releases. If the platform also rules on releases, there's a structural bias toward whichever ruling moves more money. Arbiters are *separate* from the platform.

The "verified_arbiter is added on top of verified_lawyer" pattern composes elegantly with the rest of v3's additive-capability model: a single Ethereum address can hold `[verified_client, verified_lawyer, verified_arbiter]` simultaneously, with attestations stamped at different times by different ceremonies.

**Address roles for the demo.** Anvil pre-funds 10 deterministic accounts. We use the first 7 for distinct on-chain roles, leaving 3 spares. Splitting roles across distinct addresses (rather than collapsing onto one) lets the side-panel trace tell the story by itself — a tx from `0xf39F…` (operator) is doing a different thing than a tx from `0x70997…` (Anna) without any narration.

| Anvil account | Role / Persona | Capabilities |
|---|---|---|
| #0 (`0xf39Fd6e5…`) | Platform operator (deployer, EAS attester, treasury) | — |
| #1 (`0x70997970…`) | **Anna Schmidt** (DE — Munich) | `[verified_client, verified_lawyer]` |
| #2 (`0x3C44CdDd…`) | **Lukas Weber** (DE — Berlin) | `[verified_client, verified_lawyer]` |
| #3 (`0x90F79bf6…`) | **Sophie Lefèvre** (FR — Paris) | `[verified_client, verified_lawyer]` |
| #4 (`0x15d34AAf…`) | **Marco Rossi** (IT — Milano) | `[verified_client, verified_lawyer]` |
| #5 (`0x9965507D…`) | **Eva Novák** (CZ — Praha) — *also the arbiter* | `[verified_client, verified_lawyer, verified_arbiter]` |
| #6 (`0x976EA74C…`) | **John Doe / Marta** (client) | `[verified_client]` |
| #7, #8, #9 | spares | — |

The `ARBITER` constructor param of `LegalEngagementEscrow` points to **Eva's address (#5)**. She's chosen specifically because she's CZ-jurisdiction in a demo focused on a DE engagement (Anna ↔ Marta), so she's not the lawyer involved in any of the disputed engagements — clean conflict-of-interest. She's also already a verified lawyer (mirroring the production model), so granting her the additional `verified_arbiter` capability shows the additive-capability story on a live address.

**Engagement assignments for the demo:**

- **Marta's live engagement** — Marta (#6, client) ↔ Anna (#1, lawyer)
- **Pre-staged engagement #1** (client-disputed) — Lukas (#2, exercising `verified_client`) ↔ Anna (#1, lawyer)
- **Pre-staged engagement #2** (lawyer-escalated) — Marco (#4, exercising `verified_client`) ↔ Anna (#1, lawyer)
- **Eva (#5) resolves both dispute beats** as the arbiter — never the lawyer in any of them.

This incidentally demonstrates the "lawyer hires another lawyer" claim from the spec's additive-capability model: when Lukas plays the client role in engagement #1, the audience sees a lawyer exercising their citizen-side capability, exactly as the spec promises.

**Foundry tests:** Full branch coverage on:

- Happy path: Propose → Fund → Deliver → Release across multiple milestones
- Client dispute path: Funded → Dispute (immediate); Delivered → Dispute (immediate); funds park; only-client-can-dispute
- Lawyer escalation path: Delivered → Escalate after cooldown succeeds; Escalate-before-cooldown reverts; escalate-without-delivery reverts; only-lawyer-can-escalate
- Arbiter resolution: `resolveDispute` from `Disputed → Resolved` succeeds with valid split; reverts if amounts don't sum correctly; reverts if status != Disputed; only-arbiter-can-resolve; reverts on splits that exceed the milestone amount.
- Auth: cannot propose-as-non-lawyer, cannot release-as-non-client, cannot fund-without-acceptance, cannot mark-delivered-as-non-lawyer
- EAS gate: createEngagement reverts if either attestation is missing or revoked

~5 hours of test writing (asymmetric dispute paths + arbiter resolution add meaningful surface vs the simpler dispute model).

### 6. Frontend pages

The client journey is **protagonist-driven with eager authentication**: Marta lands, connects her wallet, gets onboarded as `verified_client` immediately, then posts a matter, browses lawyers, engages. The auth ceremony lands at the *start* of her session, not at engagement-creation time. Linear funnel; verify once; use everywhere. Anna joined the platform the same way (off-stage), then opted into the additional `verified_lawyer` capability via a dashboard affordance.

- **`/` (landing)** — hero + value prop + a single **Connect Wallet** button. No matter form here; the matter form lives on the dashboard, post-auth. Anonymous visitors can read but cannot post. Connect Wallet → MetaMask → SIWE message → backend lookup:
  - Address recognized → set session cookie → `/dashboard`.
  - Address not recognized → set session cookie → `/onboard`.

- **`/onboard`** — first-time user verification. Page says "Verify you're a real EU resident before posting a matter or engaging a lawyer." → SIWE-recognized address has a server-side `pendingOnboarding` flag → click "Verify with EUDI Wallet" → OID4VP DCQL for PID with selective disclosure of `given_name`, `family_name`, `nationalities`, `age_equal_or_over.18`, `address.country` → server validates, writes EAS client attestation under the SIWE address, persists the profile with `[verified_client]` capability → `/dashboard`.

- **`/dashboard`** — post-auth home. Sections:
  - **"What do you need help with?"** — matter textarea + jurisdiction dropdown (relocated from the old landing page). Submit creates a `matters` row (status `draft`) and routes to `/find-lawyer?matterId=…`.
  - **Active engagements** — list of engagements where this user is the client.
  - **"Become a verified lawyer →"** — affordance for any logged-in client who wants to add the `verified_lawyer` capability. Click → OID4VP DCQL for the bar credential → server validates, writes EAS lawyer attestation under the *same* SIWE address, profile gains `verified_lawyer`. Now the dashboard also shows lawyer-side sections (Inbox, Active engagements as lawyer, posted-rate-card editor). Capabilities are additive on the same Ethereum address.
  - For users with `verified_lawyer`: **Lawyer Inbox** (engagements awaiting milestone proposals or delivery) and posted-rate-card editor.

- **`/find-lawyer`** — lists profiles with `verified_lawyer` capability, filterable by jurisdiction (defaulting to the matter's jurisdiction dropdown). Each profile card shows **only fields the bar credential attested to**: `given_name family_name`, `RAK München · admitted YYYY-MM-DD`, `jurisdiction: DE`. Plus the lawyer's posted initial-consultation rate. No testimonials, no "satisfied clients" claims, no LinkedIn-style fluff — the visual contrast with normal directory sites is the product point. Click "Engage [name] →" routes to `/engagement/new?matterId=…&lawyer=…`.

- **`/engagement/new`** — confirmation page: matter at top, lawyer's profile card, milestone 0's posted rate. "Proceed?" button. Marta is already authenticated and verified at this point — the only thing left is the ZK conflict-check + the contract call. ZK runs on click; backend submits `createEngagement(...)` with milestone 0 in `Proposed` state once the proof passes. → `/engagement/[id]`.

- **`/engagement/[id]`** — the live engagement page, used by both parties. Top: matter description + parties + verified-lawyer badge. Middle: **chat panel** (E2EE messaging from §4b — composer, message log, decryption client-side). Bottom: **milestone panel** showing each milestone with its current status (`Proposed` / `Funded` / `Delivered` / `Released` / `Disputed`), amounts, action buttons appropriate to the viewer's role and the milestone's current state. Lawyer-side: `proposeMilestone(...)` on a fresh engagement; `markDelivered(...)` on `Funded`; `escalateMilestone(...)` on `Delivered` after cooldown. Client-side: `acceptAndFundMilestone(...)` on `Proposed`; `releaseMilestone(...)` on `Delivered`; `disputeMilestone(...)` any time after `Funded`. Each contract action triggers MetaMask, then renders the tx receipt inline. The Escalate button shows a countdown timer when the cooldown is still elapsing ("Available in 22d 14h").

- **`/lawyer/onboard`** — *deprecated* in v3 final. Replaced by the "Become a verified lawyer →" affordance on `/dashboard`. Lawyers don't onboard on a separate URL anymore; they onboard as clients first (PID) and then opt into the lawyer capability. This change makes Anna's pre-stage process literally identical to Marta's first-visit process plus one extra click — same code path, same OID4VP flows.

- **`/operator/issue`** — pre-stage operator UI for issuing credentials into wwWallets. Two sections (bar credential / PID), each with a persona dropdown. Generates `https://demo.wwwallet.org/cb?credential_offer_uri=…` one-click links. Not user-accessible during the demo.

- **`/operator/capabilities`** — admin UI for the platform operator to manage EAS-issued capabilities. Authenticated against the platform-operator Ethereum address (anvil #0). The page is asymmetric per capability — the platform can't arbitrarily promote anyone to "verified lawyer," only revoke or attest after-the-fact:

  | Capability | Grant from this page? | Revoke from this page? | What v3 actually does | Production replacement for grant |
  |---|---|---|---|---|
  | `verified_client` | No (only via `/onboard` OID4VP flow) | Yes | Operator can revoke after manual review (e.g., abuse) | Direct PID-provider lookup |
  | `verified_lawyer` | No (only via "Become a verified lawyer" OID4VP flow) | Yes | Same as above | TIR lookup against bar's did:ebsi |
  | `verified_arbiter` | **Yes** (this is a genuine platform capability) | Yes | Operator picks an address that already holds `verified_lawyer`, clicks "Grant arbiter capability," writes EAS attestation | Same — stays platform-issued (or arbitration-institution-registry lookup, e.g. CEPANI) |

  The asymmetry matters: the platform operator can't fabricate a `verified_lawyer` attestation through this page even though they technically *could* by directly calling `EAS.attest`. The page's grant button is greyed out for those capabilities specifically, and the audit trail (every successful OID4VP presentation stores its `vp_token` + DCQL request) makes any out-of-band attestation forgery detectable: anyone can demand "show me the presentation that backed this attestation" and the platform must produce it. Single forgery, reputation destroyed.

  For the demo, this page is used during pre-show prep to grant Eva her `verified_arbiter` capability after her standard onboarding. Not user-accessible during the demo proper.

- **`/arbiter/dashboard`** — restricted page authenticated against the hardcoded arbiter address. Shows engagements with at least one `Disputed` milestone, plus an "Evidence inbox" listing message bundles the parties have submitted (each bundle is a JSON of `[{plaintext, sig, merklePath}]`; the page verifies on-load that each Merkle path resolves to the engagement's on-chain `transcriptRoot` and each signature checks against the relevant party's wallet — anything that doesn't verify is flagged red). The arbiter reviews, decides on a split, and clicks "Resolve" — the page calls `resolveDispute(engagementId, milestoneIndex, amountToLawyer, amountToClient)` via wagmi `useWriteContract`. Single-page, mostly server-rendered; no fancy UI needed.

- **Submit-evidence panel on `/engagement/[id]`** — visible to both parties on `Disputed` milestones. "Submit evidence to arbiter" button → opens a multiselect of decrypted messages from the engagement (decrypted client-side, of course) → operator picks which to include → frontend bundles `[{plaintext, sig, merklePath}]` for each selected message + the engagement's last on-chain `transcriptRoot` → POSTs to `/api/engagements/[id]/evidence` which forwards to the arbiter's inbox. The party doesn't have to include all messages; selective disclosure is allowed but bounded by the other party's right to fill in missing pieces.

**Side panel** (Iteration D from [round 6](08-zktls-and-iterations.md)) — the highest-leverage UX investment. ~half a day. Should look like a forensic audit:

- HTTP requests rendered as `→ POST https://...`/`← 200 OK` lines, monospaced
- Distinct keys/DIDs visible (issuer DID / two holder thumbprints / verifier RSA cert) so the audience can see they're not the same key
- ZK proof generation as a progress bar with live ms counter
- Each new chat message: ciphertext byte count + signature prefix
- Each milestone event: tx hash + new transcript root
- Anvil tx receipts with block, gas, tx hash, attestation UID

## Authentication

**SIWE (Sign-In with Ethereum)** at the top of every visit. RFC-4361.

**`GET /api/auth/nonce`** → returns a 16-byte hex nonce, stored in session.

**Frontend** constructs a SIWE message:

```text
lex-nova.local wants you to sign in with your Ethereum account:
0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266

I accept the Lex Nova Terms of Service.

URI: http://lex-nova.local
Version: 1
Chain ID: 31337
Nonce: a1b2c3d4e5f60718
Issued At: 2026-05-05T13:30:00Z
```

User signs via MetaMask. Frontend POSTs `{ message, signature }` to **`POST /api/auth/login`**.

**Backend:**

1. Verify signature recovers to the claimed address.
2. Verify nonce hasn't been used.
3. Look up address in profiles table.
4. Return one of:
   - `{ status: "logged_in", profile: { capabilities: [...] } }` → frontend redirects to `/dashboard`
   - `{ status: "needs_onboarding", roleHint: "lawyer" | "client" }` → frontend stays on the `/lawyer/onboard` or `/client/onboard` page, shows the "Verify yourself" CTA
5. Set a session cookie either way.

**Profile model** — multi-capability:

```ts
type Profile = {
  ethAddress: string;                    // primary key — the SIWE address links the two thumbprints
  capabilities: ("verified_lawyer" | "verified_client")[];
  // Per-credential holder thumbprints. These DIFFER between bar cred and PID
  // because OID4VCI batch issuance gives each credential its own holder
  // keypair (cross-verifier unlinkability). The Ethereum address is the
  // platform-layer identity that ties them together.
  barHolderThumbprint: string | null;    // RFC-7638 thumbprint of cnf.jwk from the bar credential
  pidHolderThumbprint: string | null;    // RFC-7638 thumbprint of cnf.jwk from the PID
  lawyerAttestationUid: string | null;
  clientAttestationUid: string | null;
  // Lawyer-side fields (set if verified_lawyer; from the bar credential)
  given_name?: string;
  family_name?: string;
  jurisdiction?: string;
  bar_admission_date?: string;
  // Client-side fields (set if verified_client; from the PID's selectively-disclosed claims)
  nationalities?: string[];
  address_country?: string;
  age_over_18?: boolean;
};
```

A single Ethereum address can hold both capabilities. The dashboard UI shows a context switcher when both are present.

## Build environment

- Node 20+
- Foundry (latest, installed via `foundryup`)
- Noir 1.0.0-beta.20+ (installed via `noirup`)
- Docker — only if you opt into the optional did:web fallback for the bar's DID
- Anvil bundled with Foundry
- No EUDI Docker — hosted services
- No phone wallet — wwWallet PWA in browser
- **`npm install --legacy-peer-deps`** in the platform's `package.json` — `@aztec/bb.js` peer-conflicts with `@rainbow-me/rainbowkit`'s wagmi peer pin in npm's strict mode. The conflict is over a transitive that doesn't break runtime. Round-8 verified.

## Day-1 reachability checklist

Round 7 confirmed the chain stack and library compile-checks; **the round-9 wallet-integration spike validated the entire OID4VCI/OID4VP path against real wwWallet end-to-end**. Nothing on this list is open at v3 time.

- [x] `https://demo.wwwallet.org` loads (round 7, still good)
- [x] `@sd-jwt/sd-jwt-vc` issues + verifies SD-JWT VCs with did:key (round 9 self-test)
- [x] wwWallet's OID4VCI consume path accepts our format (round-9 spike, real wwWallet, both bar credential and PID)
- [x] wwWallet accepts did:key issuer with our custom `vct` (validated against live wwWallet)
- [x] OID4VP DCQL flow with x509_san_dns request_object signing (validated; both bar and PID present cleanly)
- [x] Batch issuance with 5 instances per credential (validated; wwWallet sends `proofs.jwt[]` with 5 entries)
- [x] EAS contracts compile + deploy on anvil with optimizer enabled (round 7)
- [x] Noir circuit `conflict_check` compiles to ACIR (round 7)
- [ ] *Not validated yet:* SIWE address linking the two thumbprints into one platform profile (Phase 1 day-1 work)
- [ ] *Not validated yet:* EAS attestation write under the verifier's signing key after a successful presentation (Phase 1 day-2 work)

## Day-by-day plan

### Day 1 — chain + scaffold + spike port (~half day each)

- Initialize the repo: single Next.js 14 App Router project at the root, Foundry under `contracts/`, Noir under `circuits/`. No standalone services directory — issuer and verifier go inline.
- Anvil + Foundry: write **milestone-based** `LegalEngagementEscrow.sol` (more contract surface than v2's single-amount version — see §5), write tests, `Deploy.s.sol` registering all three EAS schemas (lawyer, client, engagement). Deploy works on anvil; `make demo-reset` working.
- **Port the spike inline.** The wallet path is already validated by the round-9 spike — copy `spike/wallet-integration/issuer.mjs` and `verifier.mjs` into Next.js Route Handlers under `app/api/issuer/*` and `app/api/verifier/*`. The Express → Next.js port is mechanical; logic unchanged.
- Wire up `better-sqlite3` for: profiles, matters, OID4VCI offer/token state (with TTL), OID4VP request_object state (with TTL), presentation results, EAS UIDs, message ciphertexts.
- Add disk-persistence helpers for the issuer's did:key and verifier's x.509 cert (read on boot, generate-and-write if absent).
- Smoke-test against wwWallet via ngrok before moving on.

### Day 2 — eager auth + onboarding + dashboard (~1 day)

- SIWE: `/api/auth/nonce`, `/api/auth/login`, session cookie. `siwe` npm package + wagmi `useSignMessage`.
- `/` (landing) page: hero + Connect Wallet button. Click triggers SIWE; backend looks up the address; redirects to `/dashboard` (recognized) or `/onboard` (not recognized).
- `/onboard` page: PID OID4VP via DCQL for the five disclosed claims → EAS client attestation under the SIWE address → profile persisted with `[verified_client]` → `/dashboard`.
- `/dashboard` page: matter form, "Become a verified lawyer →" affordance, active-engagements list. Lawyer-side sections (Inbox, posted-rate-card editor) appear conditionally if `verified_lawyer` capability is present.
- "Become a verified lawyer" wired: triggers a bar-credential OID4VP, writes the EAS lawyer attestation under the same SIWE address, profile gains `verified_lawyer`. Idempotent — same address, additive capabilities.
- Anna pre-staged off-stage: same flow as Marta will use on stage, plus the "Become a verified lawyer" click.

### Day 3 — matter + find-lawyer + ZK + milestone contract (~1 day)

- Matter form on `/dashboard`: writes `matters` row, redirects to `/find-lawyer`.
- `/find-lawyer` page: query lawyers from `profiles` table where `verified_lawyer` capability is set, filter by jurisdiction, render attestation-only profile cards.
- Noir circuit compiled to ACIR; browser proof generation; prewarming on `/find-lawyer` page load.
- `/api/engagements/preflight` and `/api/engagements/verify-zk` endpoints.
- **Milestone contract** with **asymmetric dispute logic + arbiter resolution** (per §5):
  - `createEngagement` (with milestone 0 in Proposed)
  - `proposeMilestone`, `acceptAndFundMilestone`, `markDelivered`, `releaseMilestone`
  - `disputeMilestone` (client-only, no cooldown)
  - `escalateMilestone` (lawyer-only, requires `block.timestamp >= deliveredAt + LAWYER_DISPUTE_COOLDOWN`)
  - `resolveDispute` (arbiter-only, splits parked funds 85/15-aware between lawyer/client/treasury)
  - `LAWYER_DISPUTE_COOLDOWN` and `ARBITER` immutable constructor params (30s + hardcoded address for demo, 30 days + multi-sig for prod).
  - Foundry tests cover happy path + both dispute paths + arbiter resolution + cooldown-revert + auth checks.
- `/engagement/new` page: matter + lawyer + ZK gate → `createEngagement(...)`.
- `/engagement/[id]` page: matter at top, milestone panel at bottom with role-appropriate buttons.

### Day 4 — E2EE messaging + Tier 3 dispute beats + side panel polish + rehearsal (~1 day)

- **E2EE messaging stub** (per §4b):
  - Per-engagement session key derived client-side from ECDH between the two parties' PID-side `cnf.jwk`s.
  - Chat panel on `/engagement/[id]`: composer, message log, AES-GCM encryption, signature with the wallet holder key, POST ciphertext to `/api/engagements/[id]/messages`.
  - Per-message Merkle hash; running root computed client-side; included as a parameter on every milestone release tx; contract updates `engagement.transcriptRoot`.
- **Tier 3 demo beats**:
  - Client-dispute path: wire `disputeMilestone` button visible to the client on any `Funded` or `Delivered` milestone. Click → MetaMask → milestone in `Disputed`; render the state change in the side panel.
  - Lawyer-escalate path: wire `escalateMilestone` button visible to the lawyer on `Delivered` milestones; show a live countdown when the cooldown is still elapsing. Demonstrate the cooldown enforcement on stage:
    1. Lawyer clicks Escalate too early → MetaMask submits → contract reverts → side panel shows the revert reason with `requiredAt` vs `now` deltas.
    2. Operator runs `cast rpc evm_increaseTime 30 && cast rpc evm_mine` (one terminal command).
    3. Lawyer clicks Escalate again → success → milestone transitions to `Disputed`.
  - **Arbiter resolution beat**: wire `/arbiter/dashboard` and the "Submit evidence to arbiter" button on `/engagement/[id]`. On stage:
    1. After the dispute fires, switch to the client (or lawyer) view, click "Submit evidence" → select a few decrypted messages → submit. Side panel shows the bundle delivered to the arbiter's inbox with Merkle paths verified.
    2. Switch to `/arbiter/dashboard` (logged in as the hardcoded arbiter address). Open the disputed engagement; review submitted evidence; pick a split; click Resolve.
    3. Side panel shows `resolveDispute(...)` running on chain; splits land; milestone transitions `Disputed → Resolved`; balances update.
  - Closing slide framing: "the arbiter has escrow authority only — they can't decrypt anything, only the parties can. They split the parked funds based on what the parties choose to show them. Identity unsealing for fraud/regulator cases is a separate Tier 3.5 production mechanism, not built here."
- Five timed rehearsals; cut what drags. Marta-as-protagonist demo flow.
- wwWallet pre-stage procedure documented on a sticky note for the demo morning.
- Backup video recorded.
- Architecture slide finalized; "verified pseudonymous engagement" closing slide; Tier 3 escalation slide.

## Honest framings to rehearse

**"Is the lawyer's credential issuer a real bar association?"**
> No — it's a stand-in we built. The credential was signed by a separate keypair representing a bar association; that keypair is generated in our seed script and never lives in the platform's running code. The platform's verifier checks the JWT's signature against the bar's public key embedded in the credential, not against any platform-controlled key. Same code path as a production verifier checking against a bar registered in EBSI's Trusted Issuers Registry.

**"Where does the credential live? Could you just be making it up?"**
> The credential is in wwWallet — a real EUDI-spec PWA wallet running at demo.wwwallet.org. Different origin, different storage, different cryptographic principal from our platform. Open it for yourself: *[opens 2nd tab, shows the credential listed in wwWallet's UI]*.

**"Why does the trace say accreditation chain not validated?"**
> Because the issuer is `did:key`, not a registered Trusted Issuer in EBSI's TIR. In production, the issuer is the bar association and that flag flips automatically — same line of code, different issuer DID. EBSI's documentation names `did:key` as the appropriate issuer DID method when TIR integration isn't required, like during development. We surface this in the trace explicitly rather than hiding it behind a flag.

**"Why is the lawyer also a verified client?"**
> A practicing lawyer is a citizen first. Their EUDI Wallet has a PID like everyone else's. We accept any combination of credentials a user presents — a lawyer can hire other lawyers, a client can offer services if they get a credential later. Profile capabilities are additive.

**"Why does the wallet show two different holder identifiers for the same lawyer?"**
> Cross-verifier unlinkability is a deliberate OID4VCI feature. When a credential is issued, the wallet generates a separate keypair for each instance — and a separate keypair *again* for each different credential type — so a verifier of the bar credential and a verifier of the PID can't link them as the same person. The link only exists at the platform layer, where we tie both presentations to the user's Ethereum address via SIWE. Privacy by design.

**"Why is the PID issued by you instead of an actual member-state provider?"**
> Two reasons. Operationally: eudiw.dev's hosted PID issuer is incompatible with wwWallet (their auth server's `iss` value mismatches the credential_issuer URL by an `/oidc` suffix; wwWallet enforces RFC 9207 strictly and rejects). We documented this and worked around it. Semantically: same answer as for the bar credential — production has each member-state's eIDAS-notified provider, validated via TIR; we collapse to one stand-in for the demo. The credential payload is in EUDI ARF `urn:eudi:pid:1` shape, protocol-indistinguishable from the real thing.

**"You're storing chat messages on your server. Why should I trust you not to read them?"**
> You shouldn't. We built the system so we *cryptographically cannot*, not so we *promise we won't*. Each engagement has a session key derived client-side from a Diffie-Hellman between the client's and lawyer's wallet holder keys. Messages are encrypted with that session key in the browser before they ever touch our server. We store ciphertext blobs and message signatures; we don't have the decryption key, and we never will, because the inputs to the key derivation live only in the parties' wallets. If we were subpoenaed for message content tomorrow, we'd hand over an unreadable blob. That's the foundation attorney-client privilege requires — not a contractual promise but a cryptographic impossibility.

**"What stops me from claiming a different message was sent than what actually was?"**
> Every message is signed by the sender's wallet holder key — non-repudiation primitive. And every message hash gets folded into a per-engagement Merkle transcript whose root is committed on chain at every milestone fund/release event. After milestone N is released, the transcript root for everything up to that point is locked. Neither party can plant a new message into the past, and either party can prove "this exact message was part of the conversation at this time" by revealing the message + its Merkle path. An arbitrator gets a tamper-evident, signature-authenticated record without ever seeing plaintext until parties choose to disclose.

**"Why milestone-based billing instead of a single quote?"**
> Real legal work doesn't price as one number upfront. The first milestone is the consultation — small, posted-rate, lets the lawyer see the matter and scope it. After that, the lawyer proposes follow-on milestones with concrete amounts; the client accepts each by funding it, releases each by approving the deliverable. If the client disputes a milestone, only that milestone is locked — prior released work is still released, future milestones can still be proposed if the parties resolve. Matches how real engagements bill. And it gives Tier 3 escalation a clean unit of dispute: not "the engagement," but "milestone 2 of this engagement."

**"What does Tier 3 actually look like?"**
> The contract has a `Disputed` status with two working transitions — `disputeMilestone` (client-only, immediate) and `escalateMilestone` (lawyer-only, gated by a 30-day cooldown post-delivery). Either path locks the funded amount; no releases allowed for that milestone until the arbiter resolves it. The arbiter is an authorized address (multi-sig in production, single address in the demo) with **escrow authority only** — they call `resolveDispute(engagementId, milestoneIndex, amountToLawyer, amountToClient)` to split the parked funds. They have no decryption keys, no path to unsealing identity. **The privilege boundary stays absolute even during arbitration** — only the parties themselves can decrypt their messages; if they want the arbiter to see something, they voluntarily reveal it + a Merkle path proving it was part of the on-chain transcript. Non-cooperation = default loss by arbiter discretion. Same model as civil arbitration: the judge doesn't go through your filing cabinet, you bring the evidence.

**"What about identity unsealing for fraud or regulator escalation?"**
> Out of scope for the hackathon. The arbiter cannot unseal client identity in v3 — there's no mechanism for it, on purpose, because the threshold-cryptography needed to do it properly was non-trivial and we wanted to keep the cryptographic surface lean. In production, a separate Tier 3.5 mechanism handles fraud/regulator/AML escalation: at onboarding the client's full PID payload would be encrypted under threshold ECIES to an arbitration-board public key (held distributively via DKG, no single arbiter can decrypt alone), and a court order or regulatory subpoena would gate the threshold decryption. That's a separate engineering effort from the arbiter's escrow authority and intentionally not in v3. One closing-slide line.

**"Why are dispute rights asymmetric — why can the client dispute immediately but the lawyer has to wait 30 days?"**
> Because dispute itself is costly even when the arbiter has no decryption keys. Being on the receiving end of a complaint means evidence preparation, attention overhead, reputational tax. Without the lawyer-side cooldown, "pay me or I drag you into arbitration tomorrow" still works as a coercion lever even though the arbiter can't see anything you don't choose to show them. The 30-day post-delivery wait makes that lever cost the lawyer 30 days of patience, which separates "I have a real grievance worth waiting on" from "I'm using arbitration as a payment-extraction tool." The client's dispute path has no analogous coercion concern — the client disputing locks their own funded amount, which is a self-imposed cost, not a leverage vector against the lawyer.

**"Why authenticate at the landing page instead of after the user posts a matter?"**
> Two reasons. First, the matter is an authenticated action — when the client posts a matter, the platform stamps it to their Ethereum address as a draft, then later as part of the engagement attestation. Doing this anonymously would require us to track an unauthenticated matter through a funnel and tie it to an identity later, which is more code and more abuse surface (anyone could post matters from anywhere with no rate limit). Second, in Web3 products users expect Connect Wallet up front; deferring it past the landing feels off. Third — and most importantly for the demo — the credential ceremony is the most novel thing we built. The audience should see it at 0:30, not at 1:30. Connect-Wallet-first matches Web3 convention AND lands the credential story early.

**"What if EUDI Wallet adoption is slow?"**
> It is — uneven through 2026 and 2027. Our verifier accepts any conformant SD-JWT VC PID. Plus zkTLS as a future bridge for jurisdictions without wallets yet. We're built for the rollout curve, not the deadline.

**"Aren't you taking a fee on legal services? That's restricted in most member states."**
> We're a payment-rails provider on the same legal basis as Stripe. We charge on transaction volume, not on legal fees. The lawyer sets the price and receives the gross amount minus a payment-processing fee. Clean separation from BRAO and equivalent statutes.

**"Why blockchain at all?"**
> Two reasons. Mechanical funds-flow guarantee — the lawyer cannot disappear with money, the platform cannot withhold release. And cryptographic record of verification at engagement time, re-checkable later without trusting us as the platform.

**"What stops a lawyer from issuing fake VCs?"**
> The library walks the accreditation chain. A self-issued VC with no TIR-registered issuer fails verification with `validateAccreditation: true`. In production this flag is on. For our hackathon demo we use `did:key` because we're standing in for the bar association ourselves.

**"How does the conflict check actually work without revealing identities?"**
> The lawyer publishes hashes of their prior-client identifiers, mixed with a fresh per-engagement salt. The client computes their own hash with the same salt. The client generates a zero-knowledge proof that their hash is not among the published list — without revealing their identity, and without seeing the lawyer's plaintext list. The verifier returns yes-or-no in milliseconds. Three-way blindness, mathematical truth. Eight commitments today for demo speed; production scales to a Merkle tree of thousands.

**"What about disputes?"**
> The escrow contract has a `Disputed` status. Hackathon scope skips the dispute logic. Production: a multi-sig of accredited arbitrators, themselves carrying EBSI-anchored credentials, with on-chain rulings. Kleros as a fallback option.

## Repo layout

```
/
├── src/                          # Next.js 14, ONE app for FE + API + issuer + verifier
│   ├── app/
│   │   ├── page.tsx              # landing — matter form (Marta enters here)
│   │   ├── find-lawyer/page.tsx  # browse verified lawyers, attestation-only cards
│   │   ├── engagement/new/       # quote-and-engage flow → SIWE + OID4VP
│   │   ├── engagement/[id]/      # live engagement: matter, chat, milestone panel
│   │   ├── lawyer/onboard/       # off-stage pre-stage; SIWE + bar+PID OID4VP
│   │   ├── lawyer/dashboard/     # Anna's inbox + active engagements
│   │   ├── client/onboard/       # lazy: hit when engaging if not already verified
│   │   ├── dashboard/            # post-engagement view (both roles)
│   │   ├── operator/issue/       # persona-dropdown UI for pre-staging credentials
│   │   ├── arbiter/dashboard/    # disputed-engagement list + resolveDispute UI
│   │   └── api/
│   │       ├── auth/{nonce,login}/route.ts
│   │       ├── onboarding/{lawyer,client}/route.ts
│   │       ├── engagements/{preflight,verify-zk,[id]}/route.ts
│   │       ├── trace/[sessionId]/route.ts                                        # SSE
│   │       ├── issuer/                                                           # OID4VCI
│   │       │   ├── .well-known/openid-credential-issuer/route.ts
│   │       │   ├── .well-known/oauth-authorization-server/route.ts
│   │       │   ├── offer/route.ts
│   │       │   ├── credential-offer/[id]/route.ts
│   │       │   ├── token/route.ts
│   │       │   └── credential/route.ts
│   │       ├── verifier/                                                         # OID4VP
│   │       │   ├── presentation/request/route.ts
│   │       │   ├── request-object/[id]/route.ts
│   │       │   ├── presentation/callback/route.ts
│   │       │   └── presentation/result/[id]/route.ts
│   │       ├── matters/                                                          # matter posting
│   │       │   └── route.ts                                                      # POST landing-page form
│   │       └── engagements/
│   │           ├── [id]/messages/route.ts                                        # E2EE chat (GET/POST)
│   │           ├── [id]/messages/transcript-root/route.ts                        # Merkle root
│   │           ├── [id]/evidence/route.ts                                        # arbiter evidence inbox (POST)
│   │           └── [id]/route.ts                                                 # engagement metadata
│   ├── components/
│   │   ├── SidePanel.tsx
│   │   ├── ConnectButton.tsx
│   │   ├── TxReceipt.tsx
│   │   ├── LawyerProfileCard.tsx     # attestation-only profile card
│   │   ├── MatterForm.tsx            # landing page matter+jurisdiction
│   │   ├── MilestonePanel.tsx        # propose/fund/release/dispute UI
│   │   ├── EvidencePanel.tsx         # "Submit evidence to arbiter" multiselect
│   │   ├── ArbiterEvidenceList.tsx   # Merkle-verified inbox display
│   │   └── ChatPanel.tsx             # E2EE messaging UI per engagement
│   └── lib/
│       ├── sdjwt.ts              # SDJwtVcInstance setup (lifted from spike)
│       ├── personas.ts           # PERSONAS map (single source of truth)
│       ├── issuer-keys.ts        # disk-persisted did:key (.lex-nova-keys/issuer.jwk)
│       ├── verifier-cert.ts      # disk-persisted RSA cert (.lex-nova-keys/verifier.{key,crt})
│       ├── db.ts                 # better-sqlite3 client + migrations
│       ├── eas.ts                # viem-based EAS attest call
│       ├── siwe.ts               # SIWE message construction + verification
│       ├── zk.ts                 # noir_js verifier
│       ├── messaging.ts          # ECDH session keys + AES-GCM + per-msg sigs
│       └── transcript.ts         # Merkle tree over message hashes; root computation
├── .lex-nova-keys/               # gitignored; persistent issuer + verifier keys
├── data/
│   └── lex-nova.sqlite           # better-sqlite3 file
├── spike/                        # round-9 wallet-integration spike — keep as living
│   └── wallet-integration/        # reference impl + diagnostic logging
├── contracts/                    # Foundry — separate process, talks via viem
│   ├── src/LegalEngagementEscrow.sol
│   ├── lib/                      # forge install: eas-contracts, openzeppelin, forge-std
│   ├── script/Deploy.s.sol
│   ├── test/
│   ├── foundry.toml
│   └── remappings.txt
├── circuits/
│   └── conflict_check/
│       ├── src/main.nr
│       ├── Nargo.toml
│       └── target/conflict_check.json   # generated by `nargo compile`
├── scripts/
│   ├── demo-reset.sh             # kill anvil, replay deploy
│   └── prewarm-state.sh          # generate anvil-state.json
├── deployments/
│   └── anvil.json                # written by Deploy.s.sol, read by platform
├── infrastructure/
│   └── anvil-state.json          # pre-warmed state for stage
└── docs/
    └── (this directory)
```

## What's no longer in scope

- ❌ Self-onboarding as TI in EBSI conformance ([round 2 Path A](04-research-findings.md)) — too slow
- ❌ EUDI ARF SD-JWT pivot for lawyer ([round 3 Path E](05-deeper-research.md)) — Path F is simpler
- ❌ Forking eudi-web-recruitment-service-demo ([round 5](07-ecosystem-finds.md)) — too heavy
- ❌ Local Docker EUDI verifier ([round 5](07-ecosystem-finds.md)) — hosted services work
- ❌ Reclaim Protocol live in demo ([round 6](08-zktls-and-iterations.md)) — integration risk; one-slide future story instead
- ❌ Base Sepolia ([round 2](04-research-findings.md)) — anvil instead
- ❌ Full XMTP integration (the demo uses an encrypted-localStorage stub with the same crypto shape; production swaps in XMTP without changing on-chain semantics — see §4b for the full plan)
- ❌ ERC-5564 stealth addresses — production-trajectory item; per-engagement client unlinkability already covered in the audience-facing story by OID4VCI batch unlinkability + SIWE-binds-thumbprints
- ❌ BBS+ — SD-JWT VC handles selective disclosure for our scope; BBS+ is overkill
- ❌ **Tier 1 (anonymous public legal information)** — separate product surface, not load-bearing for the cryptographic story; would dilute the demo
- ❌ **Tier 3 multi-sig arbitration committee** — v3 has a single hardcoded arbiter address with `resolveDispute` authority; the multi-sig of accredited arbitrators is a production-trajectory item.
- ❌ **Identity unsealing under Tier 3** — explicitly not built. The arbiter has escrow authority only and cannot decrypt anything. Production adds a separate Tier 3.5 mechanism (threshold-encrypted PID blob held distributively across the arbitration board, court-order-gated decryption); slide-only here.
- ❌ **Threshold encryption / DKG / ECIES** — out of scope. Cryptographic surface kept lean intentionally.
- ❌ **QES via QTSP** — partner sandbox onboarding is a multi-week paperwork process; production adds Namirial/Universign/D-Trust signed PDFs alongside the on-chain transcript root
- ❌ Block explorer integration — render tx receipts in our side panel
- ❌ Phone wallet requirement — wwWallet in browser
- ❌ **Separate "bar" Next.js page** — the bar's OID4VCI endpoints live as Next.js Route Handlers under `app/api/issuer/*`, alongside the platform's own routes
- ❌ **Separate "verifier" page** — verifier's OID4VP endpoints live under `app/api/verifier/*`, same Next.js process
- ❌ **Standalone Express services for issuer/verifier** — earlier v3 draft had these in a `services/` directory; we collapsed to Next.js Route Handlers since they share state, lifecycle, and ngrok tunnel anyway
- ❌ **path-routing proxy** — was needed in the spike because two services shared one ngrok tunnel; not needed anymore (one Next.js app, one tunnel)
- ❌ **localStorage credential popup** — replaced with real wwWallet via OID4VCI/OID4VP
- ❌ **Pre-staged EAS attestations** — only credentials are pre-staged in wwWallet; attestations happen live on stage
- ❌ Postgres for hackathon — `better-sqlite3` is the right tool
- ❌ In-memory `Map` for issuer/verifier short-lived state — moved to SQLite with TTL so hot reload doesn't kill in-flight flows
- ❌ Pre-staging the lawyer's onboarding (prior round-4 idea) — both onboardings now live
- ❌ **eudiw.dev for PID issuance** — incompatible with wwWallet (RFC 9207 strict iss check); we issue our own stand-in PID instead
- ❌ **Tear-down-after-issue seed scripts** — issuer is a long-running Next.js app with disk-persisted keypair; same did:key across restarts as long as `.lex-nova-keys/` exists

## Failure modes and recovery

**`@sd-jwt/sd-jwt-vc` install fails on day 1** — fall back to `@sd-jwt/core` directly (one layer down) or `@hopae/sd-jwt-vc`. The signing/verification API is similar; the SDJwtVcInstance just wraps SDJwtInstance with vct/cnf validation.

**ngrok tunnel down on stage** — the issuer + verifier need a public URL for wwWallet to fetch. Backup: pre-pay for a ngrok reserved domain so the URL is stable across restarts. Cloudflared tunnel as a secondary backup (the spike originally used it; we switched to ngrok because the path-routing proxy + single tunnel pattern worked better, but cloudflared still works).

**wwWallet rejects did:key issuer** — switch the bar's DID method to **did:web**. Host `/.well-known/did.json` over the same ngrok URL. Same verifier code, different DID resolution. (Did not need this in the spike — did:key works against real wwWallet.)

**wwWallet's IndexedDB has stale cached metadata** — caused us pain repeatedly during the spike. Fix: DevTools → Application → IndexedDB → delete the entry under `proxyCache` matching our issuer URL. The issuer's `Cache-Control: no-store` prevents new caching but doesn't evict existing entries. Document this in the rehearsal checklist.

**ZK proof slow on stage** — pre-warm proving key on `/engagement/[id]` page load. If still slow, switch to architecture slide while it generates. Don't apologize.

**MetaMask popup glitches** — bring it up manually from the toolbar. If frozen, the page should retry the `useWriteContract` call once.

**Anvil dies mid-demo** — `make demo-reset` reloads from `anvil-state.json`. ~10 seconds. Continue from screen one. The seed credentials in wwWallet survive — only the chain state is regenerated.

**Forget a section** — slides are in order, just skip to the next.

## Sources

All sources are in [round docs 04–08](04-research-findings.md). Key links:

- [@sd-jwt/sd-jwt-vc](https://www.npmjs.com/package/@sd-jwt/sd-jwt-vc)
- [@cef-ebsi/key-did-resolver](https://www.npmjs.com/package/@cef-ebsi/key-did-resolver)
- [wwWallet frontend (validated against)](https://github.com/wwWallet/wallet-frontend)
- [wwWallet's wallet-common (zod schemas + OID4VP server logic)](https://github.com/wwWallet/wallet-common)
- [wwWallet demo](https://demo.wwwallet.org)
- [eas-contracts](https://github.com/ethereum-attestation-service/eas-contracts)
- [Noir docs](https://noir-lang.org/)
- [SIWE specification (EIP-4361)](https://eips.ethereum.org/EIPS/eip-4361)
- **Round-9 wallet-integration spike** at [`spike/wallet-integration/`](../spike/wallet-integration/) — port `issuer.mjs` and `verifier.mjs` into Next.js Route Handlers under `app/api/issuer/*` and `app/api/verifier/*`. The Express → Next.js port is mechanical; logic unchanged. The `proxy.mjs` and `start-all-ngrok.sh` from the spike aren't needed in the collapsed architecture (one Next.js app, one ngrok tunnel). Diagnostic logging is intentionally retained for future reference; carry it through to the platform's Route Handlers.
