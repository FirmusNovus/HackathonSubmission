# Demo Play: Stage Script

## Total runtime target: 4:30 minutes

Hard cap at 5:00. Most hackathons give 3-5 minutes. If your slot is shorter, drop the close, not the technical sections.

## Pre-show checklist

- [ ] Two laptops on the desk, both connected to the venue WiFi and a phone hotspot
- [ ] MetaMask on both laptops, pre-funded with Base Sepolia ETH
- [ ] Backup video of the full demo recorded and ready to play if WiFi dies
- [ ] Browser tabs pre-loaded:
  - `/lawyer/onboard` page
  - `/client/onboard` page
  - `/engagement/0` page (will show after creation)
  - Basescan tab for tx links
  - EBSI VC validator (https://hub.ebsi.eu/tools/vc-validator) as a credibility prop
- [ ] EUDI verifier endpoint running locally via Docker
- [ ] EBSI conformance env verified reachable in last 10 minutes
- [ ] Phone audio cued for any stage music
- [ ] Slide deck ready with one architecture slide and one closing slide

## The hook (0:00 - 0:30)

**On screen:** title slide with the project name and tagline

**Spoken:**
"A Spanish startup founder wants to set up a German GmbH. She needs a lawyer admitted in Germany who speaks Spanish. Today she has two options: upload her ID and company documents to a directory site she's never heard of, or pay 600 euros to a Munich firm to find her one. Both are bad.

We built a third option. Cryptographically verified lawyers, pseudonymous clients, money in smart-contract escrow."

**Why this works:** specific persona, specific pain, no jargon yet. Judges latch onto the founder, not the technology.

## Screen one — lawyer onboarding (0:30 - 1:30)

**Action:** switch to `/lawyer/onboard` on laptop one. Wallet already connected. Click "Start onboarding."

**On screen, left side:** lawyer-facing UI showing:
- "Connect your professional credential wallet"
- A QR code for cross-device, plus "Same device" button
- After click: "Awaiting credential presentation..."

**On screen, right side:** the verification trace panel, streaming live:
```
> POST https://api-conformance.ebsi.eu/conformance/v3/auth-mock/authorize
< 302 Location: openid://...
> GET https://api-conformance.ebsi.eu/conformance/v3/issuer-mock/.well-known/openid-credential-issuer
< 200 OK
> Resolving did:ebsi:zxaYaUtb8pvoAtYNWbKcveg
< DID document retrieved
> Verifying signature with kid: did:ebsi:zxaYaUtb8pvoAtYNWbKcveg#CHxYzOqt38Sx6YBfPYhiEdgcwzWk9ty7k0LBa6h70nc
< OK
> Walking accreditation chain...
  - VerifiableAccreditationToAttest issued by did:ebsi:zZeKyEJfUTGwajhNyNX928z (EBSI Support Office)
  - VerifiableAuthorisationForTrustChain → Root TAO
< Trust chain valid
> Writing EAS attestation on Base Sepolia...
< Tx: 0xabc123... (link)
```

**Spoken (over the panel):**
"This is a real call to the EU's EBSI conformance environment. The lawyer's wallet presented a verifiable credential signed by an EBSI-anchored issuer. The library you see running here is the EU's own `@cef-ebsi/verifiable-credential` package. It walked the accreditation chain back to the Root Trusted Accreditation Organisation, which is the EBSI Support Office.

In production, the issuer in this credential would be a real bar association onboarded as a Trusted Accreditation Organisation. The verification code path is identical. We're using the conformance environment because that's the EU's public test issuer for exactly this purpose.

The result is now an Ethereum Attestation Service record on Base Sepolia. Here's the transaction."

**Click the basescan link, show the attestation.**

**Time check:** if running long, skip the click-through. Block explorer can stay in the corner.

## Screen two — client onboarding (1:30 - 2:30)

**Action:** switch to laptop two. Different wallet. Open `/client/onboard`.

**On screen, left side:**
- "Verify your identity once. Stay pseudonymous to your lawyer."
- "Connect your EUDI Wallet"
- After click: "Awaiting PID presentation..."

**On screen, right side:** the trace panel:
```
> POST https://issuer.eudiw.dev/.well-known/openid-credential-issuer
< 200 OK (SD-JWT VC, type: urn:eudi:pid:1)
> OID4VP request to wallet, requesting selective disclosure:
  - nationality
  - over_18
  - resident_country
> SD-JWT VC received
> Verifying signature against IACA root
< OK
> Disclosed claims: { nationality: "ES", over_18: true, resident_country: "ES" }

> Loading lawyer's prior-client commitments (8 hashed entries)
> Generating Noir proof: hash(client_secret) ∉ commitments
  Time: 2.1s
< Proof verified

> Writing EAS client attestation on Base Sepolia
< Tx: 0xdef456... (link)
```

**Spoken:**
"Now the client. She presents her PID from the EU's reference identity wallet, the same SD-JWT format every member state's wallet has to support by the December 2026 deadline. We use selective disclosure: only nationality, over-18, and country of residence. We don't see her name, ID number, or date of birth.

Then a zero-knowledge proof. The lawyer has a set of hashed commitments to all his prior clients. The client's wallet generates a Noir proof that her commitment is not in that set, without revealing her commitment or letting her see his client list. Eight commitments today for demo speed, production scales this to a Merkle tree of thousands.

If the proof passes, a second attestation lands on chain. Now both parties are verified to the smart contract."

**Note:** the 2.1s proof generation feels long on stage. Pre-warm the proving key on page load so this is the only delay. A clear progress bar makes the wait feel like a feature.

## Screen three — engagement and escrow (2:30 - 3:30)

**Action:** switch to `/engagement/create` on laptop one. Form pre-filled with lawyer address from screen one and client address from screen two.

**On screen left side:**
- "Create engagement" button
- Amount field: 0.05 ETH (test value)
- After click: contract call, then "Engagement #0 created"

**Then:** switch to laptop two, `/engagement/0` page. "Fund this engagement" button. Click.

**On screen right side:** trace panel:
```
> Calling LegalEngagementEscrow.createEngagement(...)
> Contract verifies lawyer EAS attestation: 0xabc123... ✓
> Contract verifies client EAS attestation: 0xdef456... ✓
> Engagement #0 created
< Tx: 0xghi789...

> Calling LegalEngagementEscrow.fundEngagement(0) value: 0.05 ETH
> Status: Created → Funded
< Tx: 0xjkl012...

[lawyer marks work complete - skip in demo, just say it]

> Calling LegalEngagementEscrow.releaseEngagement(0)
> Computing splits: 0.0425 ETH to lawyer, 0.0075 ETH to platform (15%)
> Status: Funded → Released
< Tx: 0xmno345...
```

**Spoken:**
"Both attestations gate the engagement contract. If either lawyer or client wasn't verified, the contract reverts. The client funds the milestone, the lawyer does the work, the client releases. Fifteen percent goes to the platform on release, not on signup. The platform only earns when work actually happens.

Production swaps testnet for mainnet, swaps the conformance issuer for real bar associations, and adds qualified electronic signatures on the engagement agreement. None of that changes the architecture you just saw."

## Close (3:30 - 4:30)

**Switch to closing slide.**

**On screen:**
- Map of the EU showing wallet rollout status (use real data from the eIDEasy April 2026 status as of writing)
- Three lines:
  - "27 mandatory wallet-issuing states by end of 2026"
  - "EBSI Trusted Issuers Registry as the trust anchor for any regulated profession"
  - "Same architecture, swap the credential type"

**Spoken:**
"The EUDI Wallet rollout across member states is happening unevenly through 2026 and 2027. Some countries will be production-ready in months, others later. The mandate is what matters: 27 wallet-issuing states, all required to accept each other's credentials.

The verification stack we just demoed is reusable. Swap a bar admission credential for a medical license, an audit accreditation, or a financial advisor authorisation, and you have the same platform for a different regulated profession. That's the licensing line.

Today: a vetted Spanish lawyer admitted in Germany, found by a Spanish founder, paid through smart-contract escrow, with neither party knowing the other's name. Thank you."

## Q&A prep

These are the questions to expect. Have one-line answers ready, not paragraphs.

**Q: "Is the lawyer's credential issuer a real bar association?"**
A: No. It's the EBSI conformance environment, the EU's public test issuer. Production requires bar associations to onboard as TAOs, which is institutional work, not code. The verification code path is identical.

**Q: "Aren't you taking a fee on legal services? That's restricted in most member states."**
A: We're a payment-rails provider on the same legal basis as Stripe. We charge on transaction volume, not on legal fees. The lawyer sets the price and receives the gross. Clean separation from BRAO and equivalent statutes.

**Q: "What if EUDI Wallet adoption is slow?"**
A: It is slow. The mandate exists, the rollout is uneven through 2026 and 2027. Our PID verifier accepts any SD-JWT VC from any conformant issuer, so any member-state wallet is a client onboarding source as it ships. We're built for the rollout curve, not the deadline.

**Q: "Why blockchain at all?"**
A: Two reasons. The EBSI Trusted Issuers Registry is on-chain by design — it's how the EU built the trust anchor. And the escrow gives the client mechanical confidence that the lawyer cannot disappear with funds, without trusting us as the platform.

**Q: "How are disputes resolved?"**
A: The contract has a Disputed status. Hackathon scope skips the dispute logic. Production: a multi-sig of accredited arbitrators, themselves carrying EBSI-anchored credentials, with on-chain rulings. Kleros is a fallback option.

**Q: "How does the lawyer learn what they're working on if the client is pseudonymous?"**
A: The lawyer learns the matter, not the identity. "GmbH formation in Bavaria, founder is Spanish, target capital 25k euros." The pseudonymity is on PII, not on substance. If the matter escalates, the client opts into tier three: standard fully-identified engagement.

**Q: "What's stopping a lawyer from issuing themselves a fake credential?"**
A: The library walks the accreditation chain back to the Root TAO. A self-issued VC has no TAO accreditation in the Trusted Issuers Registry. Verification fails. You saw it run live.

**Q: "Why Noir over Circom?"**
A: Faster to write, the language ergonomics are better for a hackathon, and `noir_js` runs proofs in the browser without WASM size headaches. Circom would have worked too. Pick one and ship.

**Q: "What's the team?"**
A: [your answer here, prep this honestly]

**Q: "How big is the SAM?"**
A: B2C legal services in the EU is roughly 60 billion euros in 2025. Cross-border, SME, and digitally-deliverable matters are a defensible 25 to 40 billion subset. At 60 to 200 million euros of GMV in year five, we're a 10 to 35 million ARR company at a 15 percent take rate. Legal-tech comparables trade at 6 to 12x ARR.

**Q: "Why won't an incumbent like Clio just build this?"**
A: Clio is workflow software for law firms. We're a marketplace for cross-border consumer matters. Different customer, different acquisition motion. Also: we consume EUDI Wallet and EBSI as the trust anchor, which is a regulatory tailwind no incumbent has built around.

## Failure modes and recovery

**EBSI conformance env returns 500:** Switch to backup video. Don't try to debug live. The point is to show the flow, not the network.

**Base Sepolia RPC times out:** Switch to second RPC endpoint configured in viem. If that fails too, show pre-recorded transactions on Basescan and explain.

**ZK proof generation hangs:** "While that's generating, let me show you the architecture." Switch to architecture slide. When it finishes, switch back. Don't apologize.

**Wallet popup doesn't appear:** Bring up MetaMask manually from the toolbar. If it's frozen, swap to laptop two and continue.

**You forget a section:** The screens are in order on the slide deck. Just go to the next slide. Judges don't know your script.

**Laptop dies:** That's why there are two laptops. Hand the second one to a teammate while you continue narrating.
