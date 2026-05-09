# Project walkthrough — for someone new to blockchain and EU digital identity

Read this top to bottom on first pass. After that, use the table of contents as a reference.

The goal is to give you enough vocabulary and conceptual scaffolding to understand the spec at [12-spec-v3.md](12-spec-v3.md). Where I give an analogy I'll also state literally what's happening, because analogies leak.

This is the v3 walkthrough — same shape as v2, but with the wallet-integration spike's findings folded in. Anywhere you see "the spike validated this", that means it's running working code in [`spike/wallet-integration/`](../spike/wallet-integration/), not paper assertions.

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
- **Communication** between client and lawyer is end-to-end encrypted with keys derived from their wallet keys. The platform stores ciphertext blobs and signatures; it cannot decrypt the messages — not as a promise, but mathematically. Every message is hashed into a per-engagement Merkle tree whose root gets committed on chain at every milestone, so neither party can rewrite the conversation after the fact.
- **Money** flows through a small program on Ethereum (a "smart contract"), per **milestone** of the engagement. Milestone 0 is the initial consultation at the lawyer's posted rate. After that, the lawyer can propose follow-on milestones with concrete amounts; the client accepts and funds each; the lawyer signals delivery; the client releases. The program holds funds in escrow, releases 85% to the lawyer and keeps 15% for the platform when a milestone is released, refuses to act unless both parties have valid credentials on file, and parks the funds if either party flags a dispute.
- **Disputes are asymmetric, with an arbiter who has escrow authority only.** The client can dispute any `Funded` or `Delivered` milestone *immediately*. The lawyer can only escalate after a 30-day cooldown post-delivery — anti-harassment guardrail, contract-enforced. Both paths transition the milestone to `Disputed` and park the funds. An **arbiter** (single hardcoded address in the demo, multi-sig of accredited arbitrators in production) calls `resolveDispute(...)` to split the parked funds based on evidence the parties voluntarily submit. The arbiter has no decryption keys; the privilege boundary stays absolute. **Arbiters are themselves verified lawyers** (existing bar credential) who additionally hold a platform-issued `verified_arbiter` capability granted after manual review — domain expertise plus quality control. The platform itself isn't the arbiter; conflict-of-interest is structural. Either party submits their decrypted messages + Merkle proofs as evidence; non-cooperation = default loss by arbiter discretion (same as civil arbitration). **Identity unsealing is not in scope** — the arbiter cannot break pseudonymity. For fraud/regulator escalation, production adds a separate Tier 3.5 mechanism (threshold-encrypted PID blob, court-order-gated decryption); slide-only here.

For the hackathon: everything runs on a fake Ethereum on your laptop ("anvil"), both the lawyer credential and the client PID are signed by our stand-in issuer (in production: the bar association and the member-state PID provider, both via EBSI's Trusted Issuers Registry), and everything else is real EU infrastructure or real cryptography.

The pitch: today there's no middle ground between "anonymous Q&A on Reddit" and "fully-disclosed traditional firm engagement." We're inventing it. **Verified pseudonymous engagement** — a product category that didn't exist 18 months ago. The EU built the credential infrastructure; we're building the marketplace on top of it.

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

**Concrete example for us (the actual SD-JWT VC payload from the spike, slightly trimmed):**

```json
{
  "iss": "https://<our-issuer>.ngrok-free.dev/issuer",
  "iat": 1778018097,
  "exp": 2093378097,
  "vct": "urn:lex-nova:LegalProfessionalAccreditation",
  "cnf": { "jwk": { "crv": "P-256", "kty": "EC", "x": "…", "y": "…" } },
  "given_name": "Anna",
  "family_name": "Schmidt",
  "jurisdiction": "DE",
  "bar_admission_date": "2018-09-15",
  "bar_admission_number": "RAK-Muenchen-2018-04321",
  "valid_until": "2036-05-02"
}
```

This payload, wrapped as an SD-JWT VC and signed with our backend's did:key private key (header `typ: dc+sd-jwt`, alg `ES256`), is the lawyer's credential. The library `@sd-jwt/sd-jwt-vc` produces this — we use the SD-JWT VC format (`vc+sd-jwt`) rather than W3C JWT VC because that's what wwWallet's OID4VCI consume code accepts (round-9 source review, validated by the spike). The format also matches what eIDAS 2 mandates for QEAA professional credentials, so the production trajectory is built in.

In SD-JWT VC, the *selectively-disclosable* claims — every claim except `iss`, `iat`, `exp`, `vct`, `cnf` — get hashed at issuance and only revealed when the holder explicitly chooses to disclose them at presentation time. We dropped `specialty` from the claim list after a domain check: bar associations don't certify free-form practice areas, only formal *Fachanwalt* designations; lawyers self-declare specialties on the platform profile instead. The `cnf.jwk` field binds the credential to the holder's wallet key.

The PID payload is parallel: `vct: "urn:eudi:pid:1"`, EUDI ARF claim names (`given_name`, `family_name`, `birthdate`, `nationalities`, `address`, `age_equal_or_over.18`, etc.). Same library, same protocol, different `vct`. Both credential kinds are issued by the same stand-in service in our spike — in production these are different issuers (a bar association and a member-state PID provider), but the verifier's cryptographic check is identical regardless.

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

- **`SchemaRegistry`** — register the shape of an attestation (e.g. "address recipient, string jurisdiction, string barAdmissionDate"). Returns a `bytes32` schema UID.
- **`EAS`** — make an actual attestation against a registered schema. The attester says "I attest that `recipient` has these `data` per `schemaUID`."

When our backend successfully verifies a lawyer's credential, it makes an EAS attestation: "0xabc…123 (this Ethereum address) is a verified lawyer with jurisdiction=DE, admitted on 2018-09-15." That attestation is now public on chain, with the attester (us) cryptographically signed.

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

**For us, we use OID4VCI off-stage via a long-running stand-in issuer service.** Before each demo, the operator opens our issuer's web UI, picks a persona (Anna Schmidt for the lawyer, John Doe for the client), and clicks one button per credential. wwWallet does the OID4VCI dance with our issuer — pre-authorized code grant, DPoP, batch issuance of 5 credential instances per credential type for unlinkability — and the credential lands in wwWallet's IndexedDB at `demo.wwwallet.org`'s origin. The same issuer process serves both the bar credential (vct `urn:lex-nova:LegalProfessionalAccreditation`) and the PID (vct `urn:eudi:pid:1`). Why one issuer for both: spike validation showed eudiw.dev's hosted PID issuer is incompatible with wwWallet (RFC 9207 strict iss mismatch); building our own stand-in gave us full control and a payload that's protocol-indistinguishable from a real PID. The full working code is at [`spike/wallet-integration/issuer.mjs`](../spike/wallet-integration/issuer.mjs). We don't show OID4VCI live on stage; the credentials are pre-staged.

### 8b. OID4VP (OpenID for Verifiable Presentations)

**Purpose:** wallet → verifier. "Hi verifier, here's the credential you asked for."

**Flow:**
1. Verifier sends a **presentation request** to the wallet, specifying which credentials it wants and (for SD-JWT VC) which fields it wants disclosed.
2. Wallet shows the user "verifier X is asking for fields Y, Z. Approve?"
3. User approves; wallet sends a **verifiable presentation** (essentially: the credential, plus a fresh signature by the holder proving they currently hold the credential, plus selective disclosures).
4. Verifier verifies signatures, checks selective disclosures, extracts the disclosed fields.

**For us, OID4VP runs live on stage when Marta engages.** The mechanism is **DCQL** (Digital Credentials Query Language) — wwWallet ignores the older `presentation_definition` shape, so DCQL is the only path. The query for the bar credential filters by `vct=urn:lex-nova:LegalProfessionalAccreditation` and asks for `given_name`, `family_name`, `jurisdiction`, `bar_admission_date`, `valid_until`. The PID query filters by `vct=urn:eudi:pid:1` and asks for `given_name`, `family_name`, `nationalities`, `age_equal_or_over.18`, `address.country`. The wwWallet popup shows what's being requested; the user approves; a `direct_post` callback delivers a `vp_token` containing the SD-JWT VC with the disclosed claims unhashed. Our verifier validates the issuer signature, the holder binding, and the disclosure proofs, then writes EAS attestations.

In the demo, **Anna's bar credential + PID OID4VP runs off-stage during pre-show** (we don't burn stage time on a flow we already know works); **Marta's PID OID4VP runs live** when she clicks "Engage Anna" on the find-lawyer page (lazy authentication — only when needed). The full working code for both flows is at [`spike/wallet-integration/verifier.mjs`](../spike/wallet-integration/verifier.mjs); the spike validates the entire flow against real wwWallet.

### 8c. Selective disclosure (SD-JWT)

The PID a client presents has lots of fields: name, ID number, date of birth, photo, address, nationality, etc. **Selective disclosure** means the wallet can prove "the issuer signed this credential and it has `nationalities=["DE"]`, `age_equal_or_over.18=true`" *without* revealing the rest.

The format that supports this is **SD-JWT VC** (Selective Disclosure JWT VC). Different from a plain JWT VC. Our stand-in issuer produces SD-JWT VCs in the same shape that real EU PID providers use — every claim is independently disclosable, including nested ones (`address.country` separate from `address.locality`, `age_equal_or_over.18` separate from `.21`).

**For us:** when verifying the client PID we ask only for `given_name`, `family_name`, `nationalities`, `age_equal_or_over.18`, `address.country`. We never see birthdate, full address, document number, phone, email, or any other claim in the credential. That's what makes the client pseudonymous to the platform — we can prove they're a real human without knowing the rest.

### 8d. SIWE (Sign-In with Ethereum)

A separate auth primitive, layered on top of MetaMask. Specified in EIP-4361. Plain-English: the user clicks "Connect Wallet," MetaMask shows them a human-readable message ("lex-nova.local wants you to sign in with your Ethereum account 0xf39F…"), the user signs it (no gas — just a message signature), the platform verifies the signature recovers to the claimed address, then issues a session cookie.

**For us:** SIWE is the entry point at *landing*, not at engagement time. The landing page has one button — Connect Wallet. Click it, sign the SIWE message, and the platform either recognizes the address (returning user → `/dashboard`) or doesn't (new user → `/onboard` for PID verification → `/dashboard`). Linear funnel, verify-once-use-everywhere, matches Web3 UX expectations. The matter form lives on the dashboard, post-auth — only authenticated users can post matters.

The SIWE address is **the platform-level identity that links the two distinct holder JWK thumbprints** (one from PID issuance, a different one if the user later adds a bar credential too) into a single user. The wallet keys never see each other; the address ties them together. This is also why "Become a verified lawyer →" works as an additive capability: same SIWE address, additional EAS attestation, additional capability.

The user has *two* wallets total in our system: **MetaMask** for SIWE login + signing on-chain transactions (engagement creation, milestone fund/release/dispute), and **wwWallet** for holding and presenting verifiable credentials AND for deriving the per-engagement messaging session keys. Different roles, different keys, both load-bearing.

### 8e. E2EE messaging — privilege as cryptography

The lawyer-client thread is the heart of the product. It's where the actual legal work happens. The platform must be **cryptographically blind** to message content — not just contractually-promised blind, but mathematically unable to read.

**How it works:**

- Each engagement gets a **per-engagement session key** derived client-side from a Diffie-Hellman between the two parties' PID-side `cnf.jwk`s. Both wallets already control their PID holder keys (proven during the OID4VP onboarding); using them for messaging keying costs us nothing extra. The DH happens entirely in each browser; the resulting AES-GCM key never touches the server.
- Messages are encrypted with this session key in the browser before they leave. Each message gets signed by the sender's wallet holder key (non-repudiation). The server stores `{ ciphertext, sender_signature, sender_thumbprint, timestamp }`. The server has no decryption key and no path to one.
- Each message contributes a leaf to a **per-engagement Merkle transcript**: `messageHash = sha256(ciphertext || sig || timestamp)`. The running root is recomputed locally as messages flow.
- At every milestone fund/release event, the current `transcriptRoot` is included as a parameter to the contract call. The contract updates `engagement.transcriptRoot` on chain. This means: after milestone N is settled, the entire conversation up to that point is locked. Either party can prove "this exact message was sent" by revealing the message + its Merkle path — the chain confirms it was part of this engagement at this time. Neither party can plant or rewrite a message after the fact.

**What this earns:**

- **Attorney-client privilege as a cryptographic property** — not a contractual promise. If we get subpoenaed for content, we hand over an unreadable blob.
- **Tamper-evident audit trail** — the on-chain transcript root + per-message signatures give arbitrators (Tier 3) a complete, verifiable record they can act on without the platform's cooperation.
- **No platform metadata leak path that traditional email or Signal don't already have** — the platform sees who's messaging whom and when, but in production this gets pushed to XMTP and even that goes away.

**Demo vs production:** the demo uses an encrypted-localStorage stub for transport (server stores ciphertext; same crypto otherwise). Production swaps in **XMTP** (MLS-based E2EE messaging substrate) — same crypto shape, decentralized message storage, no platform-stored ciphertext at all. The on-chain transcript root commitment pattern stays identical. Slide-deck framing on stage: "the demo's localStorage transport is the only piece that changes between demo and production; everything you can see — privilege, signatures, root commitments — is identical."

### 8f. Milestone-based engagement with asymmetric dispute rights

Real legal work doesn't price as one number upfront. The lawyer needs to scope first; the client needs to know what each piece costs. And dispute rights need to mirror dispute stakes — symmetric rights would let the lawyer weaponize the unsealing threat.

**The happy path:**

1. **Milestone 0 = initial consultation** at the lawyer's posted rate. Created when the engagement is created (on `createEngagement`); status `Proposed`.
2. **Client accepts and funds** milestone 0 by calling `acceptAndFundMilestone(0, 0)` payable. Milestone 0 transitions `Proposed → Funded`. ETH is locked in escrow.
3. **Lawyer delivers** the consultation (off-chain, via the E2EE chat). When done, lawyer calls `markDelivered(engagementId, milestoneIndex)` to signal completion. Status: `Funded → Delivered`. This stamps a `deliveredAt` timestamp on chain — important for the dispute cooldown below.
4. **Either it resolves** or the lawyer scopes follow-on work via `proposeMilestone(engagementId, descriptionHash, amount)`. New milestone appended in `Proposed` state.
5. **Client decides:** if the quote works, fund it; if not, walk away.
6. **Lawyer delivers, client releases** via `releaseMilestone(engagementId, milestoneIndex, transcriptRoot)`. 85% to lawyer, 15% to platform. Status: `Delivered → Released`.

**The dispute paths — asymmetric:**

- **Client dispute (`disputeMilestone`)** — client can call this on any `Funded` or `Delivered` milestone, **immediately, no cooldown**. Disputing locks the client's own funded amount, which is a self-imposed cost; limited harassment potential.
- **Lawyer escalation (`escalateMilestone`)** — lawyer can call this only on a `Delivered` milestone, only after `block.timestamp >= deliveredAt + LAWYER_DISPUTE_COOLDOWN` (30 days production, 30 seconds in the demo deploy). Reverts otherwise. The cooldown is the contract-level guardrail against "pay me or I drag you into arbitration tomorrow" coercion: even though the arbiter has no decryption keys (so dispute itself doesn't break pseudonymity), being on the receiving end of a complaint is costly — evidence prep, attention overhead, reputational tax. The 30-day wait makes that lever cost the lawyer 30 days of patience, separating real grievances from extraction tools.

Both paths transition the milestone to `Disputed` and park its funds. From there:

**Arbiter resolution (`resolveDispute`)** — the arbiter has **escrow authority only**. They call `resolveDispute(engagementId, milestoneIndex, amountToLawyer, amountToClient)` to split the parked funds. Status: `Disputed → Resolved`. The arbiter has no decryption keys, no path to unsealing identity. The privilege boundary stays absolute even during arbitration.

**Who can be an arbiter.** In v3 the contract has a single hardcoded `ARBITER` address. In production it becomes an EAS lookup — `onlyArbiter` checks that `msg.sender` has a non-revoked `verified_arbiter` attestation under the platform's signing key. The platform issues `verified_arbiter` *only* to addresses that already hold `verified_lawyer` (i.e. they've already presented a valid bar credential), and *only* after manual platform review (legal background, arbitration experience, conflict-of-interest disclosures, institutional memberships like CEPANI/DIS/ICC). Three reasons for this composition:

- **Domain expertise** — disputes about whether legal work was scoped properly need legal training; non-lawyers shouldn't rule on lawyer-quality questions.
- **Regulatory clean-room** — if the platform itself were the arbiter, it would be providing legal services (restricted under BRAO and equivalents); putting arbitration into the hands of credentialed lawyers preserves the Stripe-equivalent payment-rails framing.
- **Conflict-of-interest separation** — the platform takes 15% on releases. If the platform also rules on releases, there's a structural bias. Arbiters are *separate* from the platform.

The pattern composes elegantly with the additive-capability model: a single Ethereum address can hold `[verified_client, verified_lawyer, verified_arbiter]` simultaneously, with attestations stamped at different times by different ceremonies. **For the demo: Eva Novák (CZ) is the arbiter** — she's a verified lawyer (so the production "must be a credentialed legal professional" requirement is satisfied by reuse), CZ-jurisdiction in a demo focused on a DE engagement (no conflict of interest with Anna ↔ Marta). Her profile carries all three capabilities.

**Evidence flow** — either party voluntarily decrypts the messages they want the arbiter to see and submits them off-chain (via a "Submit evidence" panel on the engagement page). The bundle includes plaintext + Merkle path + sender signature for each message; the arbiter verifies each Merkle path against the engagement's on-chain `transcriptRoot` and each signature against the relevant party's wallet. Anything that doesn't verify is rejected. Selective disclosure is bounded — the other party can submit messages the first party omitted. Non-cooperation = default loss by arbiter discretion, same as civil arbitration.

**Why asymmetric:**

The asymmetry is structural. Even with an arbiter who can't see anything, dispute itself is costly: prep, attention, reputational tax. Encoding the asymmetry in the contract (rather than in social norms or platform policy) means it's enforced regardless of who runs the platform later. The 30-day cooldown is the simplest possible mechanism: a lawyer who's actually been wronged can wait 30 days; a lawyer trying to use arbitration as a payment-extraction tool can't use the threat instantly.

**Identity unsealing — explicitly out of scope.** The arbiter cannot break client pseudonymity in v3, on purpose. Production adds a separate Tier 3.5 mechanism (threshold-encrypted PID blob, court-order-gated decryption) for fraud/regulator/AML escalation; that's a separate engineering effort and intentionally not part of v3. Slide-only.

**Why this shape overall:**

- Matches how real lawyers bill (initial consult → quote → execution, often iterative).
- Gives clients pricing certainty per scope of work — no surprise scope creep.
- Gives lawyers protection — they don't do unscoped work for free, AND they have a path to recourse when stiffed (after the cooldown).
- Gives clients protection — pseudonymity can't be used as a coercion lever against them.
- Gives Tier 3 a clean unit of dispute: "milestone 2 of engagement #0," not "the whole engagement."
- Take rate applies per release, so the platform earns when work actually happens.

**For the demo:** anvil supports `evm_increaseTime`, so we can demonstrate the cooldown enforcement live — lawyer clicks Escalate too early, contract reverts, operator runs `cast rpc evm_increaseTime 30`, lawyer clicks again, success. Audience sees the guardrail enforce itself in real time.

**Foundry tests** cover happy path + both dispute paths + cooldown-revert + cooldown-success + auth checks. ~5 hours of test writing.

## 9. The full flow in this project

Here's the entire flow end to end. Match each step to the components introduced above.

### Phase 0 — pre-stage (off-stage, before demo)

1. **Anvil + contracts.** Anvil starts. Foundry deploy script runs: deploys `SchemaRegistry`, then `EAS(SchemaRegistry)`, then registers three schemas (lawyer / client / engagement), then deploys `LegalEngagementEscrow`. All addresses written to `deployments/anvil.json`. `anvil --dump-state state.json` captures the post-deploy state.
2. **Single Next.js app up.** Run `pnpm dev` from the repo root and `ngrok http --domain=<reserved> 3000`. The Next.js process serves the issuer (under `/api/issuer/*`), the verifier (under `/api/verifier/*`), the messaging endpoints (under `/api/engagements/[id]/messages/*`), the platform UI, the operator UI, and the SIWE/SSE plumbing — all from one process behind one ngrok tunnel.
3. **Issuer keys persisted.** On first boot the issuer generates a fresh did:key + ES256 keypair and writes it to `.lex-nova-keys/issuer.jwk`. Subsequent boots read the same key, so credentials issued today survive a restart tomorrow.
4. **Anna's wwWallet seeded** via the operator UI at `/operator/issue`. Pick "Anna Schmidt" from the bar-credential dropdown → click → wwWallet runs the OID4VCI dance, batch-issues 5 instances. Same persona from the PID dropdown.
5. **Anna's platform onboarding done off-stage.** Anna runs through Marta's exact flow once: Connect Wallet → SIWE → `/onboard` → PID OID4VP → `/dashboard` shows `[verified_client]`. Then she clicks "Become a verified lawyer →" on the dashboard → bar credential OID4VP → profile gains `[verified_lawyer]`. Same SIWE address, additive capability. Posted-rate-card filled in. **This whole step happens before the demo starts; the audience never sees it. The story we tell on stage is "Anna joined Lex Nova last month and added her bar credential."**
6. **Marta's wwWallet seeded** the same way: PID dropdown → "John Doe (US/GR)" persona (we narrate as "Marta" on stage; the PID claims work for the Marta narrative since it's a US-resident dual-national, fitting the cross-border-matching wedge).
7. **Eva Novák onboarded with `verified_arbiter` capability.** Eva runs through the same SIWE → `/onboard` (PID OID4VP) → "Become a verified lawyer" (bar OID4VP) flow as Anna and the others. After that, the platform operator writes one additional EAS attestation under her address: `verified_arbiter`. Her profile now carries `[verified_client, verified_lawyer, verified_arbiter]` — three attestations, one Ethereum address. This is the live demonstration of the additive-capability model on a single address.
8. **Two pre-staged engagements** for the Tier 3 dispute beat, both with **Anna as the lawyer**:
   - **Engagement #1** — Lukas (#2, exercising his `verified_client` capability) ↔ Anna. Lukas will dispute on stage.
   - **Engagement #2** — Marco (#4) ↔ Anna. Anna will escalate after the time-warp.
   Both at milestone 0 in `Delivered` state, with a few pre-loaded encrypted messages. Engagement #2 has a pre-submitted evidence bundle from Anna's side so the arbiter dashboard renders something visibly real.
9. **Marta does NOT have a platform profile yet.** She's never visited `lex-nova.local`. Stage state at curtain: empty platform DB for Marta, Anna + Lukas + Sophie + Marco + Eva all pre-onboarded, two pre-staged engagements ready for the dispute beat.

### Phase 1 — Marta's journey (live on stage)

This is the heart of the demo. Single protagonist, one continuous flow with the auth ceremony front-and-center.

1. Marta lands on `lex-nova.local/`. Hero text + a single **Connect Wallet** button. No matter form yet — that lives on the dashboard, post-auth. She clicks Connect.
2. **MetaMask popup**: SIWE message — sign (~3s, no gas). Backend looks up Marta's Ethereum address: not found. Set session cookie, redirect to `/onboard`.
3. `/onboard` page: "Verify you're a real EU resident" → click Verify → backend constructs an OID4VP DCQL request for PID with selective disclosure of `given_name`, `family_name`, `nationalities`, `age_equal_or_over.18`, `address.country`.
4. wwWallet popup, Marta approves. SD-JWT VP comes back; verifier validates issuer signature (via `@cef-ebsi/key-did-resolver`), holder binding (via `cnf.jwk` thumbprint), selective disclosure proofs. Backend writes a client-schema EAS attestation under Marta's Ethereum address. Profile persisted with `[verified_client]`. Page redirects to `/dashboard`.
5. `/dashboard` shows: matter form, "Become a verified lawyer →" affordance (Marta won't click it), active engagements (none yet). Marta types her matter ("Setting up a GmbH in Bavaria, 25k starting capital, Spanish national, not yet German-resident"), picks Germany, clicks **Find a lawyer →**.
6. The matter goes into the SQLite `matters` table with a fresh `matterId`. She gets routed to `/find-lawyer?matterId=...`.
7. `/find-lawyer` renders profile cards for `verified_lawyer` profiles filtered by jurisdiction. Each card shows **only attested fields** — name, RAK + admission date, jurisdiction, plus the lawyer's posted initial-consultation rate. No testimonials, no "satisfied clients," no LinkedIn fluff. Marta clicks **Engage Anna →**.
8. `/engagement/new` shows: the matter, Anna's attested profile, the initial consultation fee. Marta is already authenticated and verified; the only thing left is the contract dance. She clicks **Confirm and engage**.
9. **ZK conflict check** runs. Frontend hits `/api/engagements/preflight`. Backend generates a fresh salt, computes `prior_commitments[i] = pedersen_hash(prior_client_id[i], salt)` over 8 hardcoded fake prior clients of Anna's. Browser computes `client_secret = pedersen_hash([hash(nationalities[0]), hash(address.country), age_over_18 ? 1 : 0, holder_jwk_thumbprint])`, generates the Noir proof in ~2.3s. Backend verifies. Proof valid.
10. **Engagement created on chain.** Backend submits `createEngagement(...)` with milestone 0 in `Proposed` state. Engagement #0 lives on chain.
11. Page transitions to `/engagement/0`: matter at top, Anna's profile card, empty chat panel, milestone panel with milestone 0 visible. Marta clicks **Accept & fund 0.01 ETH** → MetaMask → confirm (~4s). `acceptAndFundMilestone(0, 0)` runs; milestone 0 transitions `Proposed → Funded`; ETH is locked in escrow.
12. **E2EE chat begins.** Marta types a follow-up question. Browser derives the session key client-side from ECDH between her PID-side `cnf.jwk` and Anna's PID-side `cnf.jwk`. AES-GCM encrypts; Marta's wallet signs; server stores `{ ciphertext, sig }`. Server cannot decrypt, no key material exists on the server.
13. Anna's `/lawyer/dashboard` Inbox shows the new engagement. She opens it, decrypts client-side, replies. Same pattern.
14. **Anna marks delivered.** She clicks `markDelivered(engagementId=0, milestoneIndex=0)` → MetaMask → confirm. Milestone status: `Funded → Delivered`. `deliveredAt` timestamp recorded on chain — this starts the lawyer's escalation cooldown clock (irrelevant on the happy path).
15. **Milestone release.** Marta is satisfied; clicks Release milestone 0. Browser passes the running transcript root to `releaseMilestone(0, 0, transcriptRoot)`. Contract pays Anna 0.0085 ETH (85%) and the treasury 0.0015 ETH (15%); milestone 0 transitions `Delivered → Released`; the engagement EAS attestation gets updated with the new `transcriptRoot`. The conversation is now locked on chain — neither party can revise it.

End-to-end runtime on anvil with prewarmed state and pre-staged credentials: ~2:30 for steps 1–15. The ZK proof and four MetaMask popups (SIWE + accept&fund + markDelivered + release) are the largest time costs.

### Phase 2 — Tier 3 dispute beats + arbiter resolution (demonstrated)

Three short beats showing the asymmetric dispute paths and the arbiter's escrow-only authority. ~75 seconds on stage. We use pre-staged engagements (#1 and #2) so we don't have to set up a fresh fund-and-deliver cycle.

**Beat 1 — Client dispute (immediate).** Switch to **Lukas's tab** showing engagement #1 in `Delivered` state. Lukas is one of our verified lawyers but here he's exercising his `verified_client` capability (the "lawyer hires another lawyer" pattern in action). He clicks **Dispute milestone** → MetaMask → confirm. `disputeMilestone(1, 0)` runs; milestone status: `Delivered → Disputed`. Funds park. No cooldown — the client is the funder of the locked amount, so the harassment vector is bounded.

**Beat 2 — Lawyer escalation (cooldown-gated).** Switch to **Anna's tab** showing engagement #2 (Anna ↔ Marco) in `Delivered` state, where Anna has been waiting on payment. The Escalate button is visible to Anna but **shows a live countdown** — "Available in 25s" (the demo deploy uses a 30-second cooldown). Anna clicks Escalate too early — MetaMask submits — contract reverts with `LawyerCooldownNotElapsed(deliveredAt, requiredAt, now)`. Operator runs `cast rpc evm_increaseTime 30 && cast rpc evm_mine` to fast-forward anvil's clock. Anna clicks Escalate again — success. `escalateMilestone(2, 0)` runs; milestone status: `Delivered → Disputed`. Funds park.

The audience sees the contract enforce the asymmetric guardrail in real time. Production tightens the cooldown to 30 days; the mechanism is identical.

**Beat 3 — Evidence submission and arbiter resolution.** Anna clicks **Submit evidence to arbiter** on engagement #2. Modal shows all decrypted messages from the engagement; she selects three and clicks Send. The bundle (plaintext + Merkle path + sig per message) gets POSTed to the arbiter's inbox. Operator switches to **Eva's tab** (`/arbiter/dashboard` — gated to addresses holding `verified_arbiter`). The page shows the dispute with the lawyer's evidence verified (Merkle paths resolve to engagement #2's on-chain transcriptRoot, signatures check out) and Marco's submission empty. Eva chooses to rule in the lawyer's favor (since the client didn't engage), enters `0.05 ETH → lawyer / 0 → client`, clicks Resolve. MetaMask → confirm. `resolveDispute(2, 0, 0.0425, 0)` runs; milestone status: `Disputed → Resolved`; lawyer gets 0.0425 ETH, treasury 0.0075 (15%), client refunded 0. The audience sees the arbiter's authority is *only* over fund splits — the arbiter dashboard never showed any decrypted message that the lawyer didn't choose to reveal.

The "Eva is also a verified lawyer" framing is worth narrating once during this beat: she carries three EAS attestations (`verified_client`, `verified_lawyer`, `verified_arbiter`) under a single Ethereum address. The arbiter pool is drawn from credentialed lawyers, vetted by the platform; the platform itself doesn't arbitrate.

**In production:** the arbiter is a multi-sig of accredited arbitrators (themselves carrying EBSI credentials — same primitive as our lawyers), with selection from a Kleros-style jury pool to prevent capture. Production also adds a separate Tier 3.5 mechanism for identity unsealing (threshold-encrypted PID blob, court-order-gated decryption) that's not in v3.

The point: Tier 3 is three contract functions (`disputeMilestone`, `escalateMilestone`, `resolveDispute`) with defined transitions, asymmetric trigger rights, contract-enforced cooldown, and an arbiter who has escrow authority only. The audit trail (signed messages + on-chain transcript root) is what makes the arbiter's job possible. The arbitration multi-sig + identity-escrow are production additions; the cryptographic foundation they ride on is what we built today.

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

# Reachability — only wwWallet is hosted; both issuer and verifier
# now live in our own services (lifted from the spike), exposed via ngrok.
curl -I https://demo.wwwallet.org
ngrok version    # we use ngrok to expose issuer + verifier publicly
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

### Phase 2 — eager auth + onboarding + dashboard (1 day)

The OID4VP flow with wwWallet was the highest-risk subsystem in the v2 plan. **The wallet-integration spike de-risked it entirely** — there's working code at [`spike/wallet-integration/`](../spike/wallet-integration/). Phase 2 is now mostly porting the spike into Next.js Route Handlers, plus building the eager-auth landing flow.

1. **Scaffold the Next.js app.** Single app at the repo root. Install `@sd-jwt/sd-jwt-vc`, `@sd-jwt/core`, `@cef-ebsi/key-did-resolver`, `jose`, `viem`, `wagmi`, `@rainbow-me/rainbowkit`, `siwe`, `better-sqlite3`. Pass `--legacy-peer-deps` to npm if `@aztec/bb.js` peer-dep conflicts surface.
2. **Port the spike inline.** Copy `spike/wallet-integration/issuer.mjs` and `verifier.mjs` into Next.js Route Handlers under `app/api/issuer/*` and `app/api/verifier/*`.
3. **Disk-persist the keys.** Generate the issuer's did:key and the verifier's RSA cert on first boot, write them to `.lex-nova-keys/`, read them on subsequent boots. Without this, Next.js dev's hot-reload regenerates everything on every save and breaks every credential already in wwWallet.
4. **Build the EAS library.** `src/lib/eas.ts` — viem client connected to `http://localhost:8545`, reads addresses from `deployments/anvil.json`, exposes `attestLawyer(...)`, `attestClient(...)`, `attestEngagement(...)` functions.
5. **Build the SIWE flow** (`/api/auth/nonce`, `/api/auth/login`).
6. **Build `/` (landing) page** — hero + Connect Wallet button. Click triggers SIWE; backend looks up the address and routes to `/dashboard` (recognized) or `/onboard` (not).
7. **Build `/onboard` page** — PID OID4VP via DCQL → EAS client attestation under the SIWE address → profile persisted with `[verified_client]` → `/dashboard`.
8. **Build `/dashboard` page** — matter form, "Become a verified lawyer →" affordance, active engagements list. Lawyer-side sections (Inbox, posted-rate-card editor) appear conditionally if `verified_lawyer` capability is present.
9. **Wire "Become a verified lawyer →"** — triggers the bar-credential OID4VP, writes the EAS lawyer attestation under the same SIWE address, profile gains `verified_lawyer`. Idempotent — same address, additive capabilities.
10. **Pre-stage Anna off-stage** via the same flow Marta will use on stage, plus the "Become a verified lawyer →" click.

You'll know Phase 2 is done when Anna is pre-onboarded with `[verified_client, verified_lawyer]` and Marta can land on `/`, click Connect Wallet, complete SIWE + PID OID4VP, and arrive on `/dashboard` with `[verified_client]`.

### Phase 3 — matter form + find-lawyer + ZK + milestone contract (1 day)

The contract is more surface than v2's single-amount escrow (per-milestone state machine with **asymmetric dispute logic**), and the matter posting moves to the dashboard now that auth is eager.

1. **Matter form on `/dashboard`** — writes a `matters` row, redirects to `/find-lawyer?matterId=…`.
2. **Build `/find-lawyer`** — query verified lawyers, filter by jurisdiction, render attestation-only profile cards.
3. **Compile the Noir circuit.** `circuits/conflict_check/src/main.nr` → `target/conflict_check.json`.
4. **Browser proof generation.** Install `@noir-lang/noir_js`. Prewarm the prover on `/find-lawyer` page load.
5. **`POST /api/engagements/preflight`** — generate fresh salt, compute prior commitments, return them.
6. **`POST /api/engagements/verify-zk`** — verify the proof.
7. **Write the milestone-based escrow contract** with **asymmetric dispute logic**:
   - `createEngagement` with milestone 0 in `Proposed`
   - `proposeMilestone`, `acceptAndFundMilestone`, `markDelivered`, `releaseMilestone`
   - `disputeMilestone` — client-only, no cooldown; allowed on `Funded` or `Delivered`
   - `escalateMilestone` — lawyer-only, requires `block.timestamp >= deliveredAt + LAWYER_DISPUTE_COOLDOWN`
   - `LAWYER_DISPUTE_COOLDOWN` immutable constructor param: `30 days` for prod, `30 seconds` for the demo deploy
   - Foundry tests cover happy path, both dispute paths, cooldown-revert, cooldown-success, auth checks
8. **Wire the contract** via wagmi `useWriteContract` for each function. Each renders an inline tx receipt.
9. **Build `/engagement/new`** — confirmation page: matter, lawyer profile, milestone 0 fee. Click → ZK conflict check → `createEngagement(...)` → `/engagement/[id]`.
10. **Build `/engagement/[id]`** — matter at top, milestone panel at bottom with role-appropriate buttons. Lawyer-side: `proposeMilestone`, `markDelivered`, `escalateMilestone` (with live cooldown countdown if applicable). Client-side: `acceptAndFundMilestone`, `releaseMilestone`, `disputeMilestone`.

You'll know Phase 3 is done when Marta can post a matter, browse to Anna, engage (ZK + contract call), see milestone 0 funded, see Anna `markDelivered`, release the milestone, AND you can write a forge test that demonstrates `escalateMilestone` reverting before the cooldown and succeeding after.

### Phase 4 — E2EE messaging + Tier 3 dispute paths + arbiter resolution (1 day)

The messaging layer is the concrete payoff for the privilege story. The Tier 3 beats are short but visceral, and the arbiter resolution closes the loop.

1. **Build `lib/messaging.ts`** — per-engagement session key derivation via WebCrypto ECDH (P-256) between the two parties' PID-side `cnf.jwk`s; AES-GCM encryption; ECDSA signatures over each ciphertext.
2. **Build `lib/transcript.ts`** — Merkle tree over message hashes, root computation; commit root to the contract on every milestone fund/release tx.
3. **Build `app/api/engagements/[id]/messages/route.ts`** — `GET` returns ciphertext blobs + signatures (paginated); `POST` accepts ciphertext + signature, computes `messageHash`, stores. Server never decrypts.
4. **Build `<ChatPanel>`** for `/engagement/[id]` — composer, message log, decryption client-side.
5. **Wire both dispute paths** in `<MilestonePanel>`:
   - Client side: Dispute button visible on `Funded` and `Delivered` milestones; calls `disputeMilestone` via wagmi.
   - Lawyer side: Escalate button visible on `Delivered` milestones; computes the cooldown-elapsed timestamp client-side and renders a countdown when not yet elapsed; calls `escalateMilestone` when elapsed.
6. **Build the evidence flow:**
   - `<EvidencePanel>` on `/engagement/[id]` — visible to both parties on `Disputed` milestones; lets them pick decrypted messages to submit; bundles `[{plaintext, sig, merklePath}]`; POSTs to `/api/engagements/[id]/evidence`.
   - `app/api/engagements/[id]/evidence/route.ts` — receives bundles, stores in SQLite for arbiter inbox.
7. **Build `/arbiter/dashboard`** — restricted page authenticated against the hardcoded `ARBITER` address; shows disputed engagements with their evidence inboxes; verifies each Merkle path against on-chain `transcriptRoot` and each signature against the relevant party's wallet on load (anything that doesn't verify is flagged red); `<ResolveForm>` for entering the split; calls `resolveDispute` via wagmi.
8. **Pre-stage two demo engagements** (#1 client-disputed, #2 lawyer-escalated-after-time-warp) so the dispute beats don't require setting up a fresh fund-and-deliver cycle on stage. Engagement #2 should also have at least one pre-submitted evidence bundle from the lawyer side (Anna's submission) so the arbiter dashboard has something visibly real.
9. **Practice the cooldown beat** with `cast rpc evm_increaseTime 30 && cast rpc evm_mine` — make sure the contract reverts cleanly before time-warp and succeeds cleanly after, with revert reasons rendering nicely in the side panel.
10. **Render the Tier 3 closing slide** explaining the arbiter's escrow-only authority + production trajectory items (arbiter multi-sig, Tier 3.5 identity unsealing).

You'll know Phase 4 is done when Marta can fund milestone 0, send a message to Anna, see Anna's reply (after Anna decrypts client-side), watch Anna `markDelivered`, release the milestone with the transcript root committed on chain — *and* on a separate pre-staged engagement you can demo `disputeMilestone` (immediate), `escalateMilestone` (cooldown-gated with time-warp), evidence submission, and arbiter `resolveDispute` splitting the parked funds.

### Phase 5 — side panel polish + rehearsal (half day)

1. **Make the side panel beautiful.** Round-6 Iteration D — the highest-leverage UX investment. If the trace looks janky, the crypto looks fake even when it's all real.
2. **Three distinct DIDs visible** in the trace — holder / issuer / verifier — so the audience can see they're not the same key.
3. **Run five timed rehearsals.** Cut anything that drags.
4. **Pre-warm both laptops' wwWallets** by running the issuer service and clicking through the operator UI; confirm credentials persist after browser restart.
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
| **wwWallet** | Browser-based EUDI wallet at `demo.wwwallet.org`. We use it as the lawyer/client *credential* wallet. Pre-staged with credentials before each demo run. Validated end-to-end against in the round-9 spike. |
| **DCQL** | Digital Credentials Query Language. The DCQL JSON shape `{credentials: [...], credential_sets: [...]}` is what wwWallet's OID4VP path actually parses; the older `presentation_definition` shape is silently ignored. |
| **batch issuance** | OID4VCI feature where the wallet asks for N credential instances in one issuance round, each bound to a different holder keypair. Provides cross-verifier unlinkability — each verifier sees a different holder key. We advertise `batch_credential_issuance.batch_size: 5`. |
| **x509_san_dns** | OID4VP `client_id_scheme` we use for the verifier. The verifier signs the request_object with an x.509 cert whose SAN DNS entry matches the prefixed `client_id` (`x509_san_dns:<verifier-hostname>`). One of two schemes wwWallet supports (the other is `x509_hash`). |
| **vct** | The `vct` claim in an SD-JWT VC identifies the credential type. We use `urn:lex-nova:LegalProfessionalAccreditation` for the bar credential and `urn:eudi:pid:1` for the PID. |
| **stand-in issuer** | Our Next.js Route Handlers under `/api/issuer/*` that play both "the bar association" and "the member-state PID provider." Same did:key signs both credential types; persisted to `.lex-nova-keys/issuer.jwk` so it survives Next.js dev hot-reload. |
| **matter** | Legal-industry shorthand for "the specific legal thing you need help with." A row in our `matters` SQLite table: description, jurisdiction, salt, status. Marta posts one from her dashboard after Connect Wallet + onboarding. |
| **milestone** | A unit of work and payment within an engagement. Status sequence on the happy path: `Proposed → Funded → Delivered → Released`. Multiple milestones per engagement; lawyer proposes, client accepts-and-funds, lawyer signals delivery, client releases. |
| **markDelivered** | Contract function the lawyer calls when work is done. Stamps a `deliveredAt` timestamp on chain. Starts the `LAWYER_DISPUTE_COOLDOWN` clock used by `escalateMilestone`. |
| **disputeMilestone** | Client-only contract function. No cooldown. Allowed on `Funded` or `Delivered` milestones. Transitions the milestone to `Disputed`, parking the funds. The client's dispute path is unconstrained because their dispute doesn't carry unsealing authority. |
| **escalateMilestone** | Lawyer-only contract function. Allowed only on `Delivered` milestones, only after `block.timestamp >= deliveredAt + LAWYER_DISPUTE_COOLDOWN`. Reverts otherwise. Anti-harassment guardrail: makes "pay me or I drag you into arbitration tomorrow" cost the lawyer 30 days of patience. |
| **LAWYER_DISPUTE_COOLDOWN** | Immutable constructor parameter on the escrow contract. `30 days` for production, `30 seconds` for the demo deploy. Demonstrated on stage via anvil's `evm_increaseTime` cheat-code. |
| **arbiter** | An authorized address with the on-chain authority to call `resolveDispute(...)`. **Escrow authority only** — no decryption keys, no path to unsealing identity. Same model as a civil-arbitration judge: doesn't go through your filing cabinet, decides based on the evidence the parties present. **Arbiters are verified lawyers** who additionally hold a platform-issued `verified_arbiter` capability granted after manual review — domain expertise plus quality control. In v3: single hardcoded address (Eva Novák, account #5, who carries all three capabilities). In production: EAS lookup against `verified_arbiter` attestations, with multi-sig drawn from a Kleros-style vetted pool. |
| **resolveDispute** | Arbiter-only contract function. Called on a `Disputed` milestone with `(amountToLawyer, amountToClient)`; transfers the parked funds (taking the 15% platform cut on the lawyer portion); transitions `Disputed → Resolved`. The arbiter's only on-chain power. |
| **evidence bundle** | Off-chain submission a party makes to the arbiter when a milestone is disputed: `[{plaintext, sig, merklePath}]` for each message they want the arbiter to see, plus the engagement's on-chain `transcriptRoot`. Arbiter verifies each Merkle path resolves to the root and each signature checks against the sender's wallet — anything that doesn't verify is rejected. Selective disclosure is allowed but bounded (the other party can submit messages the first omitted). |
| **Tier 3.5** | Production-trajectory mechanism for fraud/regulator/AML escalation that requires identity unsealing. Threshold-encrypted PID blob held distributively by the arbitration board; court-order-gated decryption. **Not implemented in v3 in any form, on purpose.** Slide-only. |
| **transcript root** | The Merkle root over all signed message hashes in an engagement's chat. Updated on every milestone fund/release tx via `engagement.transcriptRoot`. Locks the conversation against tampering after each milestone settles. |
| **Tier 1** | Anonymous public legal information. Out of scope for the demo; production roadmap. |
| **Tier 2** | Pseudonymous-but-credentialed advice. The implemented core: verified lawyer, pseudonymous client, E2EE messaging, milestone escrow. **Where the demo lives.** |
| **Tier 3** | Fully-identified engagement on escalation. Triggered by `disputeMilestone`. In production, an arbitration multi-sig of accredited arbitrators reviews the on-chain transcript + revealed messages and can break the identity-escrow seal. We declare the contract transition; the rest is on slides. |
| **identity-escrow** | The platform-side mechanism (production) that holds the client's real identity sealed during Tier 2 and unseals it during Tier 3 escalation. Sealed-but-unsealable. Not implemented in the hackathon. |
| **session key (messaging)** | The AES-GCM key derived per-engagement from a Diffie-Hellman between the two parties' PID-side `cnf.jwk`s. Lives only in the parties' browsers; never on the server. |
| **non-repudiation** | A property where a sender cannot deny having sent a specific message. We get it via per-message ECDSA signatures by the sender's wallet holder key. Important for Tier 3 arbitration. |
| **ZK proof** | Zero-knowledge proof. Cryptographic proof of a statement that reveals nothing else. |
