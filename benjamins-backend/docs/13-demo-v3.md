# Demo v3 — Stage Script

Companion to [12-spec-v3.md](12-spec-v3.md). v2 script at [10-demo-v2.md](10-demo-v2.md) and round-1 at [03-demo.md](03-demo.md) preserved for the diff. v3 is **protagonist-driven** — Marta (the Spanish founder) leads the entire flow; Anna (the German lawyer) is pre-onboarded off-stage and enters the demo as a service Marta encounters. The cryptographic primitives serve a recognizable product arc instead of standing on their own.

## Total runtime target: 4:10 minutes, allow 5:00

**Two live ceremonies on stage:**

1. **Marta's onboarding + engagement** — lands on the platform, hits Connect Wallet, SIWE recognizes her as new → onboards via PID OID4VP → dashboard → posts matter → browses verified lawyers → picks Anna → ZK conflict check → engagement created → milestone 0 funded → E2EE message exchange → Anna marks delivered → Marta releases.
2. **Tier 3 dispute beats** — two pre-staged engagements demonstrating the asymmetric dispute paths: the client's `disputeMilestone` (immediate, no cooldown) and the lawyer's `escalateMilestone` (cooldown-gated, demonstrated via anvil time-warp).

Anna's onboarding (SIWE → PID OID4VP → "Become a verified lawyer" → bar OID4VP) happens **off-stage during pre-show**, narrated as "Anna joined the platform last month." If anyone asks to see it, we can show her dashboard in 10 seconds; otherwise we don't burn stage time on a ceremony we already know works.

## Pre-show checklist

- [ ] Two laptops, both connected to venue WiFi and a phone hotspot. **Marta's laptop is the demo stage; Anna's laptop is just there for occasional cuts to her dashboard view.**
- [ ] Anvil running with pre-deployed contracts (no profiles yet) — `anvil --load-state state.json`
- [ ] Platform Next.js app running on `lex-nova.local:3000` on both laptops (one app, not multiple services — issuer + verifier + platform all collapsed per spec §1a/§1b)
- [ ] Single ngrok tunnel pointed at the Next.js app: `ngrok http --domain=<reserved> 3000`
- [ ] Both laptops' demo Chrome profiles opened to `https://demo.wwwallet.org` in a 2nd tab, logged in (Google passkey works; Bitwarden does not — wwWallet uses WebAuthn PRF)
- [ ] **Anna's wwWallet** pre-staged via `/operator/issue`:
  - LegalProfessionalAccreditation (vct `urn:lex-nova:LegalProfessionalAccreditation`) — persona "Anna Schmidt — RAK München (DE)"
  - PID (vct `urn:eudi:pid:1`) — same persona
  - *(verify by opening wwWallet's Credentials tab; both should be listed with their card art rendered)*
- [ ] **Anna pre-onboarded to the platform** (off-stage): Connect Wallet → SIWE → `/onboard` → PID OID4VP → `/dashboard` shows `[verified_client]`. Then click "Become a verified lawyer →" on the dashboard → bar credential OID4VP → profile gains `[verified_lawyer]` (now both capabilities under one Ethereum address). Posted-rate-card filled in (e.g. "Initial review: 0.01 ETH").
- [ ] **Two pre-staged engagements for the Tier 3 beat** at milestone 0 in `Delivered` state, both with **Anna (#1) as the lawyer**:
  - Engagement #1 — Lukas (#2, exercising his `verified_client` capability) as client. Lukas will dispute on stage.
  - Engagement #2 — Marco (#4) as client. Anna will escalate on stage after the time-warp.
- [ ] **Arbiter is Eva Novák (#5).** She's a verified lawyer (CZ jurisdiction, no conflict with the DE engagements). After her standard `/onboard` + "Become a verified lawyer" flow, the platform operator writes one additional EAS attestation under her address: `verified_arbiter`. Eva's profile then carries `[verified_client, verified_lawyer, verified_arbiter]` — demonstrates the additive-capability model on stage.
- [ ] **`ARBITER` constructor param** of the deployed escrow contract points to Eva's Ethereum address.
- [ ] **Eva's MetaMask logged into a third browser tab** for the `resolveDispute` beat. Tab is on `/arbiter/dashboard`, which is gated to addresses holding the `verified_arbiter` capability.
- [ ] **Marta's wwWallet** pre-staged via `/operator/issue`:
  - PID (vct `urn:eudi:pid:1`) — persona "John Doe (US/GR)"
  - *(Note: spec persona is "John Doe" but on stage we narrate as Marta; the PID claims work for either narrative since US-resident dual-national matches the cross-border-matching wedge.)*
- [ ] **Marta has NO platform profile yet.** She'll Connect Wallet on stage and onboard live.
- [ ] MetaMask configured per laptop:
  - Custom network "Anvil" — RPC `http://localhost:8545`, chain ID 31337
  - Anvil prefunded private key imported (different addresses for Marta and Anna)
- [ ] Issuer metadata reachable through ngrok in last 10 minutes (curl `https://<ngrok>/api/issuer/.well-known/openid-credential-issuer`)
- [ ] Backup video of the full demo recorded and ready
- [ ] EBSI VC validator (`https://hub.ebsi.eu/tools/vc-validator`) hidden tab as a credibility prop
- [ ] ZK proving key pre-warmed — visit `/find-lawyer` once on Marta's laptop so the WASM is loaded
- [ ] Slide deck: hook, three-tier framing slide, architecture slide, "verified pseudonymous engagement" closing slide, Tier 3 escalation slide
- [ ] Phone hotspot tested as backup for venue WiFi

## Stage state at curtain

- Anvil running, EAS contracts deployed (lawyer + client + engagement schemas), escrow deployed, **no engagements yet**
- Anna's profile already on chain: `[verified_lawyer, verified_client]` capabilities, two EAS attestations, posted rate card
- Anna's wwWallet: bar credential + PID (5 instances each from batch issuance)
- Marta's wwWallet: PID only (5 instances)
- Marta's platform-side state: empty (she hasn't visited yet)
- Both MetaMasks: connected to Anvil with prefunded balance

The credentials in the wallets are *external infrastructure* — pretend the bar association issued Anna's accreditation when she passed her *Zweite juristische Staatsprüfung* in 2018, and Marta's national PID provider issued her ID card under the eIDAS regulation. We collapsed both issuers into one stand-in process for the demo (footnote on the architecture slide); the cryptographic story holds.

## The hook (0:00 - 0:25)

**On screen:** title slide

**Spoken:**

> "Marta is a Spanish founder. She wants to set up a German GmbH. She needs a German lawyer — someone admitted to a German bar, ideally in Bavaria where she's based. Today she has two options: upload her passport to a directory site she's never heard of, or pay 600 euros to a Munich firm just to get matched.
>
> We built a third option. She'll find a verified lawyer without uploading anything. She'll pay only when work gets done. Her name and address never leave her wallet. Three minutes."

**Why this works:** specific protagonist, specific pain, the three-tier promise hidden in the "three options" framing. "Three minutes" sets the contract with the audience.

## Three-tier slide (0:25 - 0:35)

**On screen:** brief slide, ~10 seconds:

```
LEX NOVA — THREE TIERS

  Tier 1 — anonymous public legal information ........ (future)
  Tier 2 — pseudonymous-but-credentialed advice ...... LIVE TODAY
  Tier 3 — fully-identified engagement on escalation . demonstrable
```

**Spoken (~5 seconds):**

> "What you're about to watch is Tier 2. Tier 1 is the public Q&A surface above it; Tier 3 is the escalation path below it for when matters get serious. We'll touch all three by the end."

## Screen one — Marta lands, connects, onboards (0:35 - 1:25)

**Action:** Marta's laptop. Open `lex-nova.local:3000/`. No auth yet.

**On screen, the landing page:**

```
┌─────────────────────────────────────────────────────────────┐
│  Lex Nova                                                   │
│                                                             │
│  Verified EU lawyers. Pseudonymous clients. Escrow that     │
│  pays only when the work is done.                           │
│                                                             │
│                                                             │
│                  [ Connect Wallet → ]                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Spoken (~10 seconds):**

> "Marta lands on Lex Nova. One button. No marketing fluff, no ID upload, no signup form. Just connect your wallet."

She clicks **Connect Wallet**. **MetaMask popup**: SIWE message — "lex-nova.local wants you to sign in with your Ethereum account 0x70997…79b0" — click Sign (~3s, no gas).

**Backend:** signature verified, address looked up — *not registered*. Set session cookie, redirect to `/onboard`.

**On screen:**

```
┌─────────────────────────────────────────────────────────────┐
│  We don't recognize you yet.                                │
│                                                             │
│  Before posting a matter or engaging a lawyer, please       │
│  verify you're a real EU resident using your EUDI Wallet.   │
│                                                             │
│  We'll only see what you choose to disclose.                │
│                                                             │
│                  [ Verify with EUDI Wallet → ]              │
└─────────────────────────────────────────────────────────────┘
```

She clicks the button. Page constructs an OID4VP DCQL request, opens wwWallet in a 2nd tab.

**wwWallet popup:**

```
┌──────────────────────────────────────────────────────────┐
│  Lex Nova would like to verify your PID:                 │
│  Purpose: confirm you are a real EU-resident person      │
│  before activating your client profile.                  │
│                                                          │
│  Sharing from urn:eudi:pid:1                             │
│    given_name:                  John                     │
│    family_name:                 Doe                      │
│    nationalities:               ["US", "GR"]             │
│    age_equal_or_over.18:        true                     │
│    address.country:             US                       │
│  Withholding: birthdate, full address, phone, email,     │
│               document number, place of birth, sex,      │
│               age_in_years, issuing_authority, etc.      │
│                                                          │
│              [ Decline ]      [ Approve ]                │
└──────────────────────────────────────────────────────────┘
```

She clicks **Approve**.

**On screen, side panel:**

```
MARTA — ONBOARDING (CLIENT)
══════════════════════════════════════════════
[10:00:18] SIWE login — signature verified for 0x70997…79b0
           Address not in profiles → /onboard
[10:00:23] OID4VP /presentation/request (kind=pid)
           DCQL: vct=urn:eudi:pid:1
           client_id: x509_san_dns:<ngrok-host>
[10:00:27] ← direct_post received with vp_token
           {"client-pid": "<sd-jwt-vc>~<dis>~…~<kbjwt>"}
[10:00:27] @sd-jwt/sd-jwt-vc verifying:
             ✓ Signature (ES256) valid against did:key:z2dmzD…
             ✓ cnf.jwk binds credential to holder (thumbprint GwPhR…)
             ✓ Selective disclosure proofs valid
[10:00:27] Disclosed: given_name, family_name, nationalities=["US","GR"],
                      age_equal_or_over.18=true, address.country=US
           Withheld:  birthdate, full address, phone, email,
                      document number, place of birth, sex, …
[10:00:28] EAS client attestation written
             → Tx 0xghi7…89ab in block 19
             UID 0x7c3a…44fe
             Profile: 0x70997…79b0 → capabilities=[verified_client]
══════════════════════════════════════════════
```

**Spoken (over the panel, ~25 seconds):**

> "Marta proved she's a real person from the EU using her PID — selective disclosure means the platform got name, nationality, country, age-over-18, and *nothing else*. We didn't see her birth date. We didn't see her document number. We can't compute her age beyond what the credential said. Cryptographically prevented from seeing them.
>
> One attestation lands on chain, keyed by her Ethereum address. She's now a verified client. The whole verify-yourself ceremony — that's a one-time thing. Returning users skip it; SIWE recognizes them next visit."

**Page redirects** to `/dashboard`.

## Screen two — matter, browse, engage (1:25 - 2:15)

**On screen, `/dashboard`:**

```
┌─────────────────────────────────────────────────────────────┐
│  Welcome.                              [ verified_client ] │
│                                                             │
│  ┌─ What do you need help with? ──────────────────────┐    │
│  │ [Marta types live:]                                │    │
│  │ I'm a Spanish founder setting up a GmbH in         │    │
│  │ Bavaria. Starting capital 25k EUR. I'm not yet     │    │
│  │ German-resident. Need help with formation          │    │
│  │ paperwork.                                          │    │
│  └─────────────────────────────────────────────────────┘    │
│  Jurisdiction: [ Germany ▾ ]    [ Find a lawyer → ]        │
│                                                             │
│  Active engagements: (none yet)                            │
│                                                             │
│  ─────────────────────────────────────────────              │
│  Are you a lawyer?    [ Become a verified lawyer → ]       │
└─────────────────────────────────────────────────────────────┘
```

**Spoken (~10 seconds):**

> "She lands on her dashboard. She types her matter. The 'Become a verified lawyer' button at the bottom — that's the additive-capability model. Anna clicked exactly that button when she joined; now her single Ethereum address holds both client and lawyer capabilities."

Marta clicks **Find a lawyer →**. Routes to `/find-lawyer?matterId=…`.

**On screen:**

```
┌─────────────────────────────────────────────────────────────┐
│  Showing 2 verified lawyers in Germany                      │
│                                                             │
│  ┌───────────────────────────────────────────────┐          │
│  │  ⚖ Anna Schmidt                               │          │
│  │     RAK München · admitted 2018-09-15         │          │
│  │     Jurisdiction: DE                          │          │
│  │     ✓ Bar credential verified on chain        │          │
│  │     Initial consultation: 0.01 ETH (~€32)     │          │
│  │     [ Engage Anna for this matter → ]         │          │
│  └───────────────────────────────────────────────┘          │
│                                                             │
│  ┌───────────────────────────────────────────────┐          │
│  │  ⚖ Lukas Weber                                │          │
│  │     RAK Berlin · admitted 2012-03-22          │          │
│  │     Jurisdiction: DE                          │          │
│  │     ✓ Bar credential verified on chain        │          │
│  │     Initial consultation: 0.015 ETH           │          │
│  └───────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

**Spoken (~15 seconds):**

> "Two verified German lawyers. Each card shows only what the bar association attested to: name, RAK, admission date, jurisdiction. No '10 years of experience' claim, no 'satisfied clients' testimonials, no LinkedIn-style fluff. We don't show what we can't verify. The visual contrast with normal directory sites is the point."

Marta clicks **Engage Anna →**. Routes to `/engagement/new?matterId=…&lawyer=anna_address`.

**On screen:**

```
┌─────────────────────────────────────────────────────────────┐
│  You're about to engage Anna Schmidt for an initial review  │
│  of your matter:                                             │
│                                                              │
│   "I'm a Spanish founder setting up a GmbH in Bavaria.       │
│    Starting capital 25k EUR. I'm not yet German-resident.    │
│    Need help with formation paperwork."                      │
│                                                              │
│  Initial consultation fee:    0.01 ETH (~€32)                │
│                                                              │
│  Anna will review your matter and either resolve it in this  │
│  consultation or quote follow-up work as a separate          │
│  milestone you can accept or decline.                        │
│                                                              │
│                              [ Confirm and engage → ]        │
└─────────────────────────────────────────────────────────────┘
```

She clicks **Confirm and engage**. ZK conflict check fires; engagement gets created on chain. Marta is already authenticated — no wallet popup for the auth dance, just the contract call.

**Side panel:**

```
[10:00:55] ZK conflict check (Noir):
             Salt: 0x6Ae3…F274 (32 bytes, fresh)
             Anna's prior-client commitments: 8 fetched
             client_secret = pedersen_hash([
               hash(nationalities[0]="US"),
               hash(address.country="US"),
               1,  // age_equal_or_over.18
               holder_jwk_thumbprint
             ])
             [████████████████████░] 2.34s
             ✓ Proof valid: client_commitment ∉ prior_commitments
[10:00:58] LegalEngagementEscrow.createEngagement(...)
             lawyer=Anna, client=Marta, matterDigest=0x4f2a…a91e,
             milestone[0]={amount: 0.01 ETH, status: Proposed}
             → Tx 0xjkl0…12cd in block 20
             ✓ Engagement #0 created
══════════════════════════════════════════════
```

**Page transitions** to `/engagement/0` — milestone 0 in `Proposed` state. Marta clicks **Accept & fund 0.01 ETH** → MetaMask popup with 0.01 ETH value → confirm (~4s).

**Side panel:**

```
[10:01:02] LegalEngagementEscrow.acceptAndFundMilestone(0, 0)
           Milestone 0: Proposed → Funded
           Funds locked: 0.01 ETH
           → Tx 0xmno3…45ef in block 21
```

**Spoken (over the panel, ~15 seconds):**

> "ZK conflict check confirmed Marta isn't already one of Anna's clients. Three-way blindness — Marta doesn't know Anna's prior client list, Anna doesn't know who Marta is, the platform doesn't know either. Engagement created. Marta funded the initial consultation. 0.01 ETH locked in escrow until she releases it."

**Time check at 2:00.**

## Screen four — E2EE messaging + milestone release (2:00 - 2:45)

**Action:** stay on Marta's laptop, on `/engagement/0`. Cut briefly to Anna's laptop showing her dashboard with the new engagement appearing in her Inbox.

**Spoken (~10 seconds, while cutting to Anna's view):**

> "Anna sees the engagement in her dashboard. She opens it; she sees Marta's matter for the first time. Notice she sees the matter text, not Marta's name. Not Marta's address. Not Marta's birth date. The platform never shared those — Marta never disclosed them."

**Cut back to Marta's laptop.** Marta types into the chat panel:

```
┌─ Engagement #0 — chat ─────────────────────────────────────┐
│  [you]  Quick question — does the 25k starting capital     │
│         need to sit in a German account before             │
│         incorporation, or can it transfer at close?        │
│         [Send →]                                            │
└─────────────────────────────────────────────────────────────┘
```

**Side panel as she clicks Send:**

```
[10:01:22] Browser: deriving session key for engagement #0
             ECDH(Marta's PID-side cnf.jwk × Anna's PID-side cnf.jwk)
             → 256-bit AES-GCM session key
             (computed client-side; never sent to server)
[10:01:22] Browser: encrypting message
             plaintext: 156 bytes
             ciphertext: 184 bytes (AES-GCM with 12-byte nonce + 16-byte tag)
             signature: ECDSA-P256 over ciphertext using PID-side holder key
[10:01:22] → POST /api/engagements/0/messages
             body: { ciphertext: 0x8f4e…, sig: 0x9a7c…, sender: thumbprint }
[10:01:22] Server: stored ciphertext in messages table
             Server CANNOT decrypt — no key material on server
[10:01:22] Browser: appending to local Merkle transcript
             messageHash = sha256(ciphertext || sig || timestamp)
             new transcriptRoot: 0xa42b…
```

**Cut to Anna's laptop.** Anna opens the engagement, decrypts client-side, sees Marta's question. She types her reply:

```
┌─ Engagement #0 — chat ─────────────────────────────────────┐
│  [client]  Quick question — does the 25k need to sit in    │
│            a German account before incorporation…          │
│                                                             │
│  [you]     For a GmbH, the 25k Stammkapital must be paid   │
│            in (Einzahlung) at incorporation. At least      │
│            12.5k cleared in a German bank account, with    │
│            written confirmation, BEFORE the notary         │
│            registers the company. The remainder can be     │
│            committed but not yet wired. Happy to send a    │
│            checklist with the SCHUFA-compatible banks      │
│            that open business accounts for non-residents.  │
│            [Send →]                                         │
└─────────────────────────────────────────────────────────────┘
```

**Side panel (Anna's send):**

```
[10:01:48] (mirror of Marta's send pattern from her side)
           ciphertext stored, message signed by Anna's PID holder key
           transcriptRoot: 0xa42b… → 0xc78d… (now 2 messages in tree)
```

**Spoken (~20 seconds):**

> "Real chat, encrypted in transit, encrypted at rest, signed by both parties' wallet keys. The platform stores blobs it cannot decrypt — and crucially, this isn't 'we promise we don't read them.' The decryption key is derived from a Diffie-Hellman between Marta's wallet key and Anna's wallet key. Neither key ever leaves their respective browsers. We literally cannot read this conversation. That's what attorney-client privilege actually requires."

**Anna's done.** She clicks **Mark delivered** in her milestone panel → MetaMask → confirm (~4s).

**Side panel:**

```
[10:02:00] LegalEngagementEscrow.markDelivered(0, 0)
             Milestone 0: Funded → Delivered
             deliveredAt = block.timestamp (10:02:00)
             Lawyer cooldown clock starts (LAWYER_DISPUTE_COOLDOWN=30s in demo,
                                            30 days in production)
             → Tx 0xstu9…12wx in block 22
```

**Spoken (~10 seconds):**

> "Anna marks the work delivered. That starts a clock — we'll come back to it. Right now though, the ball's in Marta's court: release the funds or dispute."

**Marta clicks Release milestone 0.** MetaMask popup → confirm (~4s).

**Side panel:**

```
[10:02:10] Browser: computing final transcriptRoot for milestone 0
             0xc78d… (2 messages logged)
[10:02:11] LegalEngagementEscrow.releaseMilestone(engagementId=0,
                                                  milestoneIndex=0,
                                                  transcriptRoot=0xc78d…)
             Computing splits for 0.01 ETH:
               0.0085 ETH → lawyer (85%)
               0.0015 ETH → platform treasury (15%)
             Milestone 0: Delivered → Released
             Engagement.transcriptRoot updated: 0xc78d…
             EAS engagement attestation written:
               schema: engagementSchemaUid
               data:   { engagementId, lawyer, client, matterDigest,
                         transcriptRoot, createdAt }
             → Tx 0xpqr6…78gh in block 23
             ✓ Anna balance:    +0.0085 ETH
             ✓ Treasury balance: +0.0015 ETH
══════════════════════════════════════════════
```

**Spoken (~15 seconds):**

> "Anna gets paid 0.0085 ETH; the platform takes 0.0015 — fifteen percent. We earn when work happens, not when people sign up. The transcript root for milestone 0 is locked on chain in the engagement attestation — neither party can rewrite the conversation after the fact. If they ever needed to prove what was said, they could reveal the messages and their Merkle paths; the chain confirms they were part of this engagement."

**Time check at 2:45.**

## Screen five — Tier 3 dispute paths (2:45 - 3:30)

The dispute mechanism is asymmetric, and the contract enforces it. Two beats — first show the client path, then show the lawyer path being gated by the cooldown.

**Setup:** for this beat we navigate to two **pre-staged engagements** that are already funded and delivered. Both have **Anna (#1) as the lawyer**, but different clients exercising their `verified_client` capability:

- **Engagement #1** — Lukas Weber (#2, normally a lawyer; here exercising his client capability). Lukas will dispute on stage.
- **Engagement #2** — Marco Rossi (#4). Anna will escalate on stage after the time-warp.

Anna's milestone 0 in each is in `Delivered` state, ready to be flagged.

### Beat 1: Client dispute (immediate, no cooldown)

**Action:** on Lukas's tab, navigate to `/engagement/1`. Milestone 0 is in `Delivered` state.

**Spoken (~5 seconds):**

> "Side beat: lawyers are also citizens. Lukas is one of our verified lawyers, but in this engagement he's exercising his `verified_client` capability — hiring Anna for a separate matter. The 'lawyer hires another lawyer' story from the architecture slide, made real."

**Spoken (~10 seconds, while clicking Dispute):**

> "Suppose the client thinks Anna's deliverable wasn't what was scoped. They click Dispute. No waiting period — the client can dispute any time after funding."

Click **Dispute milestone** → MetaMask → confirm.

**Side panel:**

```
[10:02:55] LegalEngagementEscrow.disputeMilestone(1, 0)
             onlyClient ✓
             Milestone status: Delivered → Disputed
             Funds locked: 0.01 ETH parked pending arbitration
             → Tx 0xtuv1…34yz in block 24
```

### Beat 2: Lawyer escalation (cooldown-gated)

**Action:** switch to Anna's tab, navigate to engagement #2 (Anna ↔ Marco). Milestone 0 in `Delivered`. The Escalate button is visible to Anna but **shows a live countdown** — "Available in 25s."

**Spoken (~15 seconds, while showing the disabled button):**

> "Now the lawyer's side. Suppose Anna delivered work and the client just stopped responding. Can Anna escalate? Watch what the contract says. The Escalate button is right there — but it's disabled with a countdown. The contract enforces a 30-day cooldown post-delivery before a lawyer can escalate. Why? Because lawyer escalation can break the client's pseudonymity in arbitration. Without the cooldown, 'pay me or I escalate' becomes a coercion vector. The contract makes that impossible by construction."

**Anna clicks the Escalate button anyway** (impatient lawyer, audience laughs). MetaMask submits → contract reverts.

**Side panel:**

```
[10:03:12] LegalEngagementEscrow.escalateMilestone(2, 0)
             onlyLawyer ✓
             ✗ REVERT: LawyerCooldownNotElapsed
                 deliveredAt =     1735830180  (10:03:00)
                 requiredAt =      1735830210  (10:03:30)
                 block.timestamp = 1735830192  (10:03:12)
                 18 seconds remaining
             → Tx 0xwxy4…56ab REVERTED
```

**Spoken (~5 seconds):**

> "Reverted. The cooldown clock has 18 seconds to go. Now in production this would be 30 days — but for the demo we set it to 30 seconds. Let me fast-forward."

**Operator runs in a terminal:**

```bash
$ cast rpc evm_increaseTime 30 && cast rpc evm_mine
"0x0"
```

**Spoken (~5 seconds):**

> "Anvil supports time-warping. We just told the local chain that 30 seconds passed."

**Anna clicks Escalate again.** MetaMask submits → success.

**Side panel:**

```
[10:03:25] LegalEngagementEscrow.escalateMilestone(2, 0)
             onlyLawyer ✓
             block.timestamp >= deliveredAt + LAWYER_DISPUTE_COOLDOWN ✓
             Milestone status: Delivered → Disputed
             Funds locked: pending arbiter resolution
             → Tx 0xwxy4…78cd in block 25
```

### Beat 3: Evidence submission + arbiter resolution

**Spoken (~10 seconds):**

> "Both engagements are now in `Disputed`. The arbiter is just an authorized address — they can split the funds, but they have no decryption keys. Watch what 'evidence' looks like in this system."

**Switch to engagement #2** (the lawyer-escalated one). Anna clicks **Submit evidence to arbiter** on her engagement page. Modal opens showing all messages from this engagement, decrypted. She picks the messages she wants the arbiter to see and clicks Send.

**Side panel:**

```
[10:03:42] Anna selecting evidence from engagement #2
             4 messages decrypted client-side
             3 selected for submission
[10:03:42] Bundling evidence:
             [{plaintext, sig, merklePath} × 3]
             + on-chain transcriptRoot for engagement #2
[10:03:42] → POST /api/engagements/2/evidence
             body forwarded to arbiter inbox (via SQLite)
             server cannot read plaintext — it's just routing the bundle
[10:03:42] ✓ Evidence delivered to arbiter
```

**Switch to Eva's tab** (`/arbiter/dashboard`, logged in as Eva's address #5 — she's CZ-jurisdiction so no conflict with this DE engagement).

**Spoken (~5 seconds, while showing Eva's profile):**

> "Eva is one of our verified lawyers. The platform additionally granted her the `verified_arbiter` capability after manual review — three EAS attestations under one Ethereum address. The arbiter pool is drawn from credentialed lawyers, vetted by the platform; the platform itself doesn't arbitrate."

**On screen:**

```
┌─ Arbiter Dashboard ──────────────────────────────────────┐
│  Disputed engagements:                                   │
│                                                           │
│  Engagement #1 (client-disputed) — 0 evidence submitted │
│  Engagement #2 (lawyer-escalated) — 1 bundle from lawyer│
│                                                           │
│  Open #2 →                                                │
└──────────────────────────────────────────────────────────┘
```

Operator clicks Engagement #2.

**On screen:**

```
┌─ Engagement #2 — Disputed milestone 0 (0.05 ETH locked) ─┐
│                                                            │
│  Lawyer's submission (3 messages):                        │
│    [10:00:03] lawyer: "Initial review ready, attached…"   │
│    [10:00:42] client: "looks good, will get back to you"  │
│    [10:01:18] lawyer: "any update?"                       │
│  ✓ All 3 messages verified against on-chain              │
│    transcriptRoot 0xc78d…                                  │
│  ✓ All sender signatures valid                            │
│                                                            │
│  Client's submission: (none — client has not engaged)     │
│                                                            │
│  Resolution:                                              │
│    Amount to lawyer:  [ 0.05  ] ETH                       │
│    Amount to client:  [ 0     ] ETH                       │
│                       [ Resolve in lawyer's favor → ]     │
└────────────────────────────────────────────────────────────┘
```

**Spoken (~15 seconds):**

> "The arbiter sees what the lawyer chose to show — verified against the on-chain transcript root, signatures all check out. The client didn't submit anything. In civil arbitration, that silence weighs against you. The arbiter rules in favor of the cooperative party."

Operator clicks **Resolve in lawyer's favor →**. MetaMask popup → confirm.

**Side panel:**

```
[10:04:05] LegalEngagementEscrow.resolveDispute(2, 0,
                                                 amountToLawyer=0.0425 ETH,
                                                 amountToClient=0)
             onlyArbiter ✓
             milestone status: Disputed → Resolved
             splits: 0.0425 → lawyer, 0 → client, 0.0075 → treasury (15%)
             → Tx 0x123a…5678 in block 26
             ✓ Anna balance:    +0.0425 ETH
             ✓ Treasury balance: +0.0075 ETH
══════════════════════════════════════════════
```

### Tier 3 closing slide

**Switch to slide:**

```
TIER 3 — ARBITRATED RESOLUTION

  Asymmetric trigger rights:
    • Client: dispute any Funded/Delivered milestone
              immediately. No cooldown.
    • Lawyer: escalate after 30-day post-delivery cooldown.
              Anti-harassment guardrail; contract-enforced.

  Arbiter has ESCROW AUTHORITY ONLY:
    • Calls resolveDispute(eng, ms, toLawyer, toClient)
    • Cannot decrypt messages — privilege boundary absolute
    • Cannot unseal client identity (no such mechanism in v3)

  Evidence flow:
    • Either party submits decrypted messages + Merkle paths
    • Arbiter verifies on-chain transcriptRoot
    • Non-cooperation = default loss by arbiter discretion
    • Same model as civil arbitration

  Production trajectory (NOT in demo):
    • Arbiter multi-sig of accredited arbitrators (EBSI VCs)
    • Tier 3.5 identity-escrow for fraud/regulator escalation
      (threshold-encrypted PID, court-order-gated decryption)
```

**Spoken (~15 seconds):**

> "Asymmetric trigger rights, contract-enforced. Arbiter with escrow authority only — they split the funds based on what the parties choose to show them, never with the power to decrypt anything themselves. Privilege stays absolute. For fraud or regulator escalation in production, there's a separate Tier 3.5 mechanism — threshold cryptography, court-order-gated. We didn't build that. We built the dispute mechanism that 95% of cases need."

**Time check at 3:50.**

## Close (3:50 - 4:10)

**Switch to closing slide.**

**On screen — verified pseudonymous engagement:**

```
VERIFIED PSEUDONYMOUS ENGAGEMENT
A product category that didn't exist 18 months ago.

  ⚖ Bar association vouched for the lawyer (EUDI/EBSI)
  ★ EU government vouched for the client (EUDI PID)
  🔒 ZK proof confirmed no conflict-of-interest
  💬 E2EE messaging — privilege cryptographic, not promised
  💸 Milestone escrow paid only on delivered work
  ⚖ Arbitration path with seal/unseal for escalations

  None new technologies.
  New is using them together.

  Marta hired a German lawyer from Madrid in 3 minutes.
  No ID upload. No directory site. No upfront retainer.
  Identity sealed but unsealable. Privilege
  cryptographically guaranteed. Money in escrow.

           That's the product.
```

**Spoken (~15 seconds):**

> "What you watched — verified pseudonymous engagement — is a product category that didn't exist 18 months ago. The EU built the credential infrastructure. We built the marketplace on top of it. Tier 1 anonymous information sits above; Tier 3 escalation sits below. We focused on Tier 2 because that's where the cryptographic story lives, and the rest is the next six months of work — XMTP for the messaging substrate, ERC-5564 stealth addresses for per-engagement on-chain unlinkability, QES via a QTSP partner for legally-binding agreements. Thank you."

**Total runtime:** ~4:10.

## Q&A prep — one-line answers

**Q: "Is the issuer a real bar association?"**
A: No. Stand-in built by us, separate keypair. The bar's did:key was generated by our issuer service, signed the credential, lives in our service for the duration of the demo. Our platform's verifier doesn't have access to it. Same code path as a production verifier checking against EBSI's Trusted Issuers Registry — different DID, same protocol.

**Q: "Why didn't you use the official EU PID issuer at eudiw.dev?"**
A: We did try. eudiw.dev's auth server returns `iss=https://issuer.eudiw.dev/oidc` but advertises the credential_issuer as `https://issuer.eudiw.dev` — wwWallet enforces RFC 9207's strict `iss` matching and rejects the response. Documented incompatibility, not our code. We issue our own stand-in PID in the official `urn:eudi:pid:1` shape; protocol-indistinguishable from the real thing. In production each member-state's eIDAS-notified provider issues, validated via EBSI's TIR.

**Q: "Where does the credential live? Could you be making it up?"**
A: In wwWallet — a real EUDI-spec PWA at demo.wwwallet.org. Different origin than our platform. *[opens 2nd tab, shows the credentials listed in wwWallet's UI with their card art]*. Multiple distinct keys in the trace — holder (one per credential), issuer, verifier — none can sign for any other.

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
A: Asymmetric by design. The client can call `disputeMilestone` immediately on any `Funded` or `Delivered` milestone — no cooldown. The lawyer can call `escalateMilestone` only after a 30-day cooldown post-delivery (30s in the demo deploy) — contract-enforced. Both paths transition the milestone to `Disputed`; funds park. The arbiter — a single hardcoded address in the demo, multi-sig of accredited arbitrators in production — has **escrow authority only**: they call `resolveDispute(...)` to split the parked funds based on whatever evidence the parties have submitted to them. They cannot decrypt messages or unseal identity. Either party submits their decrypted messages + Merkle paths off-chain; the arbiter verifies them against the on-chain transcript root and decides. Non-cooperation = default loss by arbiter discretion, same as civil arbitration.

**Q: "Why is the lawyer's dispute path gated by 30 days but the client's isn't?"**
A: Because dispute itself is costly even when the arbiter can't see anything. Being on the receiving end of a complaint means evidence preparation, attention overhead, reputational tax. Without the lawyer-side cooldown, "pay me or I drag you into arbitration tomorrow" still works as a coercion lever even though the arbiter has no decryption authority. The 30-day post-delivery wait makes that lever cost the lawyer 30 days of patience — separates "I have a real grievance worth waiting on" from "I'm using arbitration as a payment-extraction tool." The client's dispute path has no analogous concern — the client disputing locks their own funded amount, which is a self-imposed cost.

**Q: "Can the arbiter unseal the client's real identity?"**
A: No. Not in v3, on purpose. The arbiter has on-chain authority to split parked funds via `resolveDispute(...)` and nothing else — no decryption keys, no path to unsealing. The cryptographic privilege boundary stays absolute even during arbitration: the only people who can decrypt the messages are the two parties themselves. For fraud/regulator/AML escalation in production, a separate Tier 3.5 mechanism would handle identity unsealing — threshold-encrypted PID blob held distributively by the arbitration board, court-order-gated decryption. That's a separate engineering effort intentionally out of v3.

**Q: "Can the platform read the lawyer-client messages?"**
A: No, cryptographically. Each engagement's messages are encrypted with a session key derived from a Diffie-Hellman between the two parties' wallet holder keys. Both keys live in the wallets, never on our servers. We store ciphertext + sender signatures; we don't have decryption material and we never will. If we got subpoenaed for content tomorrow, we'd hand over an unreadable blob. That's what privilege requires — not a contractual promise.

**Q: "What stops either party from forging messages later?"**
A: Every message is signed by the sender's wallet key, and every message hash is folded into a per-engagement Merkle transcript whose root gets committed on chain at every milestone fund/release event. After milestone N is released, the transcript root for everything before that is locked. Either party can reveal a specific message + its Merkle path to prove it was sent; neither can plant a new message into the past.

**Q: "Why milestones instead of one upfront price?"**
A: Real legal work doesn't price as one number. Milestone 0 is the consultation at the lawyer's posted rate; the lawyer reviews, scopes follow-on work, proposes milestone 1 with a concrete amount; client accepts/funds, lawyer delivers, client releases. Disputes are per-milestone — only the disputed milestone parks; prior released work stays released. Matches how engagements actually bill.

**Q: "How does the lawyer learn what they're working on if the client is pseudonymous?"**
A: Lawyer learns the matter, not the identity. "GmbH formation in Bavaria, Spanish founder, target capital 25k euros." Pseudonymity is on PII, not on substance. If the matter escalates, the dispute path opens the identity-escrow seal — Tier 3.

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

**ngrok tunnel down during demo** — the issuer + verifier need a public URL. Pre-pay for a ngrok reserved domain so the URL is stable. Cloudflared as secondary backup.

**wwWallet IndexedDB has stale cached metadata** — DevTools → Application → IndexedDB → delete `proxyCache` entry for our issuer URL, reload. Document this in the rehearsal sticky note.

**wwWallet rejects credential offer** — almost certainly a stale offer ID from a previous launcher run. Regenerate from the issuer UI.

**Anvil crashes mid-demo** — `make demo-reset` reloads from `anvil-state.json`. ~10s. Marta restarts from `/`. wwWallet credentials survive (they're at a different origin).

**MetaMask popup doesn't appear** — bring it up manually from the toolbar. If frozen, swap to a fresh laptop.

**ZK proof hangs** — "while that's generating, let me show you the architecture." Switch to architecture slide. When it finishes, switch back. Don't apologize.

**Messaging stub fails to derive session key** — usually means one of the wallets isn't unlocked. Reload `/engagement/[id]` after both wallets are connected; the session key derivation runs lazily on first message send. If still broken, narrate: "production messaging is XMTP, which sidesteps this entirely; here we used a localStorage stub for hackathon speed."

**Forget a section** — slides are in order. Skip to next. Judges don't know your script.

**Laptop dies** — hand the second to a teammate while you continue narrating.

**Internet dies completely** — anvil + ZK proof + milestone contract calls are local, those still work. ngrok dies (no wallet ↔ issuer/verifier). Switch to backup video for the onboarding + engagement-creation portions; live the messaging + milestone release on the local chain.

## What's no longer in the script vs v2

- Removed: separate "Screen one" and "Screen two" for lawyer + client onboarding ceremonies. Anna's onboarding moved off-stage; client onboarding folded into Marta's protagonist flow as a step inside engagement creation.
- Removed: single-amount engagement (`createEngagement` / `fundEngagement` / `releaseEngagement`). Replaced with milestone-based flow.
- Removed: "verification dual-stack" closing slide. Replaced with "verified pseudonymous engagement" punchline.
- Added: landing-page matter form + browse-verified-lawyers page as the demo's opening beats.
- Added: E2EE messaging segment (Marta's question, Anna's reply, transcript-root commitment on chain).
- Added: Tier 3 dispute beat — clicking `disputeMilestone` and showing the contract state freeze, plus a slide explaining the production arbitration path.
- Added: three-tier framing slide right after the hook.
- Tightened (still): 3:30 target with two on-stage ceremonies (Marta's whole journey + Tier 3 beat). Anna's onboarding is pre-show prep.
