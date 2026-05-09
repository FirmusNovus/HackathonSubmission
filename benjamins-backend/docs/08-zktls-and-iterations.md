# Research findings — round 6 (zkTLS / Reclaim Protocol + project iterations)

Reading order: [01-summary.md](01-summary.md) → [02-spec.md](02-spec.md) → [03-demo.md](03-demo.md) → [04-research-findings.md](04-research-findings.md) → [05-deeper-research.md](05-deeper-research.md) → [06-simpler-paths.md](06-simpler-paths.md) → [07-ecosystem-finds.md](07-ecosystem-finds.md) → this doc.

This round explored a fundamentally different verification primitive (zkTLS) and re-examined the project shape itself for iterations that preserve the core promise but cut implementation surface. Net result: **Path F stays primary**, but with several pitch and stretch-goal additions that meaningfully strengthen the story without adding much code.

## The big lead I chased — Reclaim Protocol / zkTLS — and why it's not simpler

### What zkTLS is, and why it's exciting

Reclaim Protocol (and similar: zkPass, Pluto, Opacity Network) generates **zero-knowledge proofs about the contents of a TLS session you participated in**. Translated: the user logs into any website, and a cryptographic proof gets generated that "the user saw this specific data on that domain over an authenticated TLS connection." The proof is verifiable by anyone, on chain or off, without revealing the user's credentials or any other session content.

Concretely for our project, the appeal was: instead of "we are the issuer standing in for a bar association" (Path F's compromise), **we'd verify against the bar association's own member portal**. Real source of truth. Real cryptographic guarantee. No `validateAccreditation: false` flag in the trace panel.

The on-chain story is good too: `@reclaimprotocol/verifier-solidity-sdk` exposes a `verifyProof()` function that any contract can call. We import it into our escrow contract, the escrow itself becomes the verifier — proofs go straight on chain. Hardhat-deployable on anvil with a custom config.

### Where it falls down for *our* demo

Reclaim's value comes from **proving you're the user behind a logged-in session**. For a verification to mean "I am lawyer X admitted in jurisdiction Y," the user has to log into something that knows them as lawyer X. Three concrete obstacles for the German case:

1. **BRAK's public registry (`bravsearch.bea-brak.de`) is anonymous**. Anyone can search anyone. A Reclaim proof against it shows "lawyer X exists" but not "I am lawyer X." Worthless as identity proof.

2. **beA, the authoritative German lawyer login portal, requires a physical chip card + PIN + USB chip reader**. Logging in for a Reclaim proof means provisioning hardware for our demo lawyer. Not hackathon-feasible.

3. **Custom-provider development is non-trivial.** Reclaim provides an AI-assisted devtool, but reverse-engineering a portal's HTTPS requests and tagging the right regex/JSONpath fields is still a ~half-day job per provider, and there's no prebuilt provider for any EU bar association in their default schema library.

Other countries have similar shapes — public registries are anonymous, member portals are gated by smartcards or two-factor.

### The honest assessment

zkTLS is a real Web3-native primitive and would be a strong production story. **For the hackathon, it's not simpler than Path F** — it's at best parity in build effort, and the integration risk is higher (BRAK could block the proxy attestor, Reclaim's hosted infrastructure could be down on stage, custom provider development could overrun). The "real bar" upside is real, but the "real bar" claim only holds if we successfully integrate against a real authenticated portal — which is the hardest part.

### The piece worth keeping

Reclaim makes the *pitch* stronger even if it's not in the demo. Add one slide:

> **Verification dual-stack.** Lex Nova accepts: (a) EBSI verifiable credentials when bar associations onboard as TIs, (b) EUDI ARF qualified attestations when QTSPs issue them, (c) **zkTLS proofs against existing bar member portals** in jurisdictions where neither (a) nor (b) is yet available. Same on-chain attestation contract; multiple ingress paths.

This costs zero code and makes the pitch broader. Useful Q&A line for "what if EBSI rollout is slow?" — answer: zkTLS bridges the gap, here's the protocol, here's where to onboard.

## What I checked alongside Reclaim and ruled out

- **zkPass** — similar to Reclaim, has 200+ schemas, native Chrome extension. Slightly less browser-friendly than Reclaim's no-extension flow. No advantage for us over Reclaim.
- **Opacity Network** — uses EigenLayer AVS for security guarantee. More complex integration. No advantage for hackathon.
- **Pluto** — TLSNotary-based, "five lines of code to integrate." Earlier-stage than Reclaim. Same fundamental constraint (need authenticated portal).
- **PSI / hash commitments without ZK for conflict check** — would lose the privacy guarantee against a dictionary-attacking lawyer. Noir non-membership is the right primitive at our scale.
- **Hosted ZK prover services** (RISC Zero Bonsai, Aleo, Succinct) — heavier than Noir local-prove for an N=8 circuit. Adds an external dependency that can fail on stage. Skip.
- **WorldID / Proof-of-personhood protocols** — verify humanness, not profession. Wrong primitive for lawyer side. Maybe useful for client-side AML check as a slide-only mention.
- **ENS / SBT-based credentials** — depends on someone (a bar association) actually issuing SBTs, which they don't. Same chicken-and-egg as EBSI TI accreditation.

## Project iterations — simplifying without compromising the promise

The promise (per [01-summary.md](01-summary.md)): three claims defensible on stage — (1) lawyers verified as real EU bar members, (2) clients pseudonymous via ZK, (3) money flows through smart-contract escrow. If all three are real, the thesis works. If any is mocked, the story collapses.

Iterations that **preserve** all three claims while cutting surface area:

### Iteration A — Pre-stage the lawyer onboarding

Already raised in round 4. Run the lawyer credential flow once before stage time, persist with `anvil --dump-state`. On stage, the lawyer's EAS attestation is already on chain when anvil boots. We scroll back through recorded trace logs — "this happened at 9:00 this morning, look at the chain state."

- **Cuts:** ~1 minute of stage time, full failure surface for issuer/verifier/EAS-write.
- **Preserves:** all three real claims (the verification *did happen*, just earlier).
- **Cost:** nothing — it's a stage-time decision, not a code decision.
- **Honesty:** must not pretend it happened live. Show timestamps, narrate "this was earlier today."

**Verdict:** prepare both live and pre-staged variants. Pick at rehearsal time.

### Iteration B — Single-jurisdiction demo, multi-jurisdiction in the deck

Round-1 pitch leans on cross-border ("Spanish founder, German lawyer"). The *demo* doesn't need to actually swap jurisdictions live. One lawyer (e.g. German), one client (any nationality via PID), one engagement.

- **Cuts:** zero code — the spec was already single-pair on stage.
- **Preserves:** all three claims.
- **Cost:** none.
- **Note:** this isn't really a simplification, it's a clarification. The original spec was already single-jurisdiction in the live flow. Just don't get sucked into demoing both sides of cross-border live.

### Iteration C — Drop tier 1 and tier 3 from the demo, keep them on the architecture slide

Three-tier model (anonymous info / pseudonymous-credentialed / fully-identified) is a product framing. The demo only does tier 2 (pseudonymous-credentialed). Tier 1 is "answer a question without onboarding" and tier 3 is "lift the seal." Both are slide-only.

- **Cuts:** mental load on stage. Audience hears three tiers and may expect three demo flows.
- **Preserves:** the conceptual model intact in slides.
- **Cost:** none — already the spec, just keep it crisp.

**Verdict:** rewrite one architecture slide to make tier 2 visually prominent ("today's demo") and tiers 1/3 in the periphery ("future tiers we're built for").

### Iteration D — Make the side panel UX the demo's center of gravity

Round-1 spec correctly identified this: the verification trace panel is the demo's most important visual. Iterating on this — not on the underlying crypto — is the highest-leverage build investment.

What the panel must show, in order of importance:
1. **Network calls to EBSI/EUDI services with response codes** (most credibility-buying line item)
2. **Trust chain walk visualization** — "TI → TAO → Root TAO" with arrows
3. **ZK proof generation timer** — bar that fills, exact ms count
4. **Tx receipts** — anvil block, gas, attestation UID

Spend a half-day making this look like a real production audit panel. Tailwind + a tiny animation library. **This is the single most important UX decision for credibility.** If the trace panel looks janky, the crypto looks unconvincing even if it's all real. If the trace panel looks like a forensic audit, judges feel the rigor.

### Iteration E — Skip OID4VCI on the lawyer side (already in round 4)

Direct API call from lawyer's session into our backend, JWT VC stored in localStorage with a "MetaMask-style credentials popup" UI. Saves the OID4VCI dance, ~2 hours. Visually conveys the wallet metaphor without faking standards-compliance. This is a strict simplification with no story cost.

### Iteration F — Drop EUDI client-side, replace with Reclaim

Real consideration but I recommend against it. Reasoning:

- Round-1 pitch leans on EUDI Wallet rollout. Replacing it with Reclaim costs that talking point.
- Hosted EUDI services (`verifier.eudiw.dev`) are reachable today (round 5 finding), so the EUDI side is *already* simple — no Docker needed.
- Reclaim for client-side has the same login-portal problem as for lawyer-side.

**Verdict:** keep EUDI for client side. Don't simplify what's already simple.

### Iteration G — Compress the demo runtime to 3:00 minutes

Round-1 demo target is 4:30. Most hackathons cap at 3:00. Forcing a tighter cut early disciplines us:

- Hook: 0:30 (no change)
- Lawyer onboarding: 0:30 (compressed; pre-staged or live trace replay)
- Client onboarding: 1:00 (live PID + ZK)
- Engagement: 0:45 (create + fund + release in one breath)
- Close: 0:15 (one slide, one sentence)

Total: 3:00. Buys us a buffer if we run long.

- **Cuts:** narrative breathing room.
- **Preserves:** all three claims demonstrated live.
- **Cost:** discipline in rehearsal — every section has a hard cut.
- **Verdict:** target 3:00, allow 4:30 on the day. Plan for the tighter version.

## The combined plan

Putting all six rounds together:

| Layer | Decision |
|---|---|
| Lawyer credential issuance | **Path F** — `@cef-ebsi/verifiable-credential` with did:key issuer in our backend |
| Lawyer credential verification | Same library, `validateAccreditation: false` framed as "production: validates against EBSI TIR" |
| Lawyer wallet UX | wwWallet in browser tab if it accepts did:key, else localStorage popup (decide day 1) |
| Lawyer flow OID4VCI | Skip — direct API + localStorage |
| Client PID issuance source | `https://issuer.eudiw.dev` (hosted) |
| Client PID verifier | `https://verifier.eudiw.dev` (hosted, no local Docker) |
| Client wallet UX | wwWallet in 2nd browser tab |
| ZK conflict check | Noir, N=8 commitments, browser proof |
| L2 | Anvil with `--dump-state`/`--load-state` |
| EAS | Deploy from source on anvil, foundry script |
| Escrow contract | `LegalEngagementEscrow.sol` per round-1 spec |
| Pitch additions | zkTLS slide as "verification dual-stack" future option |
| Demo runtime target | 3:00, allow 4:30 |
| Pre-stage lawyer flow | Decide at rehearsal |
| Side panel polish | Half-day investment, highest leverage UX work |

## What's no longer in scope (decisions made across rounds)

- ❌ Self-onboarding as TI in EBSI conformance (Path A) — too slow
- ❌ EUDI ARF SD-JWT pivot for lawyer (Path E) — Path F is simpler
- ❌ Forking the recruitment demo — too heavy
- ❌ Local Docker for EUDI verifier — hosted services work
- ❌ Reclaim Protocol live in demo — integration risk for the bar verification specifically
- ❌ Base Sepolia — anvil instead
- ❌ XMTP messaging, ERC-5564 stealth addresses, BBS+ — never were in scope per round 1
- ❌ Backend rate-limit / multi-RPC failover — anvil is local
- ❌ Block explorer integration — render tx receipts ourselves

## What's still open

- Whether wwWallet accepts did:key issuers — day 1 verification
- Whether Reclaim Protocol's `verifier-solidity-sdk` deploys cleanly on anvil chain ID 31337 — only relevant if we add Reclaim as a stretch goal demo
- EAS deploy script bytes — write it on day 1, save the addresses to `deployments/anvil.json`
- ZK circuit final form — N=8 sized for ~3s browser proof, may need to tune

## Sources

- [Reclaim Protocol docs](https://docs.reclaimprotocol.org/)
- [Reclaim Protocol JS SDK](https://github.com/reclaimprotocol/reclaim-js-sdk)
- [Reclaim Solidity SDK](https://github.com/reclaimprotocol/reclaim-solidity-sdk)
- [Reclaim on-chain Solidity quickstart](https://docs.reclaimprotocol.org/onchain/solidity/quickstart)
- [zkPass overview](https://docs.zkpass.org/overview/introduction)
- [BRAK lawyer registry (BRAVSearch)](https://bravsearch.bea-brak.de/)
- [beA portal](https://bea.brak.de/)
- [Authenticated PSI Merkle-tree paper](https://arxiv.org/abs/2506.04647)
