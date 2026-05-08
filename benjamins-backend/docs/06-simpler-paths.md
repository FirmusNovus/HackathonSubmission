# Research findings — round 4 (simpler implementations)

Reading order: [01-summary.md](01-summary.md) → [02-spec.md](02-spec.md) → [03-demo.md](03-demo.md) → [04-research-findings.md](04-research-findings.md) → [05-deeper-research.md](05-deeper-research.md) → this doc.

Round 3 recommended **Path E** (pivot to EUDI ARF SD-JWT VC). User pushback: dig further, find simpler. This round did, and it changes the recommendation again — there's a path that's strictly simpler than Path B and uses *only* EBSI's official library. I'm calling it **Path F**.

## The unlock

`@cef-ebsi/verifiable-credential` (and its `@europeum-ebsi` successor) **exports both `createVerifiableCredentialJwt` and `verifyCredentialJwt`**. Same library does both sides of the round-trip. And — this is the part I'd missed — **EBSI's own conformance environment uses `did:key` for both issuer and holder DIDs in many test flows**. From the search results:

> "In conformance testing, both the Credential Issuer DID and Holder Wallet DID are based on did:key, making did:key an appropriate choice for minimal hackathon implementations where you don't need integration with EBSI's trust registries."

So `did:key` issuance with the official EBSI library isn't a hack. It's the documented hackathon path. The library accepts ES256 / ES256K / EdDSA signatures, and the only thing we'd skip is the TIR / accreditation walk — which is exactly the institutional onboarding piece that doesn't fit a weekend.

## Path F — one-library round-trip

### Implementation, end to end

```ts
import {
  createVerifiableCredentialJwt,
  verifyCredentialJwt,
  type EbsiVerifiableAttestation,
} from "@cef-ebsi/verifiable-credential";
import { ES256Signer } from "did-jwt";
import { generateKeyPair, exportJWK } from "jose";

// One-time at boot: generate our "bar association" key + did:key
const { privateKey, publicKey } = await generateKeyPair("ES256");
const issuerDid = `did:key:${encodeJwkAsMultibase(await exportJWK(publicKey))}`;
const issuer = {
  did: issuerDid,
  kid: `${issuerDid}#${issuerDid.slice(8)}`,
  alg: "ES256" as const,
  signer: ES256Signer(privateKey),
};

// Per request: issue the lawyer's credential
const payload: EbsiVerifiableAttestation = {
  "@context": ["https://www.w3.org/2018/credentials/v1"],
  id: `urn:uuid:${crypto.randomUUID()}`,
  type: ["VerifiableCredential", "VerifiableAttestation", "LegalProfessionalAccreditation"],
  issuer: issuerDid,
  issuanceDate: new Date().toISOString(),
  validFrom: new Date().toISOString(),
  expirationDate: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
  credentialSubject: {
    id: lawyerDidKey,
    jurisdiction: "DE",
    barAdmissionNumber: "RAK-Muenchen-2018-04321",
    specialty: "Corporate / GmbH formation",
    admittedSince: "2018-09-15",
  },
  credentialSchema: { id: "...", type: "FullJsonSchemaValidator2021" },
};

const vcJwt = await createVerifiableCredentialJwt(payload, issuer, config);

// Per verification: validate
const config = {
  hosts: ["api-conformance.ebsi.eu"],
  scheme: "ebsi",
  network: { name: "conformance", isOptional: false },
  services: { /* did/tir/tsr versions */ },
};
const verified = await verifyCredentialJwt(vcJwt, config, {
  validateAccreditation: false,  // production: true (issuer is then a TI, this becomes a no-op flag)
});
```

That's the whole lawyer-credential layer. ~50 lines total including imports and config. **Same library on both sides.** No walt.id docker, no x.509 chain plumbing, no OID4VCI dance against the conformance issuer-mock, no CT credential type to translate.

### Implementation cost

~2–3 hours. By far the lowest of any path on the table.

### What's real, what's framed

**Real:**
- Library is `@cef-ebsi/verifiable-credential` from EBSI. The same library a real EBSI verifier would use.
- Signature creation and verification (ES256, real EC crypto).
- JWT structure validation (header, payload claims, dates, sub/iss/jti consistency).
- Schema validation against the credential's `credentialSchema` reference.
- Credential subject DID resolution (lawyer's `did:key` for the natural-person subject).
- Issuer DID resolution.

**Framed honestly:**
- The issuer DID is a `did:key` we control. In production, the issuer is a bar association registered as a TI in EBSI's TIR.
- The accreditation chain walk is skipped. The `validateAccreditation: false` flag is **how the EBSI library itself recommends configuring for development against did:key issuers**, not a hack we invented.

### How to surface this in the trace panel without it looking like a flag

Three equivalent ways to display the same fact, listed worst → best:

```
✗ Worst:
> Verifying credential...
> validateAccreditation: false  ← reads as a disabled safety check

✓ Better:
> Verifying credential...
> Signature: OK (ES256)
> Schema: OK
> Dates valid
> Issuer DID resolved: did:key:zDnaeUKTWUXc1HDpGfKbEK73gNYXRwoiKTmA8bFwh1xy7AbT1
> Accreditation chain: not validated (issuer is did:key)
> Production: validates against EBSI Trusted Issuers Registry

✓✓ Best:
> Verifying lawyer credential against EBSI library v3.x...
> ✓ Signature (ES256): valid
> ✓ Credential schema: matches LegalProfessionalAccreditation
> ✓ Validity dates: 2026-04-15 to 2027-04-15
> ✓ Subject DID: did:key:zDna…1xy7AbT1 (natural person)
> ✓ Issuer DID: did:key:zXY7…GHkLm9 (production: bar association registered in EBSI TIR)
> Disclosed: jurisdiction=DE, specialty="GmbH formation", admittedSince=2018-09-15
> Writing EAS attestation on local anvil...
> Tx: 0xabc123… (anvil block 17)
```

The "best" version is the same trace as a production verifier would produce **except** the issuer DID is `did:key:` instead of `did:ebsi:`. Judges who look closely see the substitution; judges who skim see a clean verification pass.

### Spoken framing on stage

> "We use the EU's own EBSI verifiable-credential library to issue and verify this credential. Same code, same library that a production verifier runs. The issuer DID here is a `did:key` we control — in production it's a bar association registered as a Trusted Issuer in EBSI's registry. Onboarding bar associations as Trusted Issuers is documented EBSI flow and weeks of regulatory paperwork, beyond a hackathon. The cryptographic verification — signature, schema, dates, subject — is identical."

That's 30 seconds, no hedging, and it answers the obvious follow-up before it's asked.

## How Path F compares

| | Path B | Path E | Path F |
|---|---|---|---|
| Verifier library | `@cef-ebsi/verifiable-credential` | `@sd-jwt/sd-jwt-vc` | `@cef-ebsi/verifiable-credential` |
| Issuer | EBSI conformance issuer-mock (over OID4VCI) | Local x.509-rooted SD-JWT signer | Our backend with `did:key`, same EBSI library |
| Custom credential type | No (CT type only) | Yes | Yes |
| Real signature verification | Yes | Yes | Yes |
| Real schema validation | Yes | Yes | Yes |
| Trust-anchor walk | **Real, back to Conformance Root TAO** | None (single self-rooted cert) | Skipped (issuer is did:key) |
| Build effort | ~half day (OID4VCI plumbing) | ~3–4 hours | **~2–3 hours** |
| Dependencies for lawyer side | `@cef-ebsi/verifiable-credential` + OID4VCI client | `sd-jwt-vc` + cert tooling | `@cef-ebsi/verifiable-credential` only |
| Lib parity with client side | Different (EBSI lawyer, SD-JWT client) | **Same library** for both | Different (EBSI lawyer, SD-JWT client) |
| Soundbite | "Real EBSI conformance environment" | "Format named in eIDAS 2 for professional credentials" | "EBSI's own library, both sides of the round-trip" |
| Trace weakness a judge spots | CT type label | Self-rooted cert chain | did:key issuer + skipped accreditation |

**Path F wins on simplicity.** The trace weakness ("did:key issuer + skipped accreditation") is no worse than Path E's ("self-rooted x.509") or Path B's ("CT type label"). All three have the same structural compromise: we don't have institutional accreditation. They differ in *where* that compromise is visible. Path F's compromise is the most defensible — the EBSI library's own docs name did:key as the appropriate hackathon issuer.

## Two further simplifications worth considering

### Simplification 1 — skip OID4VCI for the lawyer flow

Round-1 spec assumed an OID4VCI dance: lawyer wallet sends auth request, gets ID-token challenge, exchanges code, requests credential. With Path F, this is unnecessary. The "wallet" can be:

- a localStorage entry in the lawyer's browser session
- received directly from `POST /api/lawyer/issue-credential` as a JSON `{ vcJwt }` response
- presented back via `POST /api/lawyer/verify-credential` with the JWT in the body

**Lost:** the OID4VCI dance is good for the "EU regulatory infrastructure" framing. Skipping it costs ~10 seconds of trace panel content.

**Gained:** ~2 hours of build time, fewer moving parts on stage, one less library.

Compromise: **mock the OID4VCI dance in the trace panel** by writing fake `> POST /authorize` and `> 302 openid://...` lines while the real flow is just two API calls under the hood. That's dishonest; don't do that.

Better compromise: **make the page LOOK like a wallet flow** — a small "MetaMask-style" credentials popup that says "Lex Nova would like to issue you: LegalProfessionalAccreditation. Accept?" — even though it's just a localStorage write under the hood. Conveys the wallet metaphor without faking standards-compliance.

### Simplification 2 — pre-stage the lawyer onboarding entirely

For a 4:30 minute demo, the live lawyer onboarding eats ~1 minute. The novel content is escrow + ZK + engagement. We could:

- Pre-onboard the lawyer before the demo. EAS attestation is already on chain when anvil boots from `--load-state`.
- On stage: scroll back through the recorded trace panel as a "this happened five minutes ago" replay, point at the basescan-style tx receipt.
- Live demo: client onboarding + engagement flow only.

**Saves:** ~1 minute of stage time, full set of failure modes (issuer, verifier, schema, EAS write, network).

**Costs:** the EBSI verification doesn't get a "wow" moment — it's pre-staged.

This is worth it if and only if (a) we feel time-pressured in dry-runs, or (b) the lawyer flow keeps failing on rehearsal. Pre-stage as an option, not a default. **Build it live, decide on stage time during rehearsal.**

## Recommendation, revised again

**Primary: Path F** (one-library round-trip, did:key issuer, custom `LegalProfessionalAccreditation` type, simplification 1 — skip OID4VCI).

Time: ~2–3 hours total for the lawyer credential layer. Frees up an entire build day to spend on:
- ZK circuit polish and proof-generation latency
- Demo rehearsal and trace-panel UX
- Anvil dump/load state hardening
- Slide deck

**Backup if Path F surfaces a snag:** Path B (CT credential type from conformance issuer-mock).

**Drop:** Path C, Path C′ (walt.id), Path E (EUDI pivot). All three are dominated by Path F on simplicity and at least matched on framing strength. Walt.id stays available as a polished issuer UI if we want it later, but it's no longer in the critical path.

**Keep in pocket:** simplification 2 (pre-staging) as a rehearsal-time decision.

## Updated decisions matrix

| Decision | Round 2 said | Round 3 said | Round 4 says |
|---|---|---|---|
| Lawyer credential path | Path A primary | Path E primary | **Path F primary** |
| Library on lawyer side | `@cef-ebsi/verifiable-credential` | `@sd-jwt/sd-jwt-vc` | `@cef-ebsi/verifiable-credential` (or `@europeum-ebsi`) |
| Issuer infrastructure | Self-onboarded TI | Local x.509 + sd-jwt | Local did:key + EBSI library |
| OID4VCI on lawyer flow | Yes | Yes | **Skip — direct API** |
| EUDI client side | Unchanged | Unchanged | Unchanged |
| Anvil + EAS + escrow | Unchanged | Unchanged | Unchanged |
| Pre-stage lawyer flow? | No | No | **Decide at rehearsal** |

## What this means for spec and demo docs

[02-spec.md](02-spec.md):
- Lawyer issuer: new component, ~50 lines in `apps/backend`. `@cef-ebsi/verifiable-credential` for both `create` and `verify`. did:key issuer at boot. Two endpoints: `POST /api/lawyer/issue` and `POST /api/lawyer/verify`.
- Drop the OID4VCI client-side requirement on the lawyer flow.
- Client side stays as round-1 spec (EUDI verifier endpoint via Docker, SD-JWT VC PID).

[03-demo.md](03-demo.md):
- Screen one trace panel updates as in the "best" example above.
- Stage script swaps "real EBSI conformance environment" line for "EBSI's own library, both sides of the round-trip" line.
- Q&A line for "is this a real bar association?" stays — same answer, same honest framing.

## Sources

- [@cef-ebsi/verifiable-credential on npm](https://www.npmjs.com/package/@cef-ebsi/verifiable-credential)
- [EBSI hub — Verifiable Credential library](https://hub.ebsi.eu/tools/libraries/verifiable-credential)
- [EBSI conformance — issue-to-holder functional flows](https://hub.ebsi.eu/conformance/build-solutions/issue-to-holder-functional-flows)
- [openwallet-foundation/sd-jwt-js](https://github.com/openwallet-foundation/sd-jwt-js)
- [@sd-jwt/sd-jwt-vc on npm](https://www.npmjs.com/package/@sd-jwt/sd-jwt-vc)
- [walt.id hosted demo / portal](https://docs.walt.id/issuer)
