# Research findings — round 2 (anvil reframe)

Reading list before this doc: [01-summary.md](01-summary.md), [02-spec.md](02-spec.md), [03-demo.md](03-demo.md).

This doc records what changed since round 1 and proposes reframing options for the anvil-based local demo path. Read the **Decisions needed** section at the end first if you only have a minute.

## What's new since round 1

### 1. Library: there are two packages, both work

- **`@cef-ebsi/verifiable-credential`** — original, still on npm, ~474 weekly downloads, last release within the past year. Listed as the package on the EBSI hub library page.
- **`@europeum-ebsi/verifiable-credential`** — newer fork under the **Europeum consortium**, the new governance body that took over EBSI maintenance from CEF in mid-2024. Same API surface (`verifyCredentialJwt`, etc).

The hub page itself recommends `@europeum-ebsi/verifiable-credential` in current examples, but `@cef-ebsi` still works against the same registries. **Pick `@europeum-ebsi/verifiable-credential` for new code**, fall back to `@cef-ebsi` if its examples are less stale on Stack Overflow / GitHub Issues during debugging. Verification target hosts shift accordingly: `api-test.ebsi.eu` is the documented host in the new examples; `api-conformance.ebsi.eu` is still reachable.

### 2. The conformance issuer-mock issues fixed test types only

The conformance issuer at `api-conformance.ebsi.eu/conformance/v3/issuer-mock` will issue exactly these credential types and no others:

- `CTWalletSameAuthorisedInTime`
- `CTWalletCrossAuthorisedInTime`
- `CTWalletSameAuthorisedDeferred`
- `CTWalletCrossAuthorisedDeferred`
- `CTWalletSamePreAuthorisedInTime`
- `CTWalletSamePreAuthorisedDeferred`
- `VerifiableAuthorisationToOnboard` (used during the conformance accreditation process)
- `VerifiableAccreditationToAttest` (used during the conformance accreditation process)

These are **conformance-test fixtures**, not domain credentials. The issuer-mock will not mint a `LegalProfessionalAccreditation` for us. This is the most important update relative to round 1, where we assumed we could "use a hand-crafted `LegalProfessionalAccreditation` JWT" against the conformance issuer.

This forks the lawyer-credentialing path. See **Three lawyer-credential paths** below.

### 3. The conformance trust-chain onboarding IS partially self-service

`hub.ebsi.eu/conformance/build-solutions/accredit-and-authorise-functional-flows` documents the flow:

1. Generate a `did:ebsi` v1 with ES256 + ES256K keys (CLI tool helps).
2. Request a `VerifiableAuthorisationToOnboard` from the Conformance Issuer (acts as Root TAO in conformance).
3. Use the credential to register the DID document on the EBSI testnet via signed Ethereum tx.
4. Request a `VerifiableAccreditationToAttest` — Conformance Issuer "invites" the legal entity into the trust chain.
5. Register the accreditation in the Trusted Issuers Registry (TIR).

The Conformance Issuer is gatekeeping each step — it's not "click a button and you're in" — but it's documented, scripted, and aimed at developers preparing to self-onboard. If we onboard ourselves as a TI in conformance during the build, we can issue our own credential type (e.g. `LegalProfessionalAccreditation`) from our own DID, and the official library will walk the trust chain back to the Conformance Issuer's Root TAO and **verify successfully**.

This is more work than mocking, but it produces the strongest demo story.

### 4. EAS on anvil is a deploy-from-source job

The canonical EAS deployment uses fixed predeploy addresses on Base (`0x4200…0021` for `EAS`, `0x4200…0020` for `SchemaRegistry`). Those don't exist on a fresh anvil chain. To use EAS on anvil we must:

- Clone `eas-contracts`, run their deploy script against `http://localhost:8545`, capture the addresses.
- Or: pin the bytecode at the Base canonical addresses with `vm.etch` in Foundry tests; doesn't help a live demo since anvil and the frontend run different processes.
- Or: skip EAS entirely and bake the attestation logic into our escrow contract directly (one struct per attestation, mapping by recipient).

The third option is genuinely tempting. EAS adds an extra contract dependency that buys us "this is the standard attestation primitive" framing — but for a hackathon demo on anvil, the framing wins are smaller than the deploy-step risk. **See option D below.**

### 5. Verification is HTTP, not a chain RPC call

This was implicit in round 1 but worth stating loudly: `verifyCredentialJwt` makes off-chain HTTP calls to the EBSI registries (`did-registry`, `trusted-issuers-registry`, `trusted-schemas-registry`). It does not require any blockchain RPC. Our verifier service is a Node process making HTTPS calls. Anvil has nothing to do with EBSI verification — it's only the L2 substitute for the escrow contract. This decoupling is a feature: we can demo the EBSI side with stable internet alone, even if anvil dies.

### 6. Walt.id can self-issue EBSI-format VCs without onboarding

`walt.id` documents an "EBSI without trust framework" path: issue a JWT VC signed by a `did:key` using the `jwk_jcs-pub` multicodec. The result is W3C-compliant and EBSI-format, but **fails accreditation-chain validation** (no path back to a Root TAO). The library will accept it only if we pass `validateAccreditation: false` in `VerifyCredentialOptions`.

This is a "Plan C if conformance breaks on stage" option, not a primary path. Disclosing `validateAccreditation: false` on stage destroys the story. Fine as a hidden fallback.

## Three lawyer-credential paths

Pick exactly one as the primary, keep one as a backup.

### Path A — Self-onboard as TI in EBSI conformance (strongest, most work)

We generate our own `did:ebsi`, walk through the conformance accreditation flow, become an accredited TI, then issue a `LegalProfessionalAccreditation` credential from our own issuer endpoint to a lawyer's `did:key` wallet.

**Demo story:** "We onboarded ourselves into EBSI's conformance trust chain as a Trusted Issuer. In production this entity is a bar association. Today it's us, simulating that role. The library walks the trust chain back to the EBSI Conformance Root TAO."

**What's real:** issuer DID, accreditation chain, signature, trust walk, library verification.

**What's framed honestly:** the lawyer's specific bar admission is data we put in the credential subject — we are the issuer, not the Madrid bar association. The verification is real, the issuer-as-bar-association is the simulation.

**Cost:** ~1 day of plumbing (DID generation, key handling, transaction to register DID on EBSI testnet, multiple round-trips with the Conformance Issuer). The first time someone does this it tends to take 4–8 hours; the docs are dense.

**Risk:** if the conformance issuer is flaky or rate-limits us during onboarding the day before the hackathon, we lose this path.

### Path B — Use CT credential types as proxies (simplest, weakest framing)

Request `CTWalletSamePreAuthorisedInTime` from the conformance issuer-mock. Treat it as a stand-in for `LegalProfessionalAccreditation`. Verification is real; the credential just doesn't carry our domain claims.

**Demo story:** "This is a real EBSI conformance credential, issued by the EU's public test issuer, verified by the EU's own library. In production the credential type is `LegalProfessionalAccreditation` issued by a bar association. The verification code path is identical."

**What's real:** issuer (EBSI Conformance Issuer), accreditation chain, signature, trust walk, library verification.

**What's framed honestly:** the credential type is wrong. The judge sees `CTWalletSamePreAuthorisedInTime` in the trace panel.

**Cost:** ~2 hours, the issuer-mock does almost everything for us.

**Risk:** sharp judge calls out the credential type. We answer with the same line as "Is the issuer a real bar association? No, it's the conformance environment." — but we're now answering it twice on the same axis.

### Path C — Self-issued with did:key + walt.id, no trust chain

Issue our own `LegalProfessionalAccreditation` JWT VC from a local `did:key`. Verify with `validateAccreditation: false`.

**Demo story:** "Real EBSI-format JWT VC, real signature verification by the official library." (Don't bring up the trust chain unless asked. If asked, describe the production chain — RTAO/TAO/TI — as separate institutional work.)

**What's real:** signature, JWT structure, library verification path.

**What's framed honestly:** we skipped the accreditation chain check. This is the weak link a sharp judge will spot in the trace panel ("`validateAccreditation: false`").

**Cost:** ~half a day with walt.id docs, less if we hand-write a JWT signer.

**Risk:** the credibility win the hackathon needs is "the EU's library said yes," and we're disabling part of what that library checks.

### Recommendation

**Primary: Path A.** It's the most work and the highest payoff. The hackathon thesis is "lawyers cryptographically verified as real EU bar members." Path A is the only one where the verifier walks the chain to a real Root TAO. Onboard as TI on day 1 of build, then everything else slots in.

**Backup: Path B.** If Path A onboarding stalls, fall back to CT credential types and rehearse the framing. Don't rehearse Path C — disclosing it on stage hurts more than it helps; keep it as a silent last resort if internet dies and we're showing local-only.

## Anvil reframe — what changes from spec round 1

Round 1 targeted Base Sepolia. Round 2 (this doc) targets local anvil. Net deltas:

| Layer | Round 1 (Base Sepolia) | Round 2 (anvil) |
|---|---|---|
| L2 RPC | `https://sepolia.base.org` (or Alchemy) | `http://localhost:8545` |
| Chain ID | 84532 | 31337 |
| EAS contracts | Already deployed at canonical Base predeploy addresses | **We deploy from source** in our Foundry script, save addresses to a file, frontend reads them on startup |
| Block explorer | basescan.org | None — render pretty tx receipts in the side panel ourselves; this is fine on stage and avoids third-party-down risk |
| Faucet | Base Sepolia faucet | Pre-funded anvil accounts (`anvil` exposes 10 wallets with ETH at boot) |
| Backup RPC | Two providers | None needed — anvil is on the laptop. Bigger risk is a process crash, not a network outage |
| EBSI verification | Unaffected | Unaffected |
| EUDI verification | Unaffected | Unaffected |
| ZK proof | Unaffected | Unaffected |

**The one risk anvil introduces:** chain state is in-memory. Restart anvil and our schemas + escrow + attestations are gone. Rehearsal must include "what happens if anvil dies mid-demo" — which is "shell into anvil, replay the deploy script, redo the demo from screen one." Two-minute recovery max if scripted. Acceptable.

**Mitigation:** start anvil with `--dump-state` and `--load-state` so a known-good state can be restored. Run a `make demo-reset` target that dumps anvil, redeploys EAS + escrow, registers schemas, and prints the addresses. Pre-warm the state file before going on stage.

## Option D — drop EAS, bake attestations into the escrow contract

Genuinely worth considering on anvil:

```solidity
struct LawyerAttestation {
    string ebsiDid;
    string jurisdiction;
    string specialty;
    uint64 verifiedAt;
    bool valid;
}

mapping(address => LawyerAttestation) public lawyers;

function attestLawyer(
    address lawyer,
    string calldata ebsiDid,
    string calldata jurisdiction,
    string calldata specialty
) external onlyVerifierBackend {
    lawyers[lawyer] = LawyerAttestation(ebsiDid, jurisdiction, specialty, uint64(block.timestamp), true);
}
```

**Pro:** one fewer dependency to deploy on anvil. Demo only needs anvil + our contract. The "attestation lives on chain" framing still holds — it's just our own attestation registry instead of EAS's.

**Con:** loses the "we use the standard attestation primitive used across Ethereum" narrative. EAS is a real talking point with judges who know the ecosystem.

**Verdict:** stick with EAS for the credibility hook, but write a Foundry script that deploys EAS + SchemaRegistry + escrow + registers the two schemas in one shot. ~150 lines of Solidity script, one-time cost.

## Updated day-by-day plan

### Day 1 — chain stack on anvil
- Foundry project. Write `LegalEngagementEscrow.sol` exactly as in round 1, but unchanged.
- Deploy script: anvil → deploy `SchemaRegistry` → deploy `EAS(SchemaRegistry)` → register lawyer + client schemas → deploy `LegalEngagementEscrow(EAS, lawyerSchemaUid, clientSchemaUid, treasury)` → write addresses to `deployments/anvil.json`.
- Foundry tests against anvil with full coverage on the four state transitions.
- `make demo-reset` command: `anvil --dump-state state.json` + replay deploy. Runtime under 10s.
- **Start the EBSI conformance onboarding paperwork in parallel on day 1.** It runs unattended overnight if needed.

### Day 2 — EBSI verifier
- Backend service, Fastify, TypeScript.
- `@europeum-ebsi/verifiable-credential` import, `verifyCredentialJwt` against `api-test.ebsi.eu` (or `api-conformance.ebsi.eu` if Path B).
- If Path A succeeded on day 1: our own issuer endpoint that mints `LegalProfessionalAccreditation` to a lawyer wallet, signed with our newly accredited `did:ebsi` key.
- `/api/lawyer/verify-credential` endpoint, calls `verifyCredentialJwt`, on success calls `EAS.attest` via viem with our verifier-backend signer.
- SSE stream of trace events to the frontend side panel.

### Day 3 — EUDI PID + ZK
- EUDI verifier endpoint via Docker (`docker compose up`).
- `/api/client/verify-pid` calls EUDI verifier, gets selective-disclosure subset.
- Noir circuit, compile, generate proving key.
- `noir_js` proof in browser, post to `/api/client/zk-verify`, on pass call `EAS.attest` for client.

### Day 4 — frontend + integration
- Three pages, side panel SSE consumer.
- Render anvil tx receipts ourselves, no block explorer needed.
- Five rehearsals, time each section, cut whatever drags.
- Backup video.

## Decisions needed from you

1. **Lawyer credential path** — Path A (self-onboard as TI), Path B (CT types as proxy), or Path C (did:key self-issue)? My recommendation: Path A primary, Path B backup.
2. **EAS or homemade attestation registry?** Recommendation: keep EAS, write the deploy script once.
3. **Library: `@europeum-ebsi` or `@cef-ebsi`?** Recommendation: `@europeum-ebsi` — newer governance, current docs.
4. **Conformance host: `api-conformance.ebsi.eu` or `api-test.ebsi.eu`?** They differ in stability and exposed mocks. Default to `api-test.ebsi.eu` for the verifier (more like production), `api-conformance.ebsi.eu` for any wallet/issuer testing we run. Need to confirm both reachable from your network before day 1.
5. **EUDI verifier — Docker locally vs hosted reference verifier?** Local Docker is the round-1 plan and still right for anvil since "everything on the laptop" is the new theme.

## Sources

- [EBSI hub — Issuer Trust Model v3](https://hub.ebsi.eu/vc-framework/trust-model/issuer-trust-model-v3)
- [EBSI hub — Verifiable Credential library](https://hub.ebsi.eu/tools/libraries/verifiable-credential)
- [EBSI hub — How to verify a credential](https://hub.ebsi.eu/vc-framework/guidelines/verify-credentials)
- [EBSI hub — Holder wallet functional flows](https://hub.ebsi.eu/conformance/build-solutions/holder-wallet-functional-flows)
- [EBSI hub — Verifier functional flows](https://hub.ebsi.eu/conformance/build-solutions/verifier-functional-flows)
- [EBSI hub — Issue to holder flows](https://hub.ebsi.eu/conformance/build-solutions/issue-to-holder-functional-flows)
- [EBSI hub — Accredit RTAO/TAO/TI](https://hub.ebsi.eu/conformance/build-solutions/accredit-and-authorise-functional-flows)
- [EBSI hub — VC issuance learning page](https://hub.ebsi.eu/conformance/learn/verifiable-credential-issuance)
- [@cef-ebsi/verifiable-credential on npm](https://www.npmjs.com/package/@cef-ebsi/verifiable-credential)
- [walt.id — EBSI without trust framework](https://docs.walt.id/community-stack/issuer/ecosystems/ebsi/issuance/issuance-without-trust-framework)
- [eas-contracts on GitHub](https://github.com/ethereum-attestation-service/eas-contracts)
- [EAS docs](https://docs.attest.org/)
