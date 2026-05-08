# Spec v2 — Pan-EU Pseudonymous Legal Advice Platform

This is the consolidated build spec after six rounds of research ([04](04-research-findings.md), [05](05-deeper-research.md), [06](06-simpler-paths.md), [07](07-ecosystem-finds.md), [08](08-zktls-and-iterations.md)) and the design dialog that followed round-7 verification. Round-1 spec at [02-spec.md](02-spec.md) is preserved for the diff. **Build from this doc.** Demo script lives at [10-demo-v2.md](10-demo-v2.md). Plain-English walkthrough at [11-project-walkthrough.md](11-project-walkthrough.md).

## Three claims defensible on stage

1. **Lawyers cryptographically verified as real EU bar members** — `@sd-jwt/sd-jwt-vc` issues (off-stage, in a seed script standing in for a bar association) and verifies (live, on platform) a `LegalProfessionalAccreditation` SD-JWT VC. Format `vc+sd-jwt`, vct `urn:lex-nova:LegalProfessionalAccreditation`. Issuer is a `did:key` generated and discarded by the seed script (production: bar association as a Qualified Trust Service Provider issuing a (Q)EAA per eIDAS 2). Holder key binding via `cnf.jwk` extracted from the wallet's OID4VCI proof JWT. Selectively-disclosable claims: jurisdiction, specialty, admittedSince, barAdmissionNumber. Verified end-to-end with wwWallet's actual OID4VCI consume code path in round 9 (wwWallet only accepts SD-JWT VC and mDoc; W3C JWT VC is silently dropped).
2. **Clients pseudonymous to the lawyer, with conflict-of-interest checking** — real EUDI PID from `verifier.eudiw.dev` with selective disclosure (nationality, over_18, resident_country only), plus a Noir non-membership ZK proof at engagement-creation time over a hashed prior-client commitment set.
3. **Money flows through smart-contract escrow with milestone release** — `LegalEngagementEscrow.sol` on local anvil, gated by EAS attestations, milestone-based release with a 15% platform take rate, signed live with MetaMask.

If any of the three is mocked, the cryptographic story collapses. All three are real.

## Architecture, three subsystems

```
┌─ Lawyer credentialing ────────────────────────┐
│                                                │
│  Seed-time:                                    │
│    seed-lawyer.ts script generates a fresh    │
│    "bar" did:key, signs a LegalProfessional-   │
│    Accreditation SD-JWT VC, walks it into the  │
│    lawyer's wwWallet via OID4VCI, then         │
│    discards the bar's private key.             │
│                                                │
│  Live (platform):                              │
│    Verifier endpoint receives an OID4VP        │
│    presentation containing PID + Lawyer cred,  │
│    validates both, writes TWO EAS attestations │
│    (lawyer schema + client schema).            │
│                                                │
│  → Profile: [verified_lawyer, verified_client] │
└────────────────────────────────────────────────┘
                       │
                       ▼
┌─ Client onboarding ───────────────────────────┐
│                                                │
│  Seed-time:                                    │
│    seed-client.ts fetches a real PID from     │
│    issuer.eudiw.dev into the client's          │
│    wwWallet.                                   │
│                                                │
│  Live (platform):                              │
│    Verifier endpoint receives OID4VP with PID  │
│    only, selective disclosure of three claims, │
│    writes ONE EAS attestation (client schema). │
│                                                │
│  → Profile: [verified_client]                  │
└────────────────────────────────────────────────┘
                       │
                       ▼
┌─ Engagement layer ────────────────────────────┐
│                                                │
│  Live (platform + browser + chain):            │
│    Client picks lawyer.                        │
│    Browser generates Noir ZK proof of          │
│      non-membership in lawyer's prior-client   │
│      commitment set (~2.3s).                   │
│    Backend verifies proof.                     │
│    LegalEngagementEscrow contract on anvil:    │
│      createEngagement (lawyer signs, MetaMask) │
│      fundEngagement   (client signs, MetaMask) │
│      releaseEngagement (client signs, MetaMask)│
│    85/15 split released on chain.              │
└────────────────────────────────────────────────┘
```

Three keys in play: the bar's (seed-time only, discarded), the platform verifier's (used at attestation time), and each user's holder key (managed by their wwWallet).

## Tech stack

### Backend (single Next.js app)
- Node 20+, TypeScript, **Next.js 14+ App Router** — one app for both frontend and API routes
- **`@sd-jwt/sd-jwt-vc` + `@sd-jwt/core`** — primary. Issues and verifies SD-JWT VCs (`vc+sd-jwt` format) for both lawyer and client credentials. wwWallet's OID4VCI consume path requires SD-JWT VC or mDoc; W3C JWT VC is silently dropped (round-9 finding from reading wallet-frontend source). Verified end-to-end with did:key issuance in round-9 self-test.
- `@cef-ebsi/key-did-resolver` — exposes `util.createDid(jwk)` for generating did:key strings, and `getResolver()` for resolving them back to DID documents. wwWallet uses the same library, so did:key compatibility is mechanical.
- `jose` for keypair generation and JWT signing/verification helpers
- WebCrypto (`crypto.webcrypto.subtle` in Node, `window.crypto.subtle` in browsers) — used by the `SDJwtVcInstance`'s signer/verifier callbacks, since `@sd-jwt/sd-jwt-vc` is key-agnostic
- **`siwe`** — Sign-In with Ethereum library, ~3 lines to integrate
- **`@noir-lang/noir_js` + `@aztec/bb.js`** — noir_js handles ABI encoding + witness generation; bb.js (`UltraHonkBackend`) handles UltraHonk proof generation and verification. Both client (browser) and backend (Node verifier) need both packages. Round-8 verified: full proof gen + verify roundtrip works in Node — witness 51ms, proof ~1s, verify 128ms, proof size 16 KB
- `viem` for anvil RPC + EAS contract interaction
- In-memory `Map`s or SQLite for profiles/engagement state — *skip Postgres for hackathon* (round 7 simplification)
- SSE endpoint for live trace streaming

### Smart contracts
- Solidity 0.8.28 (matches `eas-contracts` v1.4.0 pragma), Foundry
- EAS contracts deployed from source — `eas-contracts` v1.4.0 from `ethereum-attestation-service/eas-contracts`
- **OpenZeppelin v5.2.0 specifically** — EAS v1.4.0 `package.json` pins this version; v5.0.x ABIs are off-by-enough that EAS deploy reverts
- **Optimizer required** in `foundry.toml` — without it, EAS bytecode exceeds the 24 KB EIP-170 contract-size limit and deployment reverts with `CreateContractSizeLimit`
- `LegalEngagementEscrow.sol` — our contract gating engagement on EAS attestations

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

### 1a. Seed-time issuer scripts (off-stage; "the bar" stand-in)

Two seed scripts populate the wwWallets before stage:

**`scripts/seed-lawyer.ts`:**

```ts
// 1. Generate the bar's keypair (used only in this script run)
const barKeypair = await generateKeyPair("ES256");
const barDid = util.createDid(await exportJWK(barKeypair.publicKey));

// 2. Spin up a temporary OID4VCI issuer endpoint
//    - GET  /.well-known/openid-credential-issuer  → metadata
//    - POST /credential-offer                       → offer URL
//    - POST /token, POST /credential                → standard OID4VCI
//    Hosts the bar's signing key in memory only.
const issuerServer = startTempOID4VCIIssuer({ barKeypair, barDid });

// 3. Generate a credential offer URL
const offerUrl = `openid-credential-offer://?credential_offer_uri=...`;

// 4. Print URL + QR. Operator opens it in wwWallet on the lawyer's laptop.
console.log(offerUrl);
console.log("Open in wwWallet at https://demo.wwwallet.org");

// 5. wwWallet does the OID4VCI dance with our temp issuer endpoint.
//    Sends a proof JWT containing its holder JWK + the c_nonce.
//    The bar's /credential endpoint extracts the holder JWK and embeds it
//    in the SD-JWT VC's `cnf.jwk` claim, then signs (ES256) with SDJwtVcInstance.
//    Returns format=vc+sd-jwt. Wallet stores it in IndexedDB scoped to
//    demo.wwwallet.org.

// 6. Tear down. Bar key discarded. Wallet retains the credential.
issuerServer.close();
```

**`scripts/seed-client.ts`:**

```ts
// Drive the lawyer's wwWallet through the EU's hosted PID issuer
// at issuer.eudiw.dev. Same OID4VCI dance, but the issuer is the EU
// reference issuer, not us. The PID lands in the lawyer's wwWallet
// alongside the LegalProfessionalAccreditation.
//
// For the client laptop: same script, different wwWallet, only the PID.
console.log("Open https://issuer.eudiw.dev in browser, follow the");
console.log("'Issue PID' flow, target wwWallet as the receiving wallet.");
```

The seed scripts are **the bar**, in a sense. The bar's only function is to issue credentials; it doesn't have a UI, doesn't have an API server, doesn't ship in the production app. Its DID and key live for ~10 seconds inside one shell invocation, then are gone forever. In production this role is played by the actual bar association.

### 1b. Platform verifier (live during onboarding)

Runs as Next.js API routes. Different DID, different keypair, different role from the seed-time issuer.

**`POST /api/auth/login`** — SIWE entry point. See §Authentication below.

**`POST /api/onboarding/lawyer`** — invoked when a SIWE'd user with no profile visits `/lawyer/onboard`:

1. Construct an **OID4VP request** with a `presentation_definition` requiring TWO `input_descriptors`, both `format: { "vc+sd-jwt": { alg: ["ES256"] } }`:
   - PID, filter on the issuer.eudiw.dev's vct, request selective disclosure of `nationality`, `over_18`, `resident_country`
   - LegalProfessionalAccreditation, filter on `vct = urn:lex-nova:LegalProfessionalAccreditation`
2. Return the request URI for wwWallet (deep link or QR).
3. Wait for wwWallet's `direct_post` callback containing the SD-JWT VP token (or two of them; OID4VP supports multiple presentations in one response).
4. For each presented SD-JWT VC:
   - Parse the JWT header, extract `kid`. For our bar credential the kid is a `did:key:...#fragment`; for the EU PID it's an x.509 cert reference.
   - Build a fresh `SDJwtVcInstance` with a verifier callback that resolves the issuer JWK appropriately (did:key via `@cef-ebsi/key-did-resolver`'s `getResolver`, x.509 via the cert chain).
   - Call `verify(sdJwtVc)`. Returns the verified payload with disclosed claims.
   - Validate `cnf.jwk` matches the holder DID expected for this session.
5. Write two EAS attestations to anvil under the verifier's signing key:
   - Lawyer schema: `(ethAddress, holderJwkThumbprint, jurisdiction, specialty, verifiedAt)`
   - Client schema: `(ethAddress, nationality, over18, residentCountry, verifiedAt)`
6. Persist profile: `{ ethAddress, capabilities: ["verified_lawyer", "verified_client"], holderJwkThumbprint, lawyerAttestationUid, clientAttestationUid }`
7. Stream trace events via SSE.

**`POST /api/onboarding/client`** — for users visiting `/client/onboard`:

Same flow, but the OID4VP request asks for **PID only** (one `input_descriptor`). One EAS attestation written under the client schema. Profile gains `verified_client` only.

The SD-JWT VC issuance + verification calls are exactly those exercised by [spike/wallet-integration/](../spike/wallet-integration/) — copy `lib/ebsi.ts` from the spike's `issuer.mjs` (signer/verifier callbacks) and `verifier.mjs` (the `makeVerifierForKid` pattern that resolves did:key into a verifier instance).

### 1c. wwWallet pre-staging procedure

Before each demo run, on each laptop:

1. Open the demo Chrome profile (must be a profile dedicated to the demo, so wwWallet's IndexedDB persists).
2. Navigate to `https://demo.wwwallet.org`.
3. Run `pnpm seed:lawyer` (on the lawyer laptop) or `pnpm seed:client` (on the client laptop).
4. Follow the printed offer URL in wwWallet. Approve the credential.
5. For the lawyer laptop, also follow the PID issuance flow against `issuer.eudiw.dev`.
6. Verify wwWallet's "Credentials" tab shows the expected credentials.

wwWallet's IndexedDB persists across browser sessions, so this seeding is one-time per laptop until the browser profile is cleared. Re-run if rehearsal corrupts state.

**Round-9 finding:** wwWallet's OID4VCI consume code only handles `vc+sd-jwt`, `dc+sd-jwt`, and `mso_mdoc` formats — `jwt_vc_json` is silently dropped. We use `vc+sd-jwt`. wwWallet uses `@cef-ebsi/key-did-resolver` (same library as us) so did:key resolution is mechanical. The remaining empirical test (live wwWallet consumption) is a Phase-2 day-1 step covered by the spike's manual procedure; the protocol layer has been confirmed compliant via simulated-wallet self-test.

**Optional fallback:** if wwWallet's UI rejects our credential at present-time for a reason we haven't anticipated, swap the bar's DID method to **did:web** (host `/.well-known/did.json` over HTTPS via Cloudflare Tunnel during dev). Functionally identical from the verifier's perspective.

### 2. Client PID — selective disclosure only, no ZK here

Round-1 spec ran the ZK conflict check during client onboarding. **Moved.** ZK now runs at engagement-creation time (component 4), where it conceptually belongs.

Client onboarding is therefore *just* PID verification — `@sd-jwt/sd-jwt-vc` parses the SD-JWT VC, validates the issuer's signature against `issuer.eudiw.dev`'s x.509 chain, extracts the disclosed claims, writes the EAS attestation. ~2 seconds end to end.

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
5. Browser computes `client_secret = pedersen_hash([hash(disclosed_nationality), hash(disclosed_resident_country), over_18 ? 1 : 0, did:key])` from the client's stored disclosed claims.
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
            "address lawyer, string ebsiDid, string jurisdiction, string specialty, uint64 verifiedAt",
            address(0), true
        );
        bytes32 clientSchemaUid = registry.register(
            "address client, string nationality, bool over18, string residentCountry, uint64 verifiedAt",
            address(0), true
        );

        LegalEngagementEscrow escrow = new LegalEngagementEscrow(
            address(eas), lawyerSchemaUid, clientSchemaUid, TREASURY
        );

        // Write addresses to deployments/anvil.json for the platform to read
        vm.stopBroadcast();
    }
}
```

`make demo-reset`: kill anvil, restart, replay the deploy. Under 10 seconds.

**Pre-warm** `state.json` before stage and start anvil with `--load-state state.json`. Two-second cold start, all addresses ready, but **no profiles or attestations yet** — those are created live during the demo.

### 5. LegalEngagementEscrow contract

Unchanged from round-1 spec. Reproduced from [02-spec.md §1.4](02-spec.md):

- States: `Created`, `Funded`, `Released`, `Disputed`
- `createEngagement(lawyer, client, amount, lawyerAttestationUid, clientAttestationUid)` — verifies both EAS attestations exist, are not revoked, and target the right addresses
- `fundEngagement(id)` payable, only client, advances `Created → Funded`
- `releaseEngagement(id)` only client, advances `Funded → Released`, transfers `(amount * 8500/10000)` to lawyer and `(amount * 1500/10000)` to platform treasury
- 15% take rate is `TAKE_RATE_BPS = 1500`

Foundry tests: 100% branch coverage on the four state transitions. ~2 hours.

### 6. Frontend pages

Three pages:

- **`/lawyer/onboard`** — connect MetaMask → SIWE → backend says "no profile" → "Verify yourself" button → opens wwWallet via OID4VP request for PID + LegalProfessionalAccreditation → wwWallet popup → user approves → trace panel streams verification → two EAS attestations land → redirect to `/dashboard` with both capabilities active.

- **`/client/onboard`** — connect MetaMask → SIWE → "no profile" → "Verify yourself" button → opens wwWallet via OID4VP for PID only → wwWallet popup with selective disclosure → user approves → one EAS attestation → redirect to `/dashboard` with `verified_client` capability.

- **`/engagement/[id]`** — connect MetaMask → SIWE → load engagement → if status is `pending_zk`: prewarmed Noir circuit generates proof in browser → backend verifies → "Create Engagement" enabled → MetaMask popup for createEngagement → "Fund" enabled → MetaMask popup for fundEngagement → lawyer marks done off-chain (just a button) → "Release" enabled → MetaMask popup for releaseEngagement → split visible.

**Side panel** (Iteration D from [round 6](08-zktls-and-iterations.md)) — the highest-leverage UX investment. Half a day. Should look like a forensic audit:
- HTTP requests rendered as `→ POST https://...`/`← 200 OK` lines, monospaced
- Three DID labels visible (issuer / holder / verifier) so the audience can see they're distinct
- ZK proof generation as a progress bar with live ms counter
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
  ethAddress: string;
  capabilities: ("verified_lawyer" | "verified_client")[];
  didKey: string | null;                  // wallet's holder DID (set on first onboarding)
  lawyerAttestationUid: string | null;
  clientAttestationUid: string | null;
  // Lawyer-side fields (set if verified_lawyer)
  jurisdiction?: string;
  specialty?: string;
  admittedSince?: string;
  // Client-side fields (set if verified_client)
  nationality?: string;
  residentCountry?: string;
  over18?: boolean;
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

Run on day 1 before committing to the stack. Round 7 confirmed everything except wwWallet did:key acceptance:

- [x] `curl -I https://verifier.eudiw.dev` returns 2xx (round 7)
- [x] `curl -I https://issuer.eudiw.dev` returns 2xx (round 7)
- [x] `https://demo.wwwallet.org` loads (round 7)
- [x] `@sd-jwt/sd-jwt-vc` issues + verifies SD-JWT VCs with did:key (round 9)
- [x] wwWallet's OID4VCI consume path accepts our format (round 9, source review)
- [x] EAS contracts compile + deploy on anvil with optimizer enabled (round 7)
- [x] Noir circuit `conflict_check` compiles to ACIR (round 7)
- [ ] **Open question:** wwWallet accepts did:key issuer with custom credential type — test on day 1
  - If yes → ship Path F as specced
  - If no → fall back to **did:web for the bar's DID**, host `/.well-known/did.json` via Cloudflare Tunnel; same code, different DID method

## Day-by-day plan

### Day 1 — chain stack + reachability + skeleton (~half day each)

- Run round-7 reachability checks one more time on the actual demo network/laptop
- Initialize the monorepo (single Next.js app + Foundry + Noir)
- Foundry: write `LegalEngagementEscrow.sol`, write tests, `Deploy.s.sol`
- Deploy works on anvil; `make demo-reset` working
- **Day-1 decision: test wwWallet did:key acceptance.** Build a tiny standalone OID4VCI issuer in `scripts/seed-lawyer.ts` and try issuing a credential into wwWallet. Confirms the wallet path or triggers the did:web fallback.

### Day 2 — auth + lawyer onboarding live (~1 day)

- SIWE: `/api/auth/nonce`, `/api/auth/login`, session cookie
- `siwe` npm package + wagmi `useSignMessage`
- `/lawyer/onboard` page: connect → SIWE → not-found → "Verify yourself"
- OID4VP request for PID + LegalProfessionalAccreditation (two `input_descriptors`)
- Verifier endpoint validates both, writes two EAS attestations
- SSE stream of trace events
- End-to-end: lawyer wallet (wwWallet) → present → verified → both attestations on chain → dashboard with both capabilities

### Day 3 — client onboarding + ZK at engagement (~1 day)

- `/client/onboard` page: SIWE → not-found → "Verify yourself" → OID4VP for PID only
- `@sd-jwt/sd-jwt-vc` parsing, EAS attestation written
- Noir circuit compiled to ACIR
- `@noir-lang/noir_js` browser proof generation, prewarming on engagement page load
- `/api/engagements/preflight` and `/api/engagements/verify-zk` endpoints
- `/engagement/[id]` page: ZK gate → MetaMask wired to escrow contract
- Side panel polish — half day; this is the credibility multiplier

### Day 4 — engagement flow + integration + rehearsal (~half day)

- Three MetaMask popups: createEngagement, fundEngagement, releaseEngagement
- Render anvil tx receipts (no block explorer)
- Five timed rehearsals; cut what drags
- Decide: wwWallet pre-stage procedure documented on a sticky note for the demo morning
- Backup video recorded
- Architecture slide finalized
- "Verification dual-stack" closing slide

## Honest framings to rehearse

**"Is the lawyer's credential issuer a real bar association?"**
> No — it's a stand-in we built. The credential was signed by a separate keypair representing a bar association; that keypair is generated in our seed script and never lives in the platform's running code. The platform's verifier checks the JWT's signature against the bar's public key embedded in the credential, not against any platform-controlled key. Same code path as a production verifier checking against a bar registered in EBSI's Trusted Issuers Registry.

**"Where does the credential live? Could you just be making it up?"**
> The credential is in wwWallet — a real EUDI-spec PWA wallet running at demo.wwwallet.org. Different origin, different storage, different cryptographic principal from our platform. Open it for yourself: *[opens 2nd tab, shows the credential listed in wwWallet's UI]*.

**"Why does the trace say accreditation chain not validated?"**
> Because the issuer is `did:key`, not a registered Trusted Issuer in EBSI's TIR. In production, the issuer is the bar association and that flag flips automatically — same line of code, different issuer DID. EBSI's documentation names `did:key` as the appropriate issuer DID method when TIR integration isn't required, like during development. We surface this in the trace explicitly rather than hiding it behind a flag.

**"Why is the lawyer also a verified client?"**
> A practicing lawyer is a citizen first. Their EUDI Wallet has a PID like everyone else's. We accept any combination of credentials a user presents — a lawyer can hire other lawyers, a client can offer services if they get a credential later. Profile capabilities are additive.

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
├── apps/
│   └── platform/                 # Next.js 14, single app for FE + API
│       └── src/
│           ├── app/
│           │   ├── lawyer/onboard/
│           │   ├── client/onboard/
│           │   ├── engagement/[id]/
│           │   ├── dashboard/
│           │   └── api/
│           │       ├── auth/{nonce,login}/route.ts
│           │       ├── onboarding/{lawyer,client}/route.ts
│           │       ├── engagements/{preflight,verify-zk,[id]}/route.ts
│           │       └── trace/[sessionId]/route.ts    # SSE
│           ├── components/
│           │   ├── SidePanel.tsx
│           │   ├── ConnectButton.tsx
│           │   └── TxReceipt.tsx
│           └── lib/
│               ├── sdjwt.ts       # SDJwtVcInstance signer + verifier callbacks
│               ├── didkey.ts      # did:key creation + resolution helpers
│               ├── eudi.ts        # verifier.eudiw.dev OID4VP integration
│               ├── eas.ts         # viem-based EAS attest call
│               ├── siwe.ts        # SIWE message construction + verification
│               ├── zk.ts          # noir_js verifier
│               └── store.ts       # in-memory profiles
├── contracts/                    # Foundry
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
│   ├── seed-lawyer.ts            # bar-stand-in OID4VCI issuer, populates lawyer's wwWallet
│   ├── seed-client.ts            # walks lawyer/client through issuer.eudiw.dev for PID
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
- ❌ XMTP messaging, ERC-5564 stealth addresses, BBS+ — never were in scope per round 1
- ❌ Block explorer integration — render tx receipts in our side panel
- ❌ Phone wallet requirement — wwWallet in browser
- ❌ **Separate "bar" Next.js page** — the bar is a seed script, not a UI
- ❌ **Separate "verifier" page** — verifier logic lives in `lib/ebsi.ts`, called by API routes
- ❌ **localStorage credential popup** — replaced with real wwWallet via OID4VCI/OID4VP
- ❌ **Pre-staged EAS attestations** — only credentials are pre-staged in wwWallet; attestations happen live on stage
- ❌ Postgres for hackathon — in-memory or SQLite
- ❌ Pre-staging the lawyer's onboarding (prior round-4 idea) — both onboardings now live

## Failure modes and recovery

**`@sd-jwt/sd-jwt-vc` install fails on day 1** — fall back to `@sd-jwt/core` directly (one layer down) or `@hopae/sd-jwt-vc`. The signing/verification API is similar; the SDJwtVcInstance just wraps SDJwtInstance with vct/cnf validation.

**`verifier.eudiw.dev` is down on stage** — pre-recorded backup video for screens one and two. Cache last-known-good response for offline replay.

**wwWallet rejects did:key issuer** — switch the bar's DID method to **did:web**. Host `/.well-known/did.json` via Cloudflare Tunnel during dev. Same verifier code, different DID resolution.

**ZK proof slow on stage** — pre-warm proving key on `/engagement/[id]` page load. If still slow, switch to architecture slide while it generates. Don't apologize.

**MetaMask popup glitches** — bring it up manually from the toolbar. If frozen, the page should retry the `useWriteContract` call once.

**Anvil dies mid-demo** — `make demo-reset` reloads from `anvil-state.json`. ~10 seconds. Continue from screen one. The seed credentials in wwWallet survive — only the chain state is regenerated.

**Forget a section** — slides are in order, just skip to the next.

## Sources

All sources are in [round docs 04–08](04-research-findings.md). Key links:

- [@sd-jwt/sd-jwt-vc](https://www.npmjs.com/package/@sd-jwt/sd-jwt-vc)
- [@cef-ebsi/key-did-resolver](https://www.npmjs.com/package/@cef-ebsi/key-did-resolver)
- [EUDI hosted verifier](https://verifier.eudiw.dev)
- [EUDI hosted issuer](https://issuer.eudiw.dev)
- [wwWallet demo](https://demo.wwwallet.org)
- [eas-contracts](https://github.com/ethereum-attestation-service/eas-contracts)
- [Noir docs](https://noir-lang.org/)
- [SIWE specification (EIP-4361)](https://eips.ethereum.org/EIPS/eip-4361)
- Round-7 verified smoketest at `/tmp/ebsi-smoketest/roundtrip.mjs` — copy as the literal starting point for `lib/ebsi.ts`
