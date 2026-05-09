# Project walkthrough — for someone new to blockchain and EU digital identity

Read this top to bottom on first pass. After that, use the table of contents as a reference.

The goal is to give you enough vocabulary and conceptual scaffolding to understand the spec at [09-spec-v2.md](09-spec-v2.md). Where I give an analogy I'll also state literally what's happening, because analogies leak.

## Contents

1. [What you're building, in 90 seconds](#1-what-youre-building-in-90-seconds)
2. [The real-world problem we're solving](#2-the-real-world-problem-were-solving)
3. [Cryptography primer — the 4 things you need to know](#3-cryptography-primer)
4. [Verifiable Credentials, DIDs, and did:key](#4-verifiable-credentials-dids-and-didkey)
5. [The blockchain layer — Ethereum, anvil, smart contracts, EAS](#5-the-blockchain-layer)
6. [The EU regulatory backdrop — eIDAS 2, EUDI Wallet, EBSI](#6-the-eu-regulatory-backdrop)
7. [Zero-knowledge proofs and Noir](#7-zero-knowledge-proofs-and-noir)
8. [Wallet protocols — OID4VCI and OID4VP](#8-wallet-protocols--oid4vci-and-oid4vp)
9. [The full flow in this project](#9-the-full-flow-in-this-project)
10. [Build sequence](#10-build-sequence)
11. [Glossary](#11-glossary)

## 1. What you're building, in 90 seconds

A web platform where:

- **Lawyers** prove they're real, currently-admitted EU bar members using a cryptographically signed credential. Anyone can verify the signature with public information. No central database we control; the credential is a self-contained piece of signed data.
- **Clients** prove they're real humans (over 18, EU resident) using a credential issued by an EU-government-run service, and prove they have no prior relationship with the lawyer using a **zero-knowledge proof** — a proof that reveals only the *fact* of no-prior-relationship and nothing else.
- **Money** flows through a small program on Ethereum (a "smart contract"). The program holds the client's payment, releases 85% to the lawyer when the work is done, and keeps 15% for the platform. The program has no humans in the loop and refuses to act unless both parties have valid credentials on file.

For the hackathon: everything runs on a fake Ethereum on your laptop ("anvil"), the lawyer credential is signed by us (standing in for a bar association), and everything else is real EU infrastructure or real cryptography.

The pitch: today no one verifies cross-border lawyers cryptographically. The EU is rolling out the infrastructure to do it (EUDI Wallet, EBSI), and we're showing what a marketplace looks like that's built on top of it.

## 2. The real-world problem we're solving

Imagine a Spanish founder wants a German lawyer to set up her German company. Today she has two options:

1. Upload her ID and corporate documents to a directory site she's never heard of, hoping it's not a scam.
2. Pay 600 euros to a Munich firm to introduce her to one of their German lawyers.

Both are bad. Option 1 has zero cryptographic guarantee that the lawyer on the other end actually is a lawyer. Option 2 doesn't scale, isn't pseudonymous, and locks her in to the Munich firm's relationships.

The thing missing in the world is a **trusted, cross-border, pseudonymous matching layer**. Cryptographically verify everyone who matters; let identities be revealed only when matters escalate.

The EU is building the foundational infrastructure for this (the EUDI Wallet, EBSI), but no one has built the marketplace on top yet. That's our slot.

## 3. Cryptography primer

Four ideas. If you've used HTTPS or SSH you've already used these — you just may not have named them.

### 3a. Public-key cryptography in one paragraph

You generate a pair of numbers: a **public key** and a **private key**. They're mathematically related such that:

- Anything signed with the private key can be verified with the public key.
- Anything encrypted to the public key can only be decrypted by the private key.

You publish the public key everywhere. You guard the private key. When you sign a message with your private key, anyone holding your public key can mathematically prove that message came from someone who has your private key.

**For us:** the lawyer (and our backend, standing in for a bar association) holds a private key and uses it to sign credentials. Anyone — judge, court, our smart contract, a third-party verifier — can check the signature using only the public key.

The specific signing algorithm we use is **ES256** (Elliptic Curve, P-256, SHA-256). It's one of the standard JWT signing algorithms and what EBSI specifies.

### 3b. JWT (JSON Web Token)

A JWT is just **three pieces of base64url-encoded text separated by dots**: `header.payload.signature`.

- **Header**: small JSON object saying which algorithm was used. `{"alg":"ES256","typ":"JWT","kid":"..."}` — the `kid` ("key ID") tells the verifier which public key to look up.
- **Payload**: the actual claims you're signing. JSON.
- **Signature**: ES256 signature over `header.payload`.

Anyone can decode the header and payload (they're not encrypted, just base64). Only someone with the private key can produce a valid signature. Anyone with the public key can verify.

**For us:** lawyer credentials are JWTs. Specifically they're a flavor called a **JWT-VC** — a JWT whose payload follows the W3C Verifiable Credential structure (covered next).

You can paste any JWT into [jwt.io](https://jwt.io) to see its three parts decoded. Useful for debugging.

### 3c. Hashing

A **hash function** takes any input and returns a fixed-size fingerprint. SHA-256 returns 32 bytes. Same input → same fingerprint, every time. Different input → almost certainly different fingerprint. You can't reverse a hash to recover the input.

**For us:** hashes appear in three places:
- Inside JWT signatures (the message is hashed, then the hash is signed).
- In our zero-knowledge proof, where we commit to the client's identity by hashing it with a salt.
- In Ethereum addresses (which are derived from a hash of a public key).

### 3d. Salt

A salt is a random number you mix into a hash to prevent rainbow-table attacks. `hash(secret + salt)` reveals nothing about `secret` even if an attacker has a giant precomputed dictionary of common secrets.

**For us:** the conflict-of-interest ZK check uses per-engagement salts so the lawyer can't precompute a dictionary of "which clients have I worked with before."

## 4. Verifiable Credentials, DIDs, and did:key

### 4a. Verifiable Credential (VC)

A Verifiable Credential is **a JWT (or similar signed format) whose payload follows a standard W3C structure**. The structure is opinionated:

- It has an `issuer` (who's making the claim — usually a DID, see below).
- It has a `credentialSubject` (who the claim is about, with their DID and the claimed attributes).
- It has dates (`issuanceDate`, `validFrom`, `expirationDate`).
- It has a `type` array — a list of "what kind of credential is this." Always starts with `["VerifiableCredential", ...]`.
- It has a `credentialSchema` reference — a URL to a JSON Schema describing the shape of `credentialSubject`.

That's literally it. A VC is just signed JSON in a specific shape. The "verifiable" part is the cryptographic signature.

**Concrete example for us:**

```json
{
  "type": ["VerifiableCredential", "VerifiableAttestation", "LegalProfessionalAccreditation"],
  "issuer": "did:key:z2dmzD81cgPx8Vki...",
  "issuanceDate": "2026-05-04T12:00:00Z",
  "validFrom": "2026-05-04T12:00:00Z",
  "expirationDate": "2027-05-04T12:00:00Z",
  "credentialSchema": { "id": "https://...", "type": "FullJsonSchemaValidator2021" },
  "credentialSubject": {
    "id": "did:key:z2dmzD81cgPx8...",   // the lawyer's DID
    "jurisdiction": "DE",
    "barAdmissionNumber": "RAK-Muenchen-2018-04321",
    "specialty": "GmbH formation",
    "admittedSince": "2018-09-15"
  }
}
```

This payload, wrapped as an SD-JWT VC and signed with our backend's private key, is the lawyer's credential. The library `@sd-jwt/sd-jwt-vc` produces this — we use the SD-JWT VC format (`vc+sd-jwt`) rather than W3C JWT VC because that's what wwWallet's OID4VCI consume code accepts (per round-9 source review). The format also matches what eIDAS 2 mandates for QEAA professional credentials, so the production trajectory is built in.

In SD-JWT VC, the *selectively-disclosable* claims — `jurisdiction`, `specialty`, `admittedSince`, `barAdmissionNumber` — get hashed at issuance and only revealed when the holder explicitly chooses to disclose them at presentation time. The `cnf.jwk` field binds the credential to the holder's wallet key.

### 4b. DID (Decentralized Identifier)

A DID is a string that identifies an entity (a person, an organization, a public key). It looks like `did:method:specific-id`. There are dozens of DID methods. The ones relevant to us:

- **`did:key`** — the DID *is* a public key, encoded into a string. Anyone can resolve it without consulting any registry. You generate a keypair, run a function on the public key, and you have a DID. **This is what we use** for both our backend's "issuer" identity and the lawyer's identity.
- **`did:ebsi`** — a DID registered in EBSI's on-chain DID registry, used for "legal entities" (governments, institutions, bar associations). Requires institutional onboarding. We're *not* using this for the demo.

A DID is not the same as the underlying key — it's a string that resolves to a **DID document** describing one or more keys, services, and authentication methods. For `did:key`, the resolution is mathematical: parse the DID string, you get the key. No network call needed.

**Why DIDs at all and not just "use a public key directly":** DIDs let you rotate keys without changing your identifier, support multiple keys (for signing, encryption, authentication), and work across different cryptographic schemes. Plus they're the W3C standard the EU built EUDI/EBSI on top of, so our verifier libraries expect DIDs as inputs.

**For us:** every actor has a `did:key`. Our backend (the "stand-in bar association") has one. Each lawyer wallet has one. Each client wallet has one. They're all just public keys wrapped in a DID format.

### 4c. The full data model in one picture

```
backend boots
  ↓ generates ES256 keypair
  ↓ derives did:key from public key
  
backend has: ISSUER_PUBLIC_KEY, ISSUER_PRIVATE_KEY, ISSUER_DID

lawyer signs up
  ↓ frontend generates ES256 keypair for the lawyer
  ↓ derives lawyer's did:key
  ↓ asks backend "issue me a credential, my DID is X"

backend
  ↓ assembles the VC payload (above)
  ↓ signs JWT with ISSUER_PRIVATE_KEY
  ↓ returns the signed JWT to the lawyer

lawyer presents credential at engagement time
  ↓ backend verifies JWT signature using ISSUER_PUBLIC_KEY (which it knows because it's its own key)
  ↓ in production, the verifier wouldn't know the issuer's key directly — it would resolve the issuer's DID against EBSI's registry to get the key
```

## 5. The blockchain layer

### 5a. Ethereum, EVM, smart contracts in five sentences

Ethereum is a globally distributed computer where the program code (a "smart contract") and its memory are replicated on thousands of nodes. To make a function call, you broadcast a "transaction" with a fee. The transaction gets included in a block, every node executes the function, every node updates state. The result is a tamper-resistant, no-central-operator-required computer for things that need impartial enforcement (like custody of funds in escrow). The "EVM" (Ethereum Virtual Machine) is the bytecode VM that runs the smart contract code.

You don't need to understand Ethereum's full economics for this project. You need to know:

- A smart contract is a small program that lives at an address (a 20-byte hex string like `0x4200…0021`).
- You call the program by sending a transaction from a wallet (which has a private key controlling an address).
- The program has its own memory ("state"); state changes are recorded in transactions.
- The program can hold ETH (Ethereum's native currency) and decide who to send it to, based on its rules.

### 5b. Anvil — a fake Ethereum on your laptop

Real Ethereum costs real money to use. To develop, we use **anvil**, which is a single-process simulation of an Ethereum node that runs on your laptop. It exposes the same JSON-RPC interface as real Ethereum, accepts transactions, executes them, mines blocks instantly. State is in-memory (lost on restart) unless you `--dump-state state.json` and `--load-state state.json`.

Anvil pre-funds 10 wallets with 10000 fake ETH each at boot. The first wallet's private key is `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80` — that's a publicly known dev key, never use it on real Ethereum.

**For us:** anvil is the "L2" the spec talks about. The whole engagement layer (escrow, attestations) runs on anvil. We never touch real Ethereum during the hackathon.

### 5c. Foundry — the build tool

Foundry is to Solidity smart contracts what `cargo` is to Rust or `npm` is to Node. Three binaries:

- **`forge`** — compiles, tests, deploys contracts. Like `cargo build / cargo test`.
- **`cast`** — sends transactions and reads chain state from the command line. Like `curl` for Ethereum.
- **`anvil`** — the local node, see above.

You initialize a Foundry project with `forge init`, install dependencies with `forge install`, build with `forge build`, test with `forge test`. Tests are written in Solidity, run on a simulated EVM.

### 5d. EAS — Ethereum Attestation Service

EAS is a pair of smart contracts that give you a generic "make a signed claim about an address, store it on chain" primitive. It's what we use to record "this lawyer was verified as a bar member" on chain.

EAS has two contracts:

- **`SchemaRegistry`** — register the shape of an attestation (e.g. "address recipient, string jurisdiction, string specialty"). Returns a `bytes32` schema UID.
- **`EAS`** — make an actual attestation against a registered schema. The attester says "I attest that `recipient` has these `data` per `schemaUID`."

When our backend successfully verifies a lawyer's credential, it makes an EAS attestation: "0xabc…123 (this Ethereum address) is a verified lawyer with jurisdiction=DE, specialty=GmbH formation." That attestation is now public on chain, with the attester (us) cryptographically signed.

Later, the engagement contract reads the attestation when creating an engagement: "does this lawyer have a valid attestation under our schema, attested by us, not revoked? Yes? OK, engagement allowed."

### 5e. Why we deploy EAS from source on anvil

EAS is deployed at fixed predeploy addresses on real chains like Base. Anvil is fresh — those addresses are empty. So we clone `ethereum-attestation-service/eas-contracts`, compile with our Foundry, and deploy fresh.

Round-7 verification surfaced two specific gotchas:

1. EAS's bytecode is large. **Without the optimizer enabled in `foundry.toml`**, the compiled EAS contract exceeds the 24 KB EIP-170 contract-size limit and deployment reverts. You need `optimizer = true; optimizer_runs = 1000000`.
2. EAS v1.4.0 expects **OpenZeppelin v5.2.0 specifically**. v5.0.x is close but not ABI-compatible enough.

Both are now in the spec.

## 6. The EU regulatory backdrop

### 6a. eIDAS 2

eIDAS is a 2014 EU regulation about electronic identity ("electronic IDentification, Authentication and trust Services"). eIDAS 2 is the 2024 update that **mandates every EU member state to issue every citizen a digital identity wallet by end of 2026**. The wallet has to be free, voluntary to use, and accept credentials from other member states' wallets.

The wallet is called the **EUDI Wallet** ("EU Digital Identity Wallet"). The technical specs for what it must do are in a document called the **EUDI ARF** (Architecture and Reference Framework).

**Why this matters for us:** the EU is essentially mandating that 450 million people have a cryptographic identity wallet. Marketplaces like ours can require credentials from this wallet for identity verification, instead of asking users to upload PDFs of passports. We are positioning to consume this infrastructure.

### 6b. The credentials in the EUDI Wallet

The EUDI ARF defines a few credential types:

- **PID (Person Identification Data)** — your government identity. Name, ID number, date of birth, nationality, residence. Issued by your country's national PID provider.
- **(Q)EAA (Qualified / non-Qualified Electronic Attestation of Attributes)** — domain-specific credentials. "I am a licensed lawyer." "I have a medical degree." "I'm a tax-resident here." Issued by **Qualified Trust Service Providers (QTSPs)** — accredited third parties that act on behalf of authoritative sources (a bar, a university).

Bar admission falls under (Q)EAA per the ARF. In production, the lawyer's credential would be a (Q)EAA issued by a QTSP. **For us, today, no QTSP issues lawyer (Q)EAAs yet** — the infrastructure is rolling out. We use a stand-in.

### 6c. EBSI

EBSI is the **European Blockchain Services Infrastructure** — a private blockchain run by EU member states. It exists *separately* from the EUDI Wallet, but they overlap.

EBSI's main piece of infrastructure for us is the **Trusted Issuers Registry (TIR)** — an on-chain registry of "which DIDs are authorized to issue which credential types." If a bar association is registered in TIR as authorized to issue `LegalProfessionalAccreditation`, anyone can verify a lawyer's credential by:

1. Reading the credential's `issuer` field (a DID).
2. Looking up that DID in the TIR.
3. Confirming the DID is registered as authorized to issue `LegalProfessionalAccreditation`.
4. Walking up the trust chain (TI → TAO → Root TAO) to confirm the registration is itself authorized.

**For us, today, no bar is registered in TIR**, and getting registered would take weeks of paperwork. So we use a `did:key` issuer (just a self-generated keypair) and tell the verifier library "skip the TIR lookup" via `validateAccreditation: false`. Same code path; in production the flag flips and the registry walk happens.

### 6d. So what's the difference between EBSI and EUDI?

Easy to confuse them. Short version:

- **EBSI** is infrastructure (a blockchain + registries) for issuers to register themselves and credentials to be schema-validated. Run by member states. Largely about *trust anchoring*.
- **EUDI** is the *user-facing wallet* that holds and presents credentials. Run by individual member states (each issues their own wallet). About the user side.

In production they wire together: a bar association's QTSP issues a (Q)EAA via EBSI's TIR-anchored trust chain → user's EUDI Wallet receives it → user presents it to a verifier → verifier walks back through EBSI to confirm the QTSP's authority.

For our hackathon, both are slide-only future infrastructure. We use **`@sd-jwt/sd-jwt-vc`** to issue and verify the SD-JWT VC format that the EUDI ARF mandates (and that wwWallet's OID4VCI consume path actually accepts), and we use **`@cef-ebsi/key-did-resolver`** for did:key resolution (same library wwWallet uses internally). The TIR lookup is skipped — we don't have a real bar association as a Trusted Issuer yet.

## 7. Zero-knowledge proofs and Noir

### 7a. What a zero-knowledge proof actually is

A zero-knowledge proof (ZKP) is a way for one party to prove to another that **a statement is true, without revealing why it's true**.

Toy example: "I know the password for this file." A ZKP would let you prove you know the password without ever sending it.

A more relevant example for us: "My identity is not in a list of 8 prior clients." A ZKP lets the client prove this fact without:
- Revealing their identity to the lawyer
- Revealing the prior clients to the client

Both privacy properties hold simultaneously. That's the magic.

### 7b. How it works (high level)

You write a small program ("circuit") that takes some inputs marked **private** and some marked **public**, and asserts some predicates over them. A ZK toolchain compiles the circuit into a "proving system" — something like:

- A function `prove(privateInputs, publicInputs) → proof` that the prover runs (in our case, in the client's browser).
- A function `verify(proof, publicInputs) → bool` that the verifier runs (in our backend or in a smart contract).

The proof is small (~200 bytes typically). The verification is fast. Privacy: the verifier learns *only* the truth of the predicate, not anything about `privateInputs`.

For our project, the predicate is non-membership: `commitment(client) ∉ priorClients[]`.

### 7c. Noir — the language

Noir is a Rust-like DSL for writing ZK circuits. The toolchain is `nargo` (build/test/compile). Simpler ergonomics than Circom, the older alternative.

**Our circuit** ([09-spec-v2.md](09-spec-v2.md)):

```rust
fn main(
    client_secret: Field,            // private — the client's identity hash
    prior_commitments: pub [Field; 8], // public — the lawyer's prior client set
    salt: pub Field                  // public — per-engagement salt
) {
    let commitment = std::hash::pedersen_hash([client_secret, salt]);
    for i in 0..8 {
        assert(commitment != prior_commitments[i]);
    }
}
```

Verified compiling cleanly in round 7. The output is a JSON file at `target/<name>.json` containing the compiled circuit (ACIR — Abstract Circuit Intermediate Representation). The client's browser uses this artifact + `@noir-lang/noir_js` to generate proofs.

**Why N=8 for hackathon:** keeps proof generation under ~3 seconds in browser. Production scales to a Merkle tree of thousands.

## 8. Wallet protocols — OID4VCI and OID4VP

These are the protocols that move credentials from issuers to wallets, and from wallets to verifiers. Both are extensions of OAuth 2.0 / OpenID Connect — same family as "Sign in with Google."

### 8a. OID4VCI (OpenID for Verifiable Credential Issuance)

**Purpose:** issuer → wallet. "Hi wallet, here's a credential, please add it to your storage."

**Flow (roughly):**
1. Issuer generates a **credential offer** — a URL like `openid-credential-offer://...` with parameters describing what's on offer.
2. User (with their wallet) opens the URL — either by clicking it on the same device, or by scanning a QR code with their phone wallet.
3. Wallet does an OAuth-style authorization dance with the issuer.
4. Wallet receives the signed credential and stores it.

**For us, we use OID4VCI off-stage in our seed scripts.** Before each demo, a script standing in for the bar association issues the lawyer's `LegalProfessionalAccreditation` to wwWallet via real OID4VCI; another script does the same with `issuer.eudiw.dev` for the PID. The credential lives in wwWallet's IndexedDB at `demo.wwwallet.org`'s origin — genuinely separated from our platform. We don't show OID4VCI live on stage; the credentials are pre-staged.

### 8b. OID4VP (OpenID for Verifiable Presentations)

**Purpose:** wallet → verifier. "Hi verifier, here's the credential you asked for."

**Flow:**
1. Verifier sends a **presentation request** to the wallet, specifying which credentials it wants and (for SD-JWT VC) which fields it wants disclosed.
2. Wallet shows the user "verifier X is asking for fields Y, Z. Approve?"
3. User approves; wallet sends a **verifiable presentation** (essentially: the credential, plus a fresh signature by the holder proving they currently hold the credential, plus selective disclosures).
4. Verifier verifies signatures, checks selective disclosures, extracts the disclosed fields.

**For us, we use OID4VP live on stage for both onboardings.** When the lawyer onboards, our platform sends an OID4VP request asking for *two* credentials in one go (PID + LegalProfessionalAccreditation). When the client onboards, a similar request asks for PID only (with selective disclosure). wwWallet receives the request, the user approves, the verifiable presentation comes back, our verifier validates everything and writes EAS attestations. We follow the patterns in the EU's own [recruitment service demo](https://github.com/eu-digital-identity-wallet/eudi-web-recruitment-service-demo).

### 8c. Selective disclosure (SD-JWT)

The PID a client presents has lots of fields: name, ID number, date of birth, photo, address, nationality, etc. **Selective disclosure** means the wallet can prove "the issuer signed this credential and it has nationality=ES, over_18=true" *without* revealing name, ID number, etc.

The format that supports this is **SD-JWT VC** (Selective Disclosure JWT VC). Different from a plain JWT VC. The hosted EU PID issuer produces SD-JWT VCs by default.

**For us:** when verifying the client PID, we ask only for `nationality`, `over_18`, `resident_country`. We never see the rest. That's what makes the client pseudonymous to the lawyer — we can prove they're a real human without knowing who they are.

### 8d. SIWE (Sign-In with Ethereum)

A separate auth primitive, layered on top of MetaMask. Specified in EIP-4361. Plain-English: the user clicks "Connect Wallet," MetaMask shows them a human-readable message ("lex-nova.local wants you to sign in with your Ethereum account 0xf39F…"), the user signs it (no gas — just a message signature), the platform verifies the signature recovers to the claimed address, then issues a session cookie.

**For us:** SIWE is the entry point on every visit. After SIWE we look up the address in our profiles store. **Found** → instant login, capabilities loaded, dashboard. **Not found** → "you need to verify yourself first," route them through onboarding.

The user has *two* wallets total in our system: **MetaMask** for SIWE login + signing on-chain transactions (creating engagements, funding, releasing), and **wwWallet** for holding and presenting verifiable credentials. Different roles, different keys.

## 9. The full flow in this project

Here's the entire flow end to end. Match each step to the components introduced above.

### Phase 0 — pre-stage (off-stage, before demo)

1. **Anvil + contracts.** Anvil starts. Foundry deploy script runs: deploys `SchemaRegistry`, then `EAS(SchemaRegistry)`, then registers two schemas (lawyer + client), then deploys `LegalEngagementEscrow`. All addresses written to `deployments/anvil.json`. `anvil --dump-state state.json` captures the post-deploy state.
2. **Lawyer's wwWallet seeded.** Run `pnpm seed:lawyer`. The script generates a fresh "bar" did:key + ES256 keypair, spins up a temporary OID4VCI issuer endpoint that signs SD-JWT VCs (`vc+sd-jwt` format), prints a credential offer URL. Operator opens the URL in wwWallet on the lawyer's laptop. wwWallet does the OID4VCI dance, sends a proof JWT bearing its holder JWK, receives the `LegalProfessionalAccreditation` SD-JWT VC with `cnf.jwk` binding, stores it in IndexedDB scoped to `demo.wwwallet.org`. Bar's keypair is then discarded.
3. **Both PIDs seeded.** Run `pnpm seed:client` on each laptop, which walks the operator through the EU's hosted PID issuer at `issuer.eudiw.dev` to populate each wwWallet with a real EUDI PID.
4. **Final pre-stage state:**
   - Anvil up with contracts deployed, no profiles, no attestations.
   - Lawyer's wwWallet: PID + LegalProfessionalAccreditation.
   - Client's wwWallet: PID only.
   - Platform DB: empty.

The pre-stage credentials are external infrastructure — we're not pretending to be the bar association live; we built our credential in advance, the way a real lawyer would already have one when arriving at our platform.

### Phase 1 — lawyer onboarding (live on stage)

1. Lawyer visits `lex-nova.local/lawyer/onboard`. Page renders a "Connect Wallet" button.
2. Click → MetaMask popup. User signs the SIWE message (~3s, no gas).
3. Backend `/api/auth/login` verifies signature, looks up the address → not found.
4. Page transitions to "Verify yourself."
5. Click "Verify" → backend `/api/onboarding/lawyer` constructs an **OID4VP request** with two `input_descriptors`: PID with selective disclosure of `nationality`, `over_18`, `resident_country`; LegalProfessionalAccreditation full claims.
6. Page opens wwWallet (deep link in 2nd tab). wwWallet shows the popup: "Lex Nova wants both your PID and your bar credential. Approve?"
7. User approves. wwWallet constructs a Verifiable Presentation: a JWT signed by the lawyer's holder key, wrapping both nested credentials (PID signed by `issuer.eudiw.dev`, bar cred signed by the bar's key from pre-stage).
8. Platform verifier:
   - Validates the holder signature (lawyer's wwWallet key).
   - Validates the PID with `@sd-jwt/sd-jwt-vc` against `issuer.eudiw.dev`'s x.509 chain.
   - Validates the bar cred with `@sd-jwt/sd-jwt-vc`, resolving the issuer's did:key via `@cef-ebsi/key-did-resolver` to get the verification key.
9. On both passing, backend calls `EAS.attest(...)` twice — once with the lawyer schema, once with the client schema. Two attestation UIDs returned.
10. Backend persists the profile: `{ ethAddress, capabilities: ["verified_lawyer", "verified_client"], didKey, lawyerAttestationUid, clientAttestationUid, jurisdiction, specialty, ... }`.
11. Side panel streams the entire trace via SSE. Three distinct DIDs visible (holder, bar issuer, verifier).
12. Frontend redirects to `/dashboard` showing both badges.

### Phase 2 — client onboarding (live on stage)

1. Client visits `lex-nova.local/client/onboard`. Connect Wallet → SIWE (~3s).
2. Backend looks up address → not found.
3. Click "Verify" → backend constructs an OID4VP request for **PID only**.
4. wwWallet popup: "Lex Nova wants your PID with these fields disclosed: nationality, over_18, resident_country. Approve?"
5. User approves. SD-JWT VP comes back.
6. Verifier validates (`@sd-jwt/sd-jwt-vc`), extracts the three disclosed claims.
7. Backend calls `EAS.attest(...)` once with the client schema.
8. Profile persisted with `capabilities: ["verified_client"]`.
9. Frontend redirects to `/dashboard` with the client badge and a "Find a lawyer" action.

### Phase 3 — engagement creation with live ZK conflict check

1. Client clicks "Find a lawyer" → list of available lawyers → picks Hans → clicks "Engage Hans."
2. Frontend hits `POST /api/engagements/preflight` with `{ lawyerEthAddress, clientEthAddress }`.
3. Backend generates a fresh 32-byte `salt`. Looks up the 8 prior-client IDs for Hans (in our demo: hardcoded fake prior clients). Computes `prior_commitments[i] = pedersen_hash(prior_client_id[i], salt)`. Returns `{ priorCommitments, salt }`.
4. Browser, with the prewarmed Noir prover, computes `client_secret = pedersen_hash([hash(disclosed_nationality), hash(disclosed_resident_country), over_18 ? 1 : 0, did:key])` and then generates the proof. ~2.3s, progress bar visible in the side panel.
5. Browser POSTs `{ proof, publicInputs }` to `/api/engagements/verify-zk`.
6. Backend verifier (`@noir-lang/noir_js`): `proof valid, client_commitment ∉ prior_commitments`. Engagement creation enabled.
7. Lawyer's dashboard shows the pending engagement. Click "Create Engagement" → MetaMask popup → confirm (~4s). `LegalEngagementEscrow.createEngagement(...)` runs on anvil; contract reads both EAS attestations (must not be revoked, must match the addresses), state `Created`.
8. Client clicks "Fund Engagement (0.05 ETH)" → MetaMask popup with the value → confirm (~4s). State `Funded`.
9. Lawyer does the work — off-chain, narrated.
10. Client clicks "Release Engagement" → MetaMask popup → confirm (~4s). Contract computes splits (85% lawyer, 15% platform), transfers, state `Released`.

End-to-end runtime on anvil with prewarmed state and pre-staged credentials: ~3 minutes total demo. The ZK proof and three MetaMask popups are the largest time costs; everything else is single-call HTTP.

## 10. Build sequence

This restates the phase plan with names you'll now recognize.

### Phase 0 — environment validation (1–2 hours)

Before writing any code, confirm the toolchain works. Round 7 already did most of this; here's what remains for you:

```bash
# Source Foundry + Noir into your shell
source ~/.bashrc      # if you installed today
forge --version
anvil --version
nargo --version
node --version

# Reachability
curl -I https://verifier.eudiw.dev
curl -I https://issuer.eudiw.dev
curl -I https://demo.wwwallet.org
```

If any binary is missing, run `foundryup` and `noirup` (they're already installed, just need to be on `PATH`).

### Phase 1 — contracts (half day)

The contract layer is the foundation. Build it first.

1. **Initialize the monorepo.** A simple structure: `apps/backend/`, `apps/frontend/`, `contracts/`, `circuits/`, `deployments/`. Use a top-level `package.json` if you want pnpm workspaces.
2. **`cd contracts && forge init .`** to scaffold a Foundry project.
3. **Apply the round-7 deltas from the spec:**
   - Create `foundry.toml` with `optimizer = true; optimizer_runs = 1000000; solc = "0.8.28"`
   - Create `remappings.txt` with the three lines from [09-spec-v2.md](09-spec-v2.md)
4. **Install dependencies:**
   ```bash
   forge install foundry-rs/forge-std
   forge install ethereum-attestation-service/eas-contracts
   forge install OpenZeppelin/openzeppelin-contracts@v5.2.0
   ```
5. **Write `LegalEngagementEscrow.sol`** — the contract from [02-spec.md](02-spec.md). It's about 90 lines.
6. **Write Foundry tests** in `test/`. Cover all four state transitions (`Created → Funded → Released`, plus the failure cases). Aim for full branch coverage. ~2 hours of test writing.
7. **Write `script/Deploy.s.sol`** — deploys SchemaRegistry, EAS, registers two schemas, deploys LegalEngagementEscrow. Writes addresses to `deployments/anvil.json`.
8. **Test the deploy:**
   ```bash
   anvil &
   forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 --broadcast
   ```
9. **Write `make demo-reset`** — kills anvil, restarts with `--dump-state state.json`, replays the deploy. Runtime under 10s.

You'll know phase 1 is done when `make demo-reset` runs cleanly and `cast call` against the escrow address reads back its constructor-set values.

### Phase 2 — SIWE + lawyer onboarding live (1 day)

Highest-risk subsystem because it's where the live OID4VP flow with wwWallet lives. Get it end-to-end before touching the client side.

1. **Scaffold the Next.js app.** Single app at `apps/platform/`. Install `@sd-jwt/sd-jwt-vc`, `@sd-jwt/core`, `@cef-ebsi/key-did-resolver`, `jose`, `viem`, `wagmi`, `@rainbow-me/rainbowkit`, `siwe`. Pass `--legacy-peer-deps` to npm if `@aztec/bb.js` peer-dep conflicts surface (round-8 finding).
2. **Build the EBSI library wrapper.** `src/lib/ebsi.ts` — copy the smoketest at `/tmp/ebsi-smoketest/roundtrip.mjs` as the literal starting point (verified working in round 7). Expose `issueCredential(payload, issuer)` and `verifyCredential(vcJwt)`.
3. **Build the EAS library.** `src/lib/eas.ts` — viem client connected to `http://localhost:8545`, reads addresses from `deployments/anvil.json`, exposes `attestLawyer(...)` and `attestClient(...)` functions.
4. **Build the SIWE flow.**
   - `GET /api/auth/nonce` returns a nonce.
   - Frontend wagmi `useSignMessage` constructs and signs the SIWE message.
   - `POST /api/auth/login` verifies signature, looks up profile, sets session cookie, returns `{ status, profile? }`.
5. **Build the seed scripts** in `scripts/seed-lawyer.ts` and `scripts/seed-client.ts`.
   - `seed-lawyer.ts`: spin up a temporary OID4VCI issuer endpoint with a fresh "bar" did:key, print the credential offer URL. Operator opens it in wwWallet to receive the LegalProfessionalAccreditation.
   - `seed-client.ts`: walk the operator through `https://issuer.eudiw.dev`'s PID issuance flow (typically just print instructions; the EU's hosted issuer handles the wallet interaction).
6. **Test wwWallet did:key acceptance** with `seed-lawyer.ts`. **Day-1 fork point.** If wwWallet rejects did:key, switch the seed script to use did:web and host a tiny `/.well-known/did.json`.
7. **Build the live OID4VP verifier.** `POST /api/onboarding/lawyer`:
   - Construct OID4VP request with two `input_descriptors` (PID + LegalProfAccreditation).
   - Return the wallet redirect URL (deep link or QR).
   - Implement the `direct_post` callback that wwWallet hits.
   - Validate both credentials in the VP; write two EAS attestations; persist profile.
8. **Build the SSE trace stream.** `/api/trace/[sessionId]/route.ts` — emits verification events. Frontend reads via `EventSource`.
9. **Build `/lawyer/onboard` page.** Connect button → SIWE → "Verify yourself" button → opens wwWallet → trace panel updates → redirect to dashboard.

You'll know Phase 2 is done when, with the lawyer's wwWallet seeded with both credentials, clicking through the onboarding UI lands two EAS attestations on chain and the dashboard shows both capabilities.

### Phase 3 — client onboarding + ZK at engagement-time (1 day)

Two pieces. Do them in order: client onboarding (PID-only OID4VP) first, ZK at engagement creation second.

**Client onboarding** (~half day):

1. **`POST /api/onboarding/client`** — same OID4VP pattern as the lawyer's, but with one `input_descriptor` for PID with selective disclosure of three fields.
2. **Validate with `@sd-jwt/sd-jwt-vc`** — verifies the SD-JWT VC signature against `issuer.eudiw.dev`'s x.509 chain.
3. **Write the EAS client attestation.**
4. **Build `/client/onboard` page.** Same shape as `/lawyer/onboard`, but only one credential requested.

**ZK conflict check at engagement** (~half day):

1. **Compile the circuit.** `circuits/conflict_check/src/main.nr` — copy from the spec. `nargo compile` produces `target/conflict_check.json`. Confirmed in round 7.
2. **Browser proof generation.** Install `@noir-lang/noir_js`. On `/engagement/[id]` page load, fetch the ACIR JSON, initialize the prover (the "prewarming"). Without prewarming, the first proof takes ~10s; with it, ~2.5s.
3. **`POST /api/engagements/preflight`** — given lawyer + client addresses, generate fresh salt, compute `prior_commitments[i] = pedersen_hash(prior_client_id[i], salt)` (use 8 hardcoded fake "prior clients" for the demo), return `{ priorCommitments, salt }`.
4. **`POST /api/engagements/verify-zk`** — verify the proof against the public inputs using `@noir-lang/noir_js`. Return boolean.
5. **Wire `/engagement/[id]` page.** On load → preflight → browser proof → verify-zk → enable "Create Engagement" button.

### Phase 4 — engagement page + MetaMask integration (half day)

1. **MetaMask via wagmi connectors.** `injected()` connector or rainbowkit's `<ConnectButton />`.
2. **Three buttons on `/engagement/[id]`** — Create (lawyer), Fund (client), Release (client). Each uses `useWriteContract` from wagmi.
3. **Each button triggers a real MetaMask popup** for the user to confirm. Status states: pending, confirming, confirmed, error.
4. **Render tx receipts inline** — block, gas used, tx hash. No basescan integration. Make it look like a forensic audit panel.
5. **Configure MetaMask per laptop.** Custom network "Anvil" (RPC `http://localhost:8545`, chain ID 31337), import a prefunded private key.
6. **End-to-end test:** lawyer + client both onboarded → engagement created via lawyer's MetaMask → funded via client's MetaMask → released via client's MetaMask. Check balances with `cast balance`.

### Phase 5 — side panel polish + rehearsal (half day)

1. **Make the side panel beautiful.** Round-6 Iteration D — the highest-leverage UX investment. If the trace looks janky, the crypto looks fake even when it's all real.
2. **Three distinct DIDs visible** in the trace — holder / issuer / verifier — so the audience can see they're not the same key.
3. **Run five timed rehearsals.** Cut anything that drags.
4. **Pre-warm both laptops' wwWallets** with the seed scripts; confirm credentials persist after browser restart.
5. **Record backup video** of the full 3-minute flow.
6. **Architecture and dual-stack closing slides** finalized.

## 11. Glossary

For quick reference. All terms are defined more fully in the sections above.

| Term | One-line definition |
|---|---|
| **anvil** | Local fake Ethereum node on your laptop. Part of Foundry. |
| **(Q)EAA** | (Qualified) Electronic Attestation of Attributes. EUDI ARF credential type for domain-specific claims like "I am a lawyer." |
| **ACIR** | Abstract Circuit Intermediate Representation. Compiled output of a Noir circuit. |
| **ARF** | Architecture and Reference Framework. The technical spec for the EUDI Wallet. |
| **attestation** | A signed claim that an address has some property. In our project, made via EAS on chain. |
| **DID** | Decentralized Identifier. A string identifying an entity, like `did:key:z2dm…`. |
| **did:key** | A DID method where the DID *is* a public key. No registry needed. |
| **did:ebsi** | A DID registered in EBSI's on-chain DID registry. We don't use this; would require institutional onboarding. |
| **EAS** | Ethereum Attestation Service. A pair of contracts (`SchemaRegistry`, `EAS`) for making on-chain attestations. |
| **EBSI** | European Blockchain Services Infrastructure. EU-run blockchain, hosts the Trusted Issuers Registry. |
| **eIDAS 2** | 2024 EU regulation mandating digital identity wallets across member states by end of 2026. |
| **ES256** | Cryptographic signature algorithm. Elliptic curve, P-256, SHA-256. What we sign JWTs with. |
| **EUDI Wallet** | The user-facing identity wallet mandated by eIDAS 2. Holds PID and (Q)EAA credentials. |
| **EVM** | Ethereum Virtual Machine. The bytecode VM that executes smart contracts. |
| **Foundry** | Solidity toolchain. Includes `forge`, `cast`, `anvil`. |
| **JWT** | JSON Web Token. `header.payload.signature` — three base64url-encoded pieces. |
| **JWT VC** | A JWT whose payload follows the W3C Verifiable Credential structure. |
| **L2** | "Layer 2." A scaling chain on top of Ethereum mainnet (Base, Arbitrum). For us: anvil in dev. |
| **Noir** | A ZK circuit DSL. Compiler is `nargo`. |
| **OID4VCI** | OpenID for Verifiable Credential Issuance. Protocol: issuer → wallet. |
| **OID4VP** | OpenID for Verifiable Presentations. Protocol: wallet → verifier. |
| **PID** | Person Identification Data. The government-identity credential in the EUDI Wallet. |
| **QTSP** | Qualified Trust Service Provider. Accredited entity authorized to issue qualified attestations under eIDAS. |
| **SD-JWT VC** | Selective Disclosure JWT VC. Lets the holder reveal only some fields of a credential. |
| **SIWE** | Sign-In with Ethereum. EIP-4361. The user signs a human-readable message in MetaMask; the platform verifies the signature and issues a session cookie. No gas. |
| **smart contract** | A program living at an address on a blockchain. State and code, both on chain. |
| **TIR** | Trusted Issuers Registry. EBSI's on-chain registry of authorized issuers. |
| **VC** | Verifiable Credential. Signed JSON in the W3C VC structure. JWT VC is one format. |
| **VP** | Verifiable Presentation. A JWT signed by the holder, wrapping one or more credentials. The holder's signature proves they currently control the holder key. |
| **capability profile** | Our internal model: one Ethereum address → set of capabilities (`verified_lawyer`, `verified_client`). Can hold both. |
| **MetaMask** | The Ethereum wallet our users connect for SIWE login and engagement transactions. Different from the credential wallet (wwWallet). |
| **wwWallet** | Browser-based EUDI wallet at `demo.wwwallet.org`. We use it as the lawyer/client *credential* wallet. Pre-staged with credentials before each demo run. |
| **ZK proof** | Zero-knowledge proof. Cryptographic proof of a statement that reveals nothing else. |
