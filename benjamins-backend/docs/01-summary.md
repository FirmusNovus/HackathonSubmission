# Pan-EU Pseudonymous Legal Advice Platform — Conversation Summary

## What this is

ETH Prague 2026 hackathon project, Network Economy track. A platform where:
- Lawyers prove EU bar admission cryptographically via EBSI Verifiable Credentials
- Clients verify identity once, then stay pseudonymous to lawyers via ZK-attested AML and conflict-of-interest checks
- Engagement money flows through smart-contract escrow on an Ethereum L2

Three product tiers: anonymous legal information, pseudonymous credentialed advice with sealed identity, fully-identified engagement when matters escalate. Cross-border matching is the wedge.

## Key research findings

### EBSI is real and reachable, with caveats

EBSI runs Hyperledger Besu with IBFT 2.0 consensus, EVM-compatible, ~40 nodes operated by member states. Three trust roles: Root TAO (governs the chain), TAO (governs a segment), TI (issues domain VCs). The EBSI Support Office is the bootstrap Root TAO with DID `did:ebsi:zZeKyEJfUTGwajhNyNX928z`.

Becoming a real Trusted Issuer requires being invited into a trust chain by an existing RTAO or TAO. For the hackathon this means: bar associations as TIs is a real production goal, not something we register ourselves for in a weekend.

### The conformance environment is the hackathon path

EBSI exposes a fully public mock issuer + auth server at `api-conformance.ebsi.eu/conformance/v3/`. No application or invitation needed. Supports OID4VCI same-device, cross-device, in-time, deferred, pre-authorised flows. We use this for the demo and frame it honestly: "in production this issuer is a real bar association, today we use the EU's public conformance issuer."

### EUDI Wallet rollout is uneven

The original pitch said "EUDI Wallet rolls out across all 27 member states by end of 2026." Reality per ENISA early-2026 draft: no wallet has been deployed or certified, fewer than a quarter of member states participated in recent testing, Germany announced January 2027 launch. The deadline exists in law, the production reality lags. Pitch framing changes from "consuming the EUDI Wallet rollout" to "the regulatory mandate created 27 mandatory wallet-issuing states, rollout is happening unevenly through 2026 to 2027, we're built so any conformant wallet is a client onboarding source."

### EBSI and EUDI ARF are different trust frameworks today

EBSI: W3C VC Data Model 1.1, JWT-VC, `did:ebsi` legal-entity DIDs, Trusted Issuers Registry as trust anchor.

EUDI ARF: SD-JWT VC and ISO mDoc 18013-5/-7, x.509 IACA cert chains as trust anchor.

Verifier needs to be dual-stack. Both speak OID4VCI/OID4VP at the protocol layer, so the wallet-to-verifier dance looks the same.

## Build vs mock decisions

### Build for real

1. **EBSI VC verification** end-to-end against the conformance environment, custom `LegalProfessionalAccreditation` credential type, real `verifyCredentialJwt` from `@cef-ebsi/verifiable-credential`
2. **EUDI PID verification** against the reference issuer at `issuer.eudiw.dev`, SD-JWT VC format
3. **Solidity escrow on Base Sepolia or Arbitrum Sepolia**, gated by EAS attestations written when (1) and (2) succeed
4. **Noir circuit for simplified conflict check** (non-membership over a small set of hashed prior-client commitments, N=8 for demo)

### Mock with integrity

- QES signing (slide only, name a QTSP partner)
- AML/banking layer (slide only, architecture diagram)
- Stealth addresses ERC-5564 (drop entirely)
- Messaging XMTP/Waku (drop, simple WebSocket if needed)

### Cut from original pitch

- The "0.25–0.5% of €25–40B serviceable market" math is fragile. Replace with simpler "€60–200M GMV at 15% take rate = €10–35M ARR, 6–12x ARR comparable = €100–400M valuation"
- BBS+ selective disclosure (pick SD-JWT only, more practical with EBSI tooling today)
- Mainnet for high-value attestations (testnet only, mention mainnet on slide)

## Regulatory positioning

Take rate on legal fees will draw bar association attention. Germany BRAO restricts fee-sharing with non-lawyers, similar in France/Spain/Italy. Backup framing: "we operate as a payment-rails provider on the same legal basis as Stripe, charging on transaction volume not legal fees, lawyer sets price and receives gross minus payment processing." More legal headroom than "platform take rate."

## Where to start day one

1. Solidity escrow contract with EAS gating, Foundry tests, deploy to Base Sepolia
2. Then EBSI verifier service that calls `verifyCredentialJwt` against conformance env, writes EAS attestation on success
3. EUDI PID verifier in parallel
4. Noir circuit last, isolated piece, slot in once the proof flow works

## Useful URLs

- EBSI hub: https://hub.ebsi.eu/
- EBSI VC library docs: https://hub.ebsi.eu/tools/libraries/verifiable-credential
- EBSI conformance issuer-mock: `https://api-conformance.ebsi.eu/conformance/v3/issuer-mock`
- EBSI conformance auth-mock: `https://api-conformance.ebsi.eu/conformance/v3/auth-mock`
- EBSI VC validator: https://hub.ebsi.eu/tools/vc-validator
- EBSI trust model: https://hub.ebsi.eu/vc-framework/trust-model/issuer-trust-model-v3
- EUDI reference impl org: https://github.com/eu-digital-identity-wallet
- EUDI verifier endpoint: https://github.com/eu-digital-identity-wallet/eudi-srv-verifier-endpoint
- EUDI OID4VP Kotlin lib: https://github.com/eu-digital-identity-wallet/eudi-lib-jvm-openid4vp-kt
- EUDI OID4VCI Kotlin lib: https://github.com/eu-digital-identity-wallet/eudi-lib-jvm-openid4vci-kt
- walt.id docs (EBSI integration): https://docs.walt.id/community-stack/issuer/ecosystems/ebsi/overview

## Hackathon scope reminder

Three claims need to be defensible on stage:
1. Lawyers cryptographically verified as real EU bar members → EBSI VC verification (real)
2. Clients pseudonymous but pass AML and conflict-of-interest → ZK proofs (real, simplified)
3. Money flows through smart-contract escrow with milestone release → Solidity on Base Sepolia (real)

If all three are real, the project demonstrates the novel thesis. If any are mocked, the cryptographic story collapses.
