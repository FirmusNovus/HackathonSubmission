# Research findings — round 3 (deeper diligence after Path A ruled out)

Reading order: [01-summary.md](01-summary.md) → [02-spec.md](02-spec.md) → [03-demo.md](03-demo.md) → [04-research-findings.md](04-research-findings.md) → this doc.

Round 2 recommended **Path A** (self-onboard as a TI in EBSI conformance). Path A is now ruled out — accreditation onboarding takes too long for the hackathon timeline. This doc captures what was uncovered in a deeper search of the EBSI / EUDI / vendor ecosystem and re-grounds the recommendation.

## What's confirmed about the constraint we're working around

The fundamental constraint is: **`verifyCredentialJwt` with `validateAccreditation: true` requires the issuer DID to be in the EBSI Trusted Issuers Registry**. There is no shortcut. None of the alternatives below bypass this — they only change *how* we frame the disabled chain check, or shift the trust anchor away from EBSI entirely.

Things confirmed in this round that close off potential shortcuts:

- **Trusted Schemas Registry is not self-service.** Schemas must be submitted to the EBSI Support Office for review and registered by them. So registering our own `LegalProfessionalAccreditation` schema is the same kind of institutional onboarding as TI accreditation — out of scope for a weekend.
- **Conformance issuer-mock CT credentials have fixed credentialSubject.** They're test fixtures; we cannot stuff our jurisdiction/specialty data into the credentialSubject of a `CTWalletSamePreAuthorisedInTime`.
- **`did:web` issuers are not in EBSI's TIR.** The library can resolve them (it uses `did-jwt` under the hood, which supports many DID methods), but the accreditation check still fails because TIR only registers `did:ebsi`.
- **Pilot environment is gatekept too.** "Identified Users" (Legal Entities already in the trust registries) get write access; anonymous users get read-only. Same chicken-and-egg as conformance.

So the lattice of options is: **(a) use what conformance issues for free and frame around the type label, or (b) self-issue our own type and frame around the disabled chain check, or (c) shift the trust anchor away from EBSI to EUDI ARF.**

## New alternatives uncovered

### Walt.id local Docker stack (refines Path C)

`walt.id`'s `waltid-identity` repo ships a Docker Compose that spins up an OID4VCI issuer locally:

```bash
git clone https://github.com/walt-id/waltid-identity.git
cd waltid-identity/docker-compose && docker compose up
```

The issuer exposes `/openid4vc/jwt/issue`, accepts a `credentialConfigurationId` (e.g. `LegalProfessionalAccreditation_jwt_vc_json`), `credentialData` (any W3C-shaped JSON we send), and an `issuerKey` + `issuerDid`. Returns an `openid-credential-offer://` URL the lawyer's wallet redeems.

Supported issuer DID methods include `did:key`, `did:jwk`, `did:web`, `did:cheqd` — pick whichever is most defensible. `did:web` rooted at our domain (e.g. `did:web:lex-nova.eu`) reads better on stage than `did:key:zXY…` because the trace panel shows a recognizable domain rather than an opaque key blob.

Walt.id also has **"data functions"** — runtime callouts to your backend during issuance — so the credential data can be pulled live from the database the demo is using. Nice flex on stage.

Verification of the resulting JWT VC by `@europeum-ebsi/verifiable-credential` works with `validateAccreditation: false`. Same fundamental compromise as Path C, but with a much more polished issuer flow than hand-rolling a signer.

### Sphereon SSI-SDK (alternative to walt.id)

Sphereon's open-source `SSI-SDK` (Veramo-based, TypeScript) includes a `did:ebsi` v1 Legal Entity provider and OID4VCI issuer/verifier modules. It's heavier than walt.id but more EBSI-native. Worth knowing about as a fallback if walt.id is flaky during build, not worth picking as primary.

### EBSI environments are layered — `api-test.ebsi.eu` vs `api-conformance.ebsi.eu` vs `api-pilot.ebsi.eu`

Confirmed:

- **Development** — temporary, infra tests only, ignore.
- **Test** (`api-test.ebsi.eu`) — permanent, EC-hosted, for testing developed services. Permissive for read; same gatekeeping for write.
- **Conformance** (`api-conformance.ebsi.eu`) — permanent, EC-hosted, runs the wallet/issuer/verifier conformance test suites. The issuer-mock and auth-mock live here.
- **Pilot** (`api-pilot.ebsi.eu`) — Member-State-operated, where real pilots ran. Anonymous reads only; Legal Entities for writes.

For our purposes, `api-conformance.ebsi.eu` is where the issuer-mock lives (so it's where Path B's CT credential comes from). `api-test.ebsi.eu` is the host the *new* `@europeum-ebsi/verifiable-credential` example uses by default. These environments share the same trust framework but are different infrastructures — a credential issued by the conformance issuer-mock is verified against the conformance TIR, not the test or pilot one. Configure the verifier hosts to match wherever the credential came from.

This matters operationally: **on day 1 we should ping all three hosts and decide which is most stable.** Not assume.

### EUDI ARF Path — pivot the lawyer credential away from EBSI entirely

This is the genuinely new option. Worth its own subsection.

The EUDI Architecture and Reference Framework names **professional qualification titles and licences** explicitly as in-scope **(Q)EAA** attestations. The framework specifies:

- **QEAA** — Qualified Electronic Attestations of Attributes, issued only by **Qualified Trust Service Providers**. eIDAS-governed.
- **EAA** (non-qualified) — same shape, lower trust, can be issued by any trust service provider under sectoral rules.
- **Format options:** SD-JWT VC, ISO mDoc 18013-5, JSON-LD VC.

In the EUDI ARF model, a bar admission is exactly the kind of thing a QTSP-issued QEAA represents. **The regulatory roadmap names this attestation type by name** — that's a stronger story than EBSI for the lawyer credential, because EBSI's lawyer-credentialing is implementation-and-pilot-stage while EUDI ARF QEAA-for-professional-credentials is named in the actual eIDAS 2 regulation.

If we issue the lawyer credential as an EAA-shaped SD-JWT VC instead of an EBSI JWT VC, the verifier becomes a single-stack: same `sd-jwt-vc` library handles both lawyer EAA and client PID. The trust anchor shifts from "EBSI TIR" to "x.509 IACA cert chain" — and for the demo we self-root that chain, the same way we'd self-root our did:key in Path C. Production swaps the self-rooted CA for a real QTSP.

**This is a real reframe of the project's pitch, not just an implementation detail.** Worth thinking carefully about whether to pivot. See decision criteria below.

## The five paths now on the table

| | Path B | Path C | Path C′ (walt.id polished) | Path D (hybrid) | Path E (EUDI pivot) |
|---|---|---|---|---|---|
| Issuer | EBSI conformance | Local did:key | Local walt.id w/ did:web | EBSI conformance + walt.id | Local x.509 self-rooted |
| Lawyer credential type on screen | `CTWalletSamePreAuthorisedInTime` (wrong) | `LegalProfessionalAccreditation` (right) | `LegalProfessionalAccreditation` (right) | Both, side by side | `LegalProfessionalAccreditation` EAA SD-JWT (right) |
| Trust chain walk in trace | Real, back to Conformance Root TAO | Skipped (`validateAccreditation: false`) | Skipped (`validateAccreditation: false`) | Real on conformance VC, skipped on walt.id VC | N/A — different model (x.509 chain) |
| Domain data on credential | Generic test data | Real | Real | Real on the walt.id half | Real |
| Verifier dual-stack? | Yes (EBSI + EUDI) | Yes | Yes | Yes | **No — single stack** |
| Build effort | ~2h | ~half day | ~1 day | ~1.5 day | ~1 day |
| Best framing line | "Conformance environment, real chain walk, type label is institutional" | "Real signature, chain walk is institutional" | Same as C | "EBSI gives us the chain walk, walt.id gives us the data shape, production fuses them" | "Production = QTSP issues QEAA, today we run the same format with a self-rooted chain — eIDAS 2 names this attestation type" |
| Weakness a sharp judge spots | Wrong type in trace | `validateAccreditation: false` in trace | Same as C | Two credentials = two failure modes | x.509 chain is self-rooted |

## Recommendation, revised

**Primary: Path E (EUDI pivot for the lawyer credential).** This is the strongest answer once Path A is off the table. Reasons:

1. **The single-stack verifier is a real architectural simplification.** Round-1 spec assumed dual-stack (EBSI for lawyer, EUDI for client). With Path E, the same `sd-jwt-vc` library and the same SD-JWT VC format covers both. Less code, fewer ways to fail on stage.

2. **The pitch gets sharper, not weaker.** "Bar admission as a QEAA issued by a QTSP" is **named by name in the eIDAS 2 regulation**. EBSI lawyer-credentialing is implementation-pilot-territory; EUDI QEAA-for-professionals is roadmap-named. The framing is "we built for the format the regulator named, here's how it verifies, here's how the client side uses the same stack." That's tighter than "we use EBSI's conformance environment as a stand-in."

3. **EBSI doesn't disappear from the deck.** The EBSI Trusted Issuers Registry is still in the slide architecture as the future trust anchor for the QTSPs themselves. We just don't need to verify against it on stage. This is honest — in the actual EUDI rollout, EBSI's role is to be one of the trust anchors that QTSPs and QEAA verifiers consult, not to be the issuer or wallet directly.

4. **The CT-type-as-proxy or `validateAccreditation: false` compromise is replaced with a different compromise:** "self-rooted x.509 chain instead of a real QTSP chain." Symmetric to the others — but easier to wave away because nobody expects a hackathon team to be a QTSP.

**Backup: Path B (CT credential type as proxy).** If the EUDI pivot turns into a build pothole — for example, if we can't get a clean self-rooted IACA chain working with `sd-jwt-vc` in Node — fall back to Path B and the database-profile framing. Still defensible.

**Don't pick Path C / C′.** `validateAccreditation: false` in a trace panel is the weakest possible story. If we need a fast self-issuer, walt.id polishes the surface, but the underlying weakness is the same.

**Don't pick Path D.** Two credentials means two failure modes on stage. Save the cleverness for the slide explaining the production fusion.

## What pivoting to Path E means for the spec

If we go Path E, [02-spec.md](02-spec.md) needs these surgical edits:

1. Lawyer credential format: SD-JWT VC, not JWT VC.
2. Lawyer issuer: local Node service with a self-rooted x.509 cert chain (e.g. `step-ca` CLI generates a CA + leaf in three commands), not `@europeum-ebsi/verifiable-credential` issuer.
3. Verifier: `sd-jwt-vc` npm package handling both lawyer EAA and client PID. Drop `@europeum-ebsi/verifiable-credential` from the lawyer path.
4. Trace panel still shows: chain validation, signature check, disclosed attribute set. Just the chain anchor is "x.509 IACA root" not "EBSI Conformance Root TAO."
5. EBSI section of the deck rebranded as "the trust anchor for QTSPs" rather than "the trust anchor we verify against on stage."
6. The "27 wallet-issuing states" line stays — it's even more on-point now.

## What pivoting to Path E means for the demo script

[03-demo.md](03-demo.md) screen one rewrites slightly:

> "The lawyer presents a Qualified-Electronic-Attestation-shaped credential — SD-JWT VC, the same format every EU member-state wallet must support by the December 2026 deadline. eIDAS 2 names professional qualifications as exactly this kind of attestation. In production, the issuer is a Qualified Trust Service Provider acting on behalf of the bar association. Today the issuer is us, signed against a self-rooted certificate chain. The verifier resolves the chain, validates the signature, extracts disclosed claims."

Trace panel shows roughly:

```
> Receiving SD-JWT VC presentation
> Resolving issuer x.509 chain
  - leaf: cn=lex-nova.eu, valid 2026-04-01 → 2027-04-01
  - root: cn=Lex Nova Demo IACA, self-rooted (production: QTSP-issued)
> Verifying signature: ES256 OK
> Disclosed claims: { jurisdiction: "DE", admittedSince: 2018, specialty: "GmbH formation" }
> Writing EAS attestation on local anvil
< Tx: 0xabc123...
```

The "self-rooted (production: QTSP-issued)" line in the trace is the honest disclosure. Cleaner than `validateAccreditation: false`.

## Decisions needed

1. **Path E or Path B for the lawyer credential?** Recommendation: **Path E**. Sharper pitch, simpler verifier, replaces "EBSI conformance is our stand-in" with "we built to the format eIDAS 2 named for professional credentials."
2. **If Path E, do we still call EBSI in any capacity for the lawyer side?** Recommendation: no — it confuses the story. Keep EBSI as a slide-only trust anchor reference for QTSPs. The client side is unchanged (still EUDI PID via `issuer.eudiw.dev`).
3. **Library choices on Path E:** `sd-jwt-vc` from npm for verification; `step-ca` CLI for the cert chain; walt.id's issuer if we want a polished issuance UI, otherwise hand-rolled SD-JWT signing in our backend (~100 lines).
4. **Anvil + EAS + escrow plan unchanged from round 2.**

The user-facing pivot is small. The spec edits are surgical. The story improves. Worth the half-day reshuffle on day 1.

## Sources

- [EBSI Trusted Schemas Registry — submission process](https://hub.ebsi.eu/get-started/design/data-model)
- [EBSI hub — Discovery metadata](https://hub.ebsi.eu/conformance/learn/discovery-metadata)
- [EBSI Conformance API v3.2](https://hub.ebsi.eu/apis/conformance/conformance/v3)
- [EBSI environments overview](https://hub.ebsi.eu/conformance/standards-versions)
- [walt.id getting started](https://docs.walt.id/community-stack/issuer/getting-started)
- [walt.id W3C JWT VC issuance](https://docs.walt.id/community-stack/issuer/api/credential-issuance/vc-oid4vc)
- [waltid-identity GitHub](https://github.com/walt-id/waltid-identity)
- [Sphereon SSI-SDK GitHub](https://github.com/Sphereon-Opensource/SSI-SDK)
- [Sphereon SSI-SDK Crypto Extensions (EBSI)](https://github.com/Sphereon-Opensource/SSI-SDK-crypto-extensions)
- [EUDI ARF 1.1.0](https://eudi.dev/1.1.0/arf/)
- [MATTR — Demystifying EUDI ARF Part 2: Credential Formats](https://medium.com/@mattrglobal/demystifying-the-eudi-arf-part-two-credential-formats-and-mattrs-credential-profiles-182ad18abee3)
- [EUDI Wallet Ecosystem Germany — (Q)EAA Issuance](https://bmi.usercontent.opencode.de/eudi-wallet/eidas-2.0-architekturkonzept/content/appendix/01-qeaa-issuance-and-presentation/)
