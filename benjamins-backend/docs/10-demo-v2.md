# Demo v2 — Stage Script

Companion to [09-spec-v2.md](09-spec-v2.md). Round-1 script at [03-demo.md](03-demo.md) preserved for the diff.

## Total runtime target: 3:00 minutes, allow 4:30

Three live ceremonies — lawyer onboarding, client onboarding, engagement. Both users start unrecognized and are onboarded live on stage. ZK conflict-check runs at engagement creation, not at onboarding.

## Pre-show checklist

- [ ] Two laptops, both connected to venue WiFi and a phone hotspot
- [ ] Anvil running with pre-deployed contracts (no profiles yet) — `anvil --load-state state.json`
- [ ] Platform Next.js app running on `lex-nova.local:3000` on both laptops
- [ ] Both laptops' demo Chrome profiles opened to `https://demo.wwwallet.org` in a 2nd tab
- [ ] **Lawyer laptop's wwWallet** has two credentials:
  - PID issued by `issuer.eudiw.dev` (real EU government test issuer)
  - LegalProfessionalAccreditation issued by our seed script's "bar" stand-in
  - *(verify by opening wwWallet's Credentials tab; both should be listed)*
- [ ] **Client laptop's wwWallet** has one credential:
  - PID issued by `issuer.eudiw.dev`
- [ ] MetaMask configured per laptop:
  - Custom network "Anvil" — RPC `http://localhost:8545`, chain ID 31337
  - Anvil prefunded private key imported as the user's account
- [ ] EUDI hosted services pinged in last 10 minutes (`curl -I https://verifier.eudiw.dev`)
- [ ] Backup video of the full 3-minute demo recorded and ready
- [ ] EBSI VC validator (https://hub.ebsi.eu/tools/vc-validator) hidden tab as a credibility prop
- [ ] ZK proving key pre-warmed — visit `/engagement/preflight` once on each laptop
- [ ] Slide deck: hook, architecture, dual-stack closing
- [ ] Phone hotspot tested as backup for venue WiFi

## Stage state at curtain

- Anvil running, EAS contracts deployed, escrow deployed, **no profiles, no attestations**
- Lawyer's wwWallet: PID + LegalProfessionalAccreditation (pre-staged credentials)
- Client's wwWallet: PID (pre-staged)
- Platform DB: empty
- Both MetaMasks: connected to Anvil with prefunded balance

The credentials in the wallets are *external infrastructure* — pretend they came from a bar association months ago and the EU government issued the PID last year. That's the real-world story.

## The hook (0:00 - 0:25)

**On screen:** title slide

**Spoken:**

> "A Spanish startup founder wants to set up a German GmbH. She needs a lawyer admitted in Germany. Today she has two options: upload her ID to a directory site she's never heard of, or pay 600 euros to a Munich firm to find one.
>
> We built a third option. Cryptographically verified lawyers, pseudonymous clients, money in smart-contract escrow. Three minutes."

**Why this works:** specific persona, specific pain, no jargon yet. "Three minutes" sets the contract with the audience.

## Screen one — lawyer onboarding live (0:25 - 1:10)

**Action:** switch to laptop one. Open `lex-nova.local:3000/lawyer/onboard`. Wallet not yet connected.

**On screen, left side:**

- "Welcome to Lex Nova" header
- "Connect Wallet" button — click

**MetaMask popup:** "Sign this message to log in" — click Sign (~3s)

**Page transitions:** "We don't recognize you yet — let's verify your bar admission credential."

**On screen, left side:**

- "Verify yourself" button — click

**Page constructs an OID4VP request and opens wwWallet** in the 2nd tab (or shows the QR if cross-device).

**wwWallet popup:**

```
┌──────────────────────────────────────────────────────┐
│  Lex Nova would like to verify:                      │
│                                                      │
│  ☑  Your Person Identification Data (PID)            │
│      Sharing: nationality, over_18, resident_country │
│      (NOT sharing: name, ID number, date of birth)   │
│                                                      │
│  ☑  Your Legal Professional Accreditation            │
│      Sharing: jurisdiction, specialty, admittedSince │
│                                                      │
│              [ Decline ]    [ Approve Both ]         │
└──────────────────────────────────────────────────────┘
```

User clicks "Approve Both."

**On screen, right side — side panel trace streams:**

```
LAWYER ONBOARDING — DUAL CREDENTIAL CEREMONY
══════════════════════════════════════════════
[09:14:22] SIWE login
           ✓ Signature verified for 0xf39F...92266
           ← session established
[09:14:23] OID4VP request sent to wwWallet
[09:14:24] ← Verifiable Presentation received (2 nested credentials)
           Holder DID:  did:key:zXY7...      (lawyer's wwWallet key)
           Issuers:
             • issuer.eudiw.dev               (PID, IACA-anchored x.509)
             • did:key:zABC...                (bar stand-in)
[09:14:24] @sd-jwt/sd-jwt-vc verifying PID:
             ✓ x.509 chain valid (EU IACA root)
             ✓ Signature valid
             ✓ Disclosed: nationality=DE, over_18=true, resident_country=DE
             Withheld: name, ID number, date of birth, photo
[09:14:25] @sd-jwt/sd-jwt-vc verifying LegalProfAccreditation:
             Format: vc+sd-jwt
             vct:    urn:lex-nova:LegalProfessionalAccreditation
             ✓ Signature (ES256) valid
             ✓ Validity dates 2026-04-01 → 2027-04-01
             ✓ Issuer DID resolved (via @cef-ebsi/key-did-resolver):
               did:key:zABC...
             ✓ cnf.jwk binds credential to holder key
             • Issuer is did:key (production: bar association as a QTSP
               under eIDAS 2 — same vc+sd-jwt format, different trust anchor)
             ✓ Disclosed: jurisdiction=DE, specialty="GmbH formation",
                          admittedSince=2018-09-15
[09:14:25] Three distinct DIDs in this verification:
             holder ≠ bar issuer ≠ verifier (us)
[09:14:25] Writing two EAS attestations on local anvil...
[09:14:26] → Tx 0xabc1... (lawyer schema)
[09:14:26] ✓ Attestation UID 0x9f8e...aab2 in block 17
[09:14:26] → Tx 0xdef4... (client schema)
[09:14:27] ✓ Attestation UID 0x3b7c...9d12 in block 18
[09:14:27] Profile created: capabilities = [verified_lawyer, verified_client]
══════════════════════════════════════════════
```

**Page redirects** to `/dashboard`. Shows "Hans Schmidt" with two badges: *Verified Lawyer* (DE, GmbH formation) and *Verified Client*.

**Spoken (over the panel, ~30 seconds):**

> "Hans signs in with his Ethereum wallet — that's just authentication, no gas. The platform doesn't recognize him, so he proves himself with his EUDI Wallet. Two credentials in one ceremony — his PID from the EU government, and his bar admission credential signed by his bar association. We use selective disclosure on the PID: nationality, over_18, country of residence. Name, ID number, date of birth — never seen.
>
> Three different keys here — wwWallet's holder key, the bar's signing key, our verifier's key. You can see them in the trace. The credential's signature traces back to a key we don't control. The library used is EBSI's own verifiable-credential package; in production the bar is registered as a Trusted Issuer in EBSI's Trusted Issuers Registry — same code path, different DID method.
>
> Two attestations land on chain. Hans is now a verified lawyer *and* a verified client — a practicing lawyer is a citizen first."

**Time check at 1:10.**

## Screen two — client onboarding live (1:10 - 1:50)

**Action:** switch to laptop two. Open `lex-nova.local:3000/client/onboard`. Different MetaMask account.

**Page:** "Connect Wallet" → MetaMask SIWE popup → click Sign (~3s)

**Page transitions:** "We don't recognize you yet — let's verify you're a real EU resident."

**Page constructs an OID4VP request and opens wwWallet:**

```
┌──────────────────────────────────────────────────────┐
│  Lex Nova would like to verify:                      │
│                                                      │
│  ☑  Your Person Identification Data (PID)            │
│      Sharing: nationality, over_18, resident_country │
│      (NOT sharing: name, ID number, date of birth)   │
│                                                      │
│              [ Decline ]    [ Approve ]              │
└──────────────────────────────────────────────────────┘
```

User clicks "Approve."

**On screen, right side — side panel:**

```
CLIENT ONBOARDING — PID WITH SELECTIVE DISCLOSURE
══════════════════════════════════════════════
[09:15:01] SIWE login
           ✓ Signature verified for 0x70997...79b0
           ← session established
[09:15:02] OID4VP request sent to wwWallet (PID only)
[09:15:03] ← SD-JWT VP received
           Holder DID:  did:key:zPQR...
           Issuer:      issuer.eudiw.dev (EU IACA-anchored x.509)
[09:15:03] Verifying PID:
             ✓ x.509 chain valid (EU IACA root)
             ✓ Issuer signature valid
             ✓ Holder signature valid
             ✓ Selective disclosure proofs valid
[09:15:03] Disclosed claims:
             nationality=ES, over_18=true, resident_country=ES
           Withheld:
             name, ID number, date of birth, photo, address
[09:15:04] Writing EAS attestation on local anvil...
[09:15:04] → Tx 0xghi7...89ab
[09:15:04] ✓ Attestation UID 0x7c3a...44fe in block 19
[09:15:04] Profile created: capabilities = [verified_client]
══════════════════════════════════════════════
```

**Page redirects** to `/dashboard`. Shows the client with one badge: *Verified Client* (ES, resident ES, over 18).

**Spoken (over the panel, ~25 seconds):**

> "Now the client. Same SIWE login. The platform doesn't know her either, so she presents her PID — same SD-JWT VC format every member-state wallet must support by the end of 2026. Selective disclosure: only nationality, over-18, country of residence. We don't see her name. We don't see her ID number. We don't see anything that would let us identify her later.
>
> One attestation lands. She's now a verified client. Both parties are on the platform. Watch what happens when they engage."

**Time check at 1:50.**

## Screen three — engagement with ZK conflict check (1:50 - 2:50)

**Action:** still on laptop two (the client's laptop). Click "Find a lawyer." Page lists Hans Schmidt. Click "Engage Hans."

**Page state:** loading the lawyer's prior-client commitment set + a fresh per-engagement salt from the backend.

**On screen, right side — side panel:**

```
ENGAGEMENT — CONFLICT CHECK CEREMONY
══════════════════════════════════════════════
[09:15:30] Salt generated: 0x6Ae3...F274 (32 bytes, fresh)
[09:15:30] Fetching Hans's 8 prior-client commitments under salt...
[09:15:30] ✓ Received 8 commitments
[09:15:30] Browser: deriving client_secret from disclosed PID claims
           pedersen_hash([
             hash(nationality=ES),
             hash(resident_country=ES),
             1,  // over_18 = true
             did:key:zPQR...
           ])
[09:15:30] Browser: computing commitment = pedersen_hash(client_secret, salt)
[09:15:30] Browser: generating Noir proof (circuit: conflict_check.acir)
           [████████████████████░] 2.34s
[09:15:33] ✓ Proof generated, 192 bytes
[09:15:33] Backend verifying proof against public inputs...
[09:15:33] ✓ Proof valid: client_commitment ∉ prior_commitments
[09:15:33] Conflict check passed; engagement creation allowed.
══════════════════════════════════════════════
```

**Page enables:** "Create Engagement (0.05 ETH)" button. Switch to **laptop one** (Hans). Hans's dashboard shows pending engagement.

**Hans clicks "Create Engagement"** → MetaMask popup → confirm (~4s).

**Side panel:**

```
[09:15:38] LegalEngagementEscrow.createEngagement(...)
           Contract verifies lawyer EAS attestation 0x9f8e...aab2 ✓
           Contract verifies client EAS attestation 0x7c3a...44fe ✓
           → Tx 0xjkl0...12cd
           ✓ Engagement #0 created in block 23
```

**Switch back to laptop two.** Client clicks "Fund Engagement" → MetaMask popup with 0.05 ETH value → confirm (~4s).

**Side panel:**

```
[09:15:43] LegalEngagementEscrow.fundEngagement(0) value: 0.05 ETH
           Status: Created → Funded
           → Tx 0xmno3...45ef in block 24
```

**Narrate:** "Hans does the work — off-chain, this is real legal work — and tells the platform he's done."

**Client clicks "Release Engagement"** → MetaMask popup → confirm (~4s).

**Side panel:**

```
[09:15:48] LegalEngagementEscrow.releaseEngagement(0)
           Computing splits:
             0.0425 ETH → lawyer (85%)
             0.0075 ETH → platform treasury (15%)
           Status: Funded → Released
           → Tx 0xpqr6...78gh in block 25
           ✓ Lawyer balance:   +0.0425 ETH
           ✓ Treasury balance: +0.0075 ETH
══════════════════════════════════════════════
```

**Spoken over the engagement segment (~50 seconds):**

> "Before any engagement, the client proves she has no prior conflict with this lawyer — without revealing her identity, and without seeing his client list. She generates a zero-knowledge proof in her browser in two seconds. The platform verifies it. Three-way blindness, mathematical truth. Eight commitments today for demo speed; production scales to a Merkle tree of thousands.
>
> Hans creates the engagement — the contract reads both attestations on chain, refuses if either is missing or revoked. The client funds it. Hans does the work. The client releases. Fifteen percent goes to the platform on release, not on signup. The platform earns when work happens.
>
> Production swaps anvil for mainnet, swaps the seed script for real bar associations as Trusted Issuers in EBSI, and adds qualified electronic signatures on the engagement agreement via a QTSP partner. The architecture you just saw doesn't change."

**Time check at 2:50.**

## Close (2:50 - 3:00)

**Switch to closing slide.**

**On screen — verification dual-stack:**

```
LEX NOVA ACCEPTS:

┌─ EBSI Verifiable Credentials ─────┐
│  When bar associations onboard as │
│  Trusted Issuers in EBSI TIR.     │
│  Code path: validated today.       │
└────────────────────────────────────┘

┌─ EUDI ARF Qualified Attestations ─┐
│  When QTSPs issue (Q)EAA          │
│  per eIDAS 2 — bar admission      │
│  named in scope.                   │
└────────────────────────────────────┘

┌─ zkTLS proofs (Reclaim Protocol) ─┐
│  Bridge until institutional        │
│  onboarding catches up. Verify     │
│  against existing bar member       │
│  portals today.                    │
└────────────────────────────────────┘

         All produce the same on-chain attestation.
```

**Spoken (~10 seconds):**

> "Three paths into the same on-chain attestation. EBSI today, EUDI ARF when QTSPs ship, zkTLS as the bridge. Today: a vetted Spanish lawyer admitted in Germany, found by a Spanish founder, paid through smart-contract escrow, neither knowing the other's name. Thank you."

**Total runtime:** 3:00.

## Q&A prep — one-line answers

**Q: "Is the issuer a real bar association?"**
A: No. Stand-in built by us, separate keypair. The bar's key was generated by our seed script, signed the credential, then discarded. Our platform's verifier doesn't have access to it. Same code path as a production verifier checking against EBSI's Trusted Issuers Registry.

**Q: "Where does the credential live? Could you be making it up?"**
A: In wwWallet — a real EUDI-spec PWA at demo.wwwallet.org. Different origin than our platform. *[opens 2nd tab, shows the credential listed in wwWallet's UI]*. Three distinct DIDs in the trace — holder, issuer, verifier — none can sign for any other.

**Q: "Why does the trace say accreditation chain not validated?"**
A: Because the issuer is did:key, not a registered TI in EBSI's TIR. With a TI issuer in production, the flag flips and the library walks back to the Root TAO. Same line of code.

**Q: "Why is the lawyer also a verified client?"**
A: A practicing lawyer is a citizen first. Their EUDI Wallet has a PID like everyone else's. Profile capabilities are additive — present a PID, you're a client; present a bar credential too, you're also a lawyer.

**Q: "Aren't you taking a fee on legal services? That's restricted in BRAO."**
A: Payment-rails provider on the same legal basis as Stripe. Volume-based fee, not legal-fee share. Lawyer sets price, receives gross.

**Q: "What if EUDI Wallet adoption is slow?"**
A: It is — uneven through 2026 and 2027. Our verifier accepts any conformant wallet's PID. Plus zkTLS as the bridge. We're built for the rollout curve, not the deadline.

**Q: "Why blockchain at all?"**
A: Mechanical funds-flow guarantee, plus cryptographic record of verification re-checkable later without trusting us.

**Q: "How does the conflict check actually work?"**
A: The lawyer publishes hashes of prior-client identifiers, mixed with a fresh per-engagement salt. The client computes her own hash with the same salt. Generates a ZK proof of non-membership. Platform verifies. Yes-or-no, no plaintext on either side, 2 seconds in browser.

**Q: "What about disputes?"**
A: Contract has a Disputed status. Hackathon scope skips dispute logic. Production: multi-sig of accredited arbitrators with their own EBSI VCs. Kleros as fallback.

**Q: "How does the lawyer learn what they're working on if the client is pseudonymous?"**
A: Lawyer learns the matter, not the identity. "GmbH formation in Bavaria, Spanish founder, target capital 25k euros." Pseudonymity is on PII, not on substance. If the matter escalates, client opts into tier three: full identity reveal under qualified trust escrow.

**Q: "What stops a lawyer from issuing fake VCs?"**
A: Library walks the accreditation chain. Self-issued VC fails with `validateAccreditation: true`. In production that flag is on.

**Q: "Why Noir over Circom?"**
A: Faster to write, ergonomics better for hackathon timeline, `noir_js` runs proofs in browser without WASM size headaches.

**Q: "How big is the SAM?"**
A: B2C legal services in EU is ~€60B in 2025. Cross-border, SME, digitally-deliverable matters: ~€25–40B. At €60–200M GMV in year 5: €10–35M ARR at 15% take. Comparables 6–12× ARR — €100–400M valuation range.

**Q: "Why won't Clio just build this?"**
A: Clio is workflow software for law firms. We're a marketplace for cross-border consumer matters. Different customer, different motion. Plus we consume EUDI and EBSI as the trust anchor — regulatory tailwind no incumbent has positioned for.

**Q: "What's the team?"**
A: [your honest answer]

## Failure modes and recovery

**`@sd-jwt/sd-jwt-vc` install fails on day-of** — switch to `@sd-jwt/core` directly (one layer lower, same primitives) or `@hopae/sd-jwt-vc` (alternative implementation, same protocol).

**`verifier.eudiw.dev` returns 5xx during demo** — switch to backup video for screens one and two. Don't try to debug live.

**wwWallet rejects did:key issuer** — should have been caught on day 1; fall back to did:web for the bar's DID. Pre-stage steps unchanged once swapped.

**Anvil crashes mid-demo** — `make demo-reset` reloads from `anvil-state.json`. ~10s. Continue from screen one. wwWallet credentials survive (they're at a different origin).

**MetaMask popup doesn't appear** — bring it up manually from the toolbar. If frozen, swap to a fresh laptop.

**ZK proof hangs** — "while that's generating, let me show you the architecture." Switch to architecture slide. When it finishes, switch back. Don't apologize.

**Forget a section** — slides are in order. Skip to next. Judges don't know your script.

**Laptop dies** — hand the second to a teammate while you continue narrating.

**Internet dies completely** — anvil + ZK proof + engagement flow are local, those still work. EUDI verifier dies. Switch to backup video for screens one and two only; live the engagement.

## What's no longer in the script vs round 1

- Removed: scrolling through `api-conformance.ebsi.eu` HTTP requests in the lawyer trace (not used)
- Removed: trust-chain walk visualization — TI → TAO → Root TAO (we're not in EBSI's TIR for the demo)
- Removed: ZK at client onboarding — moved to engagement creation
- Added: SIWE login as the entry point for both screens
- Added: "production: validates against EBSI TIR" annotation on the issuer DID line
- Added: dual-credential ceremony for the lawyer (PID + LegalProfAccreditation in one OID4VP)
- Added: dual-stack closing slide (EBSI / EUDI ARF / zkTLS)
- Added: three MetaMask popups visibly choreographed in screen three
- Tightened: 4:30 → 3:00 target with all three ceremonies live
