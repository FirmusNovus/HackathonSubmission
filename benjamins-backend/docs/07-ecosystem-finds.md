# Research findings — round 5 (official EU/EBSI/EUDI projects we can leverage)

Reading order: [01-summary.md](01-summary.md) → [02-spec.md](02-spec.md) → [03-demo.md](03-demo.md) → [04-research-findings.md](04-research-findings.md) → [05-deeper-research.md](05-deeper-research.md) → [06-simpler-paths.md](06-simpler-paths.md) → this doc.

Prior rounds settled on **Path F** (one-library round-trip, did:key issuer, EBSI library both sides). Round 5 dug into the official EU/EBSI/EUDI repo ecosystem to find projects we can use directly. Two real simplifications fall out of this round, and a couple of "good to know but skip" leads that I'm flagging so we don't relitigate.

## The unlocks

### 1. wwWallet — fully browser-based EUDI wallet

`https://demo.wwwallet.org` runs a complete EUDI wallet as a Progressive Web App. Source at `github.com/wwWallet/wallet-frontend`. The org has 15 repos, full ecosystem (frontend, backend, issuer, verifier).

What this means for us: **the demo doesn't need a phone**. The lawyer's "wallet" can be wwWallet in a 2nd browser tab on the same laptop, or on a 2nd laptop. Same for the client. WebAuthn for keys, IndexedDB for storage, OID4VCI + OID4VP fully client-side. Drops the "bring an Android with the EUDI ref wallet installed" line item from the day-of checklist.

Caveats:
- wwWallet's docs state "Getting Started: TBD" — developer integration docs are thin. We may need to read source to understand exactly what issuer profiles it accepts.
- It's a third-party PWA that could change between now and the hackathon. **Mitigation:** clone the repo on day 1 and host our own copy of `wallet-frontend` if we want zero dependency on the hosted demo.
- Whether wwWallet accepts arbitrary did:key issuers vs only certain pre-configured ones isn't confirmed in docs. Test on day 1.

### 2. The EU's hosted EUDI services replace our local Docker

Round-1 spec assumed we'd run `eudi-srv-verifier-endpoint` in Docker locally. The recruitment demo proves we can just hit:

- `https://verifier.eudiw.dev` — verifier (OID4VP)
- `https://issuer.eudiw.dev` — PID/mDL/(Q)EAA issuer (OID4VCI)
- `https://dev.verifier.eudiw.dev` and `https://dev.issuer.eudiw.dev` — dev endpoints

These are hosted by the European Commission. **Drop the local Docker EUDI verifier** from the spec. Saves a docker-compose entry, faster cold start, less to fail.

Caveats:
- They're labelled "initial development release, do not use in production." Fine for hackathon demo, but they could be down or rate-limited. **Mitigation:** ping them on day 1, have a pre-recorded backup video.
- Reachability from the venue WiFi is the same risk as reaching `api-conformance.ebsi.eu`. Demo internet hygiene applies equally.

### 3. The recruitment demo is our blueprint, not our codebase

`github.com/eu-digital-identity-wallet/eudi-web-recruitment-service-demo` is a Next.js 15 + TypeScript app that does **structurally exactly what we need**: PID verification + optional professional qualification verification + credential issuance back to wallet + QES contract signing. Apache 2.0.

But it carries baggage:
- Material-UI for components (heavy, opinionated)
- Prisma + Postgres ORM (complex schema, migration overhead)
- TypeDI for DI (academic, slows iteration)
- Hexagonal Architecture / Domain-Driven Design (great for production, overkill for 4 days)
- Java keystore for JWT signing

**Verdict:** read it as a reference for the EUDI integration patterns (specifically `/src/server/verification/` and `/src/server/issuance/`), but **don't fork**. We'd spend more time stripping out recruitment-specific code than we'd save on EUDI plumbing. Build our own simpler app with Next.js + Tailwind (matching round-1 spec's stack), copy the EUDI API call patterns.

The companion demo `eudi-web-booking-service-demo` exists too — same pattern, smaller scope. Reference equally.

## Other notable finds — categorized

### Things we should know about but won't use

**Credo-TS** (`openwallet-foundation/credo-ts`). TypeScript framework for OID4VCI/OID4VP, supports W3C VC + SD-JWT VC. Production-grade, used by Animo's EUDI Wallet Prototype. Heavier than `@cef-ebsi/verifiable-credential` but covers more standards.
- *When to switch:* if `@cef-ebsi/verifiable-credential` proves bumpy on day 2, Credo-TS is the next-best lib.
- *Today:* stick with `@cef-ebsi/verifiable-credential` per round 4, Credo-TS in pocket.

**EBSI-VECTOR** open-source EBSI issuer + verifier wallet. AGPL-3.0 + commercial. Two-module: BackOffice + Entity Service.
- *Issue:* AGPL-3.0 is sticky for any commercial follow-up. Hackathon-fine, but adds licence considerations later.
- *Verdict:* skip unless we hit a specific EBSI integration we can't solve otherwise.

**Animo Paradym** wallet. Open-source mobile wallet (App Store + Play Store). EUDI-aligned. Animo also runs `https://playground.animo.id/` for testing OID4VP.
- *When to use:* if we want a polished OID4VP request to test against on day 1. Animo Playground is a good integration testing harness.
- *Otherwise:* skip — wwWallet covers the wallet role.

**EBSI CLI** (`hub.ebsi.eu/tools/cli`). Has a `presentation-exchange` command that drives the auth-mock + issuer-mock dance against the EBSI conformance environment.
- *When to use:* if we fall back to Path B (CT credential type as proxy from conformance issuer-mock), the CLI replaces our OID4VCI client code.
- *Otherwise:* skip — Path F doesn't need it.

**`eudi-srv-web-issuing-eudiw-py`** — Python issuer for PID, mDL, (Q)EAA. The reference issuer behind `issuer.eudiw.dev`.
- *When to use:* if we want to self-host an issuer for full demo control. Probably not needed since we're building our own minimal issuer for the lawyer credential anyway.
- *Otherwise:* skip — knowledge of its existence is enough.

**OpenWallet Foundation TypeScript trio** — `openid4vc-ts`, `dcql-ts`, `openid-federation-ts`. Animo-incubated.
- *When to use:* if we go beyond `@cef-ebsi/verifiable-credential` and want maximum standards-compliance.
- *Otherwise:* skip — Path F handles what we need.

### Things we'll absolutely use

**`@cef-ebsi/verifiable-credential`** (Path F, round 4) — issue + verify on the lawyer side.
**`@sd-jwt/sd-jwt-vc`** (or fall through to whatever the EUDI verifier produces) — for the client PID side.
**Hosted EUDI services** at `verifier.eudiw.dev` and `issuer.eudiw.dev` — drops local Docker.
**wwWallet** (`demo.wwwallet.org`) — browser wallet for stage demo; clone source as fallback.
**Recruitment demo** — code reference for EUDI integration patterns, not a fork.

## Updated stack

| Concern | Round 1 spec | Round 5 stack |
|---|---|---|
| Lawyer credential issuance | EBSI conformance issuer-mock (CT types only) | Our backend with `@cef-ebsi/verifiable-credential` did:key issuer |
| Lawyer credential verification | `@cef-ebsi/verifiable-credential` against conformance | Same library, `validateAccreditation: false` |
| Lawyer wallet UX | Phone wallet implied | **wwWallet in browser tab** (or localStorage popup) |
| Client PID issuance | `issuer.eudiw.dev` | Same — confirmed reachable, no local Docker needed |
| Client PID verification | Local Docker EUDI verifier | **`https://verifier.eudiw.dev` direct** |
| Client wallet UX | Phone wallet implied | **wwWallet or EUDI ref Android app** |
| OID4VCI/OID4VP libraries | EBSI Kotlin libs (mentioned but not specified) | None on lawyer side (skip OID4VCI per round 4); hosted EUDI services on client side |
| L2 + EAS + escrow | Base Sepolia | Anvil local (per round 2) |
| ZK | Noir | Unchanged |

## Day-1 reachability checklist

Before committing to this stack, verify on day 1 that all of these respond:

- [ ] `curl -I https://verifier.eudiw.dev` returns 2xx/3xx
- [ ] `curl -I https://issuer.eudiw.dev` returns 2xx/3xx
- [ ] `https://demo.wwwallet.org` loads and a credential can be added from any test issuer
- [ ] `npm install @cef-ebsi/verifiable-credential` succeeds and `verifyCredentialJwt` runs against `api-test.ebsi.eu`
- [ ] `anvil --version` works, foundry installed
- [ ] EAS contracts clone + deploy script runs locally

If any item fails, fall back per the section it relates to.

## What round 5 doesn't change

- Path F remains primary lawyer-credential strategy.
- Path B (CT type from conformance) remains backup. EBSI CLI's `presentation-exchange` command makes Path B even easier to fall back to.
- ZK + EAS + escrow on anvil unchanged.
- Demo script (round 1's [03-demo.md](03-demo.md)) needs minor edits for the wwWallet + hosted-verifier swaps but no structural changes.

## Open question to settle on day 1

**Does wwWallet accept did:key issuers for OID4VCI?** If yes, we run a complete real OID4VCI flow into wwWallet from our Path F issuer. If no, we either (a) use `did:web` rooted at our domain (likely better-supported), or (b) skip OID4VCI entirely and ship the credential to the lawyer's session via direct API + localStorage. Either way is acceptable; this just decides which demo theatrics we use.

The decision can be deferred to whenever we first try to issue a credential into wwWallet — should be inside day 1.

## Sources

- [eudi-web-recruitment-service-demo](https://github.com/eu-digital-identity-wallet/eudi-web-recruitment-service-demo)
- [eudi-web-booking-service-demo](https://github.com/eu-digital-identity-wallet/eudi-web-booking-service-demo)
- [eu-digital-identity-wallet GitHub org](https://github.com/eu-digital-identity-wallet)
- [wwWallet GitHub org](https://github.com/wwWallet)
- [wwWallet demo](https://demo.wwwallet.org)
- [EUDI Verifier hosted](https://verifier.eudiw.dev)
- [EUDI Issuer hosted](https://issuer.eudiw.dev)
- [Credo-TS](https://github.com/openwallet-foundation/credo-ts)
- [Credo-TS openid4vc package](https://github.com/openwallet-foundation/credo-ts/tree/main/packages/openid4vc)
- [Animo Paradym wallet](https://github.com/animo/paradym-wallet)
- [Animo Playground](https://playground.animo.id/)
- [EBSI-VECTOR](https://www.ebsi-vector.eu/en/news/open-source-reference-implementation-of-an-issuer-and-verifier-wallet-for-ebsi/)
- [EBSI CLI commands](https://hub.ebsi.eu/tools/cli/commands)
- [eudi-srv-web-issuing-eudiw-py](https://github.com/eu-digital-identity-wallet/eudi-srv-web-issuing-eudiw-py)
- [OpenWallet Foundation projects](https://openwallet.foundation/projects/)
