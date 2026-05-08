# Spec Sheet: Pan-EU Pseudonymous Legal Advice Platform

## Architecture overview

Three subsystems, each with a clear cryptographic boundary:

1. **Lawyer credentialing** — EBSI VC issuance and verification, on-chain attestation
2. **Client onboarding** — EUDI PID verification, ZK conflict check, on-chain attestation
3. **Engagement layer** — Solidity escrow contract gated by both attestations, milestone release

Hackathon target: all three working end-to-end on testnet, real cryptographic flows on the EBSI conformance environment and Base Sepolia or Arbitrum Sepolia.

## Tech stack

### Backend
- Node.js 20+ with TypeScript
- Express or Fastify (Fastify preferred, lighter)
- `@cef-ebsi/verifiable-credential` for EBSI VC verification
- `@cef-ebsi/verifiable-presentation` for VP handling
- `@cef-ebsi/ebsi-did-resolver` for `did:ebsi` resolution
- `@cef-ebsi/key-did-resolver` for `did:key` (natural persons)
- `did-jwt` (peer dependency of the EBSI libs)
- `viem` for L2 contract interaction (lighter than ethers, better TS)

### Smart contracts
- Solidity 0.8.24+
- Foundry for build and test
- EAS (Ethereum Attestation Service) v1.4 SDK and contracts
- Deploy to Base Sepolia (preferred, lower friction) or Arbitrum Sepolia

### ZK layer
- Noir (newer, easier than Circom for hackathon timeline)
- `@noir-lang/noir_js` for browser proof generation
- Circuit: non-membership in hashed-commitment set, N=8

### Frontend
- Next.js 14+ App Router
- `wagmi` + `viem` for wallet connection
- Tailwind for styling, no design system needed for demo
- A side panel that streams network calls and verification results live (this is the demo's most important UI piece)

### Storage
- Postgres via `pg` for engagement state, lawyer profiles, client commitments
- Redis optional for session state, can skip for demo
- EU region hosting (any EU AWS/Hetzner region)

## Component breakdown

### 1. EBSI VC verifier service

**Endpoint:** `POST /api/lawyer/verify-credential`

**Input:** OID4VP response from lawyer's wallet (JWT VP containing the lawyer's `LegalProfessionalAccreditation` VC)

**Logic:**
```typescript
import { verifyCredentialJwt } from "@cef-ebsi/verifiable-credential";

const config = {
  hosts: ["api-conformance.ebsi.eu"],
  scheme: "ebsi",
  network: { name: "conformance", isOptional: false },
  services: {
    "did-registry": "v5",
    "trusted-issuers-registry": "v5",
    "trusted-policies-registry": "v3",
    "trusted-schemas-registry": "v3",
  },
};

const verified = await verifyCredentialJwt(vcJwt, config, {
  // Default: validates signature, DID document, accreditation chain,
  // credential schema, status list
});
```

**Output:** Verified credential subject, lawyer DID, jurisdiction(s), specialty. If verification passes, write EAS attestation to Base Sepolia.

**The library does the heavy lifting:** signature against DID document, JWT claims sanity, credential schema check, accreditation walk back to Root TAO. This is one library call. The side panel shows each network call to the conformance environment as it happens.

### 2. EUDI PID verifier service

**Endpoint:** `POST /api/client/verify-pid`

**Input:** OID4VP response containing SD-JWT VC PID from EUDI reference wallet (`issuer.eudiw.dev`)

**Logic:** Validate the SD-JWT VC signature against the issuer's x.509 cert chain, confirm IACA root, extract disclosed claims (nationality, over-18, residence country only — selective disclosure).

**Library options:**
- Use `eudi-srv-verifier-endpoint` from the EU repo as a service we run locally (Kotlin, Spring Boot)
- Or implement minimal SD-JWT VC verification in Node with `sd-jwt-vc` npm package

For the hackathon: ship the EU verifier endpoint via Docker locally, our backend calls it. Saves implementation time.

**Output:** Verified PID claims (selective disclosure subset), client DID. If passes, run ZK conflict check, then write EAS client attestation.

### 3. ZK conflict-check circuit

**Circuit (Noir):**
```rust
// Proves: hash(client_secret) is NOT in lawyer's prior-client commitment set
fn main(
    client_secret: Field,                    // private
    prior_commitments: pub [Field; 8],       // public
    salt: pub Field                          // public
) {
    let commitment = std::hash::pedersen([client_secret, salt])[0];
    for i in 0..8 {
        assert(commitment != prior_commitments[i]);
    }
}
```

**Why N=8 for demo:** keeps proof generation under 3 seconds in browser. Production scales to a Merkle tree of thousands. Honest framing on stage.

**Why salted:** prevents the lawyer from running a precomputed dictionary of commitments to identify the client. Salt is per-engagement.

**Flow:**
1. Lawyer's encrypted prior-client commitment set is fetched (we store these per-lawyer, encrypted client-side, never plaintext)
2. Client's wallet generates the proof using `client_secret` (random per engagement, derived from PID hash)
3. Proof submitted to verifier, verifier returns boolean
4. On true, EAS client attestation written

### 4. Solidity escrow contract

**Contract: `LegalEngagementEscrow.sol`**

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IEAS, Attestation} from "@ethereum-attestation-service/eas-contracts/contracts/IEAS.sol";

contract LegalEngagementEscrow {
    IEAS public immutable eas;
    bytes32 public immutable lawyerSchemaUid;
    bytes32 public immutable clientSchemaUid;

    uint16 public constant TAKE_RATE_BPS = 1500; // 15%
    address public immutable platformTreasury;

    enum Status { Created, Funded, Released, Disputed }

    struct Engagement {
        address lawyer;
        address client;
        uint256 amount;
        Status status;
        bytes32 lawyerAttestationUid;
        bytes32 clientAttestationUid;
    }

    mapping(uint256 => Engagement) public engagements;
    uint256 public nextEngagementId;

    event EngagementCreated(uint256 indexed id, address lawyer, address client, uint256 amount);
    event EngagementFunded(uint256 indexed id);
    event EngagementReleased(uint256 indexed id, uint256 toLawyer, uint256 toPlatform);

    constructor(address _eas, bytes32 _lawyerSchema, bytes32 _clientSchema, address _treasury) {
        eas = IEAS(_eas);
        lawyerSchemaUid = _lawyerSchema;
        clientSchemaUid = _clientSchema;
        platformTreasury = _treasury;
    }

    function createEngagement(
        address lawyer,
        address client,
        uint256 amount,
        bytes32 lawyerAttestation,
        bytes32 clientAttestation
    ) external returns (uint256 id) {
        // Verify both attestations exist, are not revoked, and target the right addresses
        Attestation memory lawyerAtt = eas.getAttestation(lawyerAttestation);
        require(lawyerAtt.schema == lawyerSchemaUid, "wrong lawyer schema");
        require(lawyerAtt.recipient == lawyer, "lawyer attestation mismatch");
        require(lawyerAtt.revocationTime == 0, "lawyer attestation revoked");

        Attestation memory clientAtt = eas.getAttestation(clientAttestation);
        require(clientAtt.schema == clientSchemaUid, "wrong client schema");
        require(clientAtt.recipient == client, "client attestation mismatch");
        require(clientAtt.revocationTime == 0, "client attestation revoked");

        id = nextEngagementId++;
        engagements[id] = Engagement({
            lawyer: lawyer,
            client: client,
            amount: amount,
            status: Status.Created,
            lawyerAttestationUid: lawyerAttestation,
            clientAttestationUid: clientAttestation
        });
        emit EngagementCreated(id, lawyer, client, amount);
    }

    function fundEngagement(uint256 id) external payable {
        Engagement storage e = engagements[id];
        require(msg.sender == e.client, "only client");
        require(e.status == Status.Created, "wrong status");
        require(msg.value == e.amount, "wrong amount");
        e.status = Status.Funded;
        emit EngagementFunded(id);
    }

    function releaseEngagement(uint256 id) external {
        Engagement storage e = engagements[id];
        require(msg.sender == e.client, "only client");
        require(e.status == Status.Funded, "wrong status");

        uint256 platformCut = (e.amount * TAKE_RATE_BPS) / 10000;
        uint256 lawyerCut = e.amount - platformCut;

        e.status = Status.Released;
        (bool ok1,) = e.lawyer.call{value: lawyerCut}("");
        (bool ok2,) = platformTreasury.call{value: platformCut}("");
        require(ok1 && ok2, "transfer failed");
        emit EngagementReleased(id, lawyerCut, platformCut);
    }
}
```

**Schema definitions for EAS:**

Lawyer schema: `address lawyer, string ebsiDid, string jurisdiction, string specialty, uint64 verifiedAt`

Client schema: `address client, string nationality, bool over18, bytes32 conflictCheckProofHash, uint64 verifiedAt`

**Tests:** Foundry, cover the four state transitions and all `require` failures. Aim for 100% branch coverage on the contract, takes a few hours.

### 5. Frontend

Three pages, all real, no mocks:

- `/lawyer/onboard` — wallet connect, OID4VP request, side panel showing EBSI verification trace, EAS attestation tx
- `/client/onboard` — wallet connect, OID4VP request to EUDI, ZK proof generation in browser, EAS attestation tx
- `/engagement/[id]` — escrow funding, milestone release, status display, block explorer links

The side panel is the demo's most important UI. It shows:
- HTTP requests to `api-conformance.ebsi.eu` with response codes
- Resolved DID documents
- Trust chain walk (TI → TAO → Root TAO)
- ZK proof generation timer
- On-chain transaction hashes with block explorer links

## What's mocked, with honest framings

| Component | Mocked? | Stage framing |
|---|---|---|
| EBSI VC verification | No, real | "Real EBSI conformance environment, same code path as Pilot/Production" |
| Lawyer's bar admission VC | Issuer is conformance mock | "In production, the issuer here is a real bar association onboarded as a TAO under the EBSI Support Office" |
| EUDI PID verification | No, real | "EU reference issuer at issuer.eudiw.dev, same SD-JWT VC format member states will produce" |
| ZK conflict check | Real, simplified | "N=8 commitments for demo, production scales this to a Merkle tree of thousands" |
| Escrow contract | Real on testnet | "Base Sepolia for demo, mainnet path is identical" |
| EAS attestations | Real on testnet | Same as above |
| QES signing | Slide only | "Commercial integration with QTSP partner (Namirial, D-Trust), not technical risk" |
| AML check | Slide only | "Regulated identity-escrow layer, partnership with KYC provider, separate workstream" |
| XMTP messaging | Dropped | Don't mention unless asked |
| Stealth addresses | Dropped | Don't mention unless asked |

## Day-by-day plan (assuming 4 days of work, scale up/down as needed)

### Day 1: foundations
- Set up monorepo (apps/backend, apps/frontend, contracts, circuits)
- Foundry project, write `LegalEngagementEscrow.sol` and tests
- Deploy to Base Sepolia, verify on Basescan
- Register two EAS schemas on Base Sepolia, save UIDs

### Day 2: EBSI verification
- Backend service skeleton with Fastify
- Implement `/api/lawyer/verify-credential` end-to-end
- Test against EBSI conformance issuer-mock with a hand-crafted `LegalProfessionalAccreditation` JWT
- Wire EAS attestation write on success
- Side-panel SSE endpoint streaming verification trace

### Day 3: EUDI PID + ZK
- Run EUDI verifier endpoint locally via Docker
- Implement `/api/client/verify-pid` calling the EUDI verifier
- Write Noir circuit, compile, generate proving key
- Browser-side proof generation with `noir_js`
- Wire client EAS attestation on PID + ZK pass

### Day 4: integration + demo polish
- Frontend pages wired up
- Side panel polished with live network call streaming
- Block explorer links rendered
- Run through the demo five times, time each section, cut anything that drags
- Backup video recording in case of network issues on stage

## Honest framings to rehearse

These are the questions a sharp judge will ask. Have answers ready.

**"Is the EBSI issuer a real bar association?"**
No, it's the EBSI conformance environment, the EU's public test issuer. Production requires bar associations to be onboarded as TAOs, which is institutional work. The verification code path is identical.

**"Is this a real EUDI Wallet?"**
The PID issuer is the EU's reference implementation at issuer.eudiw.dev, which produces SD-JWT VCs in the same format member-state wallets are required to support. Real wallets are rolling out unevenly through 2026 and 2027.

**"Won't bar associations sue you for fee-sharing?"**
We're a payment-rails provider on the same legal basis as Stripe, charging on transaction volume not legal fees. The lawyer sets their own price and receives the gross amount minus a payment-processing fee. Clean separation from referral-fee restrictions in BRAO and equivalent statutes.

**"Why a take rate at all then?"**
Volume-based pricing is what makes the platform sustainable. Bar associations have historically resisted referral fees, not payment processing fees, which is why Stripe operates without issue. We can also operate purely on subscriptions if a jurisdiction requires it.

**"Why not just use AWS KMS for client identity?"**
The pseudonymity guarantee is the product. The lawyer cannot identify the client even if they collude with us, because the conflict-check is ZK-attested and the platform's sealed-but-unsealable identity layer is held in qualified trust escrow. An AWS-based system requires trusting both AWS and us.

**"How do you handle disputes?"**
The escrow contract has a Disputed status and a multi-sig arbitrator role (not built for the demo). Long-term: integrate Kleros or a panel of accredited arbitrators with their own EBSI VCs.

**"What stops a lawyer from issuing fake VCs?"**
The accreditation chain. The lawyer's VC must trace back to a Root TAO via TIR-registered TAOs and TIs. The library walks this chain. A self-issued VC fails verification.

## Repo layout suggestion

```
/
├── apps/
│   ├── backend/           # Fastify, TS
│   └── frontend/          # Next.js 14
├── contracts/             # Foundry
│   ├── src/
│   │   └── LegalEngagementEscrow.sol
│   ├── test/
│   └── script/
├── circuits/              # Noir
│   └── conflict_check/
├── infrastructure/
│   └── docker-compose.yml # EUDI verifier endpoint, postgres
├── docs/
│   ├── architecture.md
│   └── demo-script.md
└── README.md
```

## Build environment notes

- Node 20+ (EBSI libs require modern crypto)
- Foundry latest
- Noir 0.30+
- Docker for the EUDI verifier endpoint
- Base Sepolia RPC: get from Alchemy or use public, fund test wallet with Base Sepolia faucet
- EAS on Base Sepolia: contract at `0x4200000000000000000000000000000000000021`
- EBSI conformance env requires no API key, fully open

## What can fail on stage

1. **Network to EBSI conformance** — record a backup video, also cache verification responses for offline replay
2. **Base Sepolia RPC slow** — have two RPC endpoints configured, fall over automatically
3. **ZK proof slow** — pre-warm the proving key on page load, show a progress bar so the wait feels intentional
4. **Wallet UX glitch** — bring two laptops with two MetaMask accounts pre-funded
5. **Demo internet** — hotspot from phone as backup, run a local mirror of the EUDI verifier endpoint
