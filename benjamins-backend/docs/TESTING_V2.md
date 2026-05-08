# Browser test plan — V2 escrow (gas-reduced surface)

Manual two-profile test pass for the redesigned milestone lifecycle
(2026-05-07). Covers the V2 contract surface where milestone proposals,
delivery attestations, and refund consent moved off chain — only ETH
movement and the cooldown anchor remain on chain.

The asymmetric dispute mechanism (Constitution III + Inv 6) is preserved —
client immediate / lawyer cooldown — but in V2 only the cooldown anchor
(`markDelivered`) and the dispute resolution path remain on chain. The
happy path is **2 client txs total per milestone** (fund + release); the
lawyer signs **0 on-chain txs** in the happy path.

## Setup

Same two-profile setup as previous browser passes:

- Profile A (Anna, anvil idx 1) — client
- Profile B (Carlos, anvil idx 2) — lawyer

Run:

```bash
pnpm anvil           # terminal 1
pnpm scripts:reset   # terminal 2 (deploys V2 escrow + applies migration 007)
pnpm dev             # terminal 3
ngrok http --url=<your-domain> 3000   # terminal 4
```

Bring both personas through the existing onboarding + first-milestone
funding flow (the prereq section of the prior TESTING_E2.md still
applies — engagement open + first milestone funded works the same way
in V2; nothing changed about `openEngagementAndFundFirstMilestone`).
After the engagement opens, the page should show:

- A green "Engagement opened on chain" banner.
- A **Milestones** card with `#0 · 0.1 ETH · funded` and a single
  **Release 0.1 ETH** button (Anna only). **No Mark delivered button** —
  that's the V2 change.
- The chat panel.

## V2.1 — Happy path: release directly from `funded`

This is the biggest UX change. Lawyer doesn't need to do anything on chain
for the milestone to flow.

| # | Action | Expected |
|---|---|---|
| 1 | As Anna on `/engagements/<id>` | Milestones card shows `#0 · 0.1 ETH · funded`. **Release 0.1 ETH** button visible. **No Mark delivered button anywhere.** Under "Advanced: start escalation cooldown" disclosure (closed by default), Carlos's view has a tiny ghost button — ignore it for happy path. |
| 2 | As Anna, click **Release 0.1 ETH** | **One MetaMask popup**: `releaseMilestone(engagementId, 0)`. No second popup for an anchor follow-up — V2 anchors only at close/dispute. |
| 3 | After ~1.5s | Milestone 0 badge flips to `released`. Carlos's wallet receives 0.1 ETH (verify with `cast balance <Carlos>` if you want hard evidence). |
| 4 | Switch to Carlos, reload `/engagements/<id>` | Milestone 0 shows `released`. No actions visible. |

**What to confirm here:** release succeeds directly from the `funded`
state. The error message "milestone is funded; only 'delivered' can be
released" should never appear — if it does, the route is still on the
old V1 state check.

## V2.2 — Follow-up milestone via signed offer (no on-chain propose)

Replaces V1's `proposeMilestone` tx with an off-chain signed
`MilestoneOffer`. Either party can author one; the client funds it.

> **Use the lawyer-originates-first flow when running this test.** The
> current UI also lets the client originate an offer, but with no
> explicit Counter/Decline affordances on the recipient side that path
> reads as a dead end. The frontend rework will tighten this — for
> mechanics validation, lawyer-first is the canonical sequence.

| # | Action | Expected |
|---|---|---|
| 1 | As Carlos on `/engagements/<id>`, scroll to **Propose follow-up milestone (signed off chain — no gas)** | Form with Amount + Note + **Sign + propose** button. |
| 2 | Enter `0.2`, optional note, click **Sign + propose** | **MetaMask sign popup** (NOT a tx — `personal_sign` over a canonical message). Confirm. **No gas charged.** Toast: "Offer signed and posted". |
| 3 | After Carlos's offer posts | A new **Active offer** card appears at the top of the milestones panel showing `0.2 ETH` and `from 0xabc…ef0`. On Carlos's screen the card says "from you" with no Fund button (you can't self-fund) and "Awaiting the other party — they can fund this offer or counter with their own." |
| 4 | Switch to Anna | Same Active offer card, now with a **Fund 0.2 ETH** button. The card refreshes via SSE without reload (verify Network tab: an event lands on `/api/me/events/stream` or `/api/engagements/.../events/stream`). |
| 5 | Anna clicks **Fund 0.2 ETH** | **One MetaMask tx popup**: `fundMilestone(engagementId, 200000000000000000)` with `value: 0.2 ETH`. Confirm. |
| 6 | After indexer catches up | New milestone `#1 · 0.2 ETH · funded` appears in the list. Active offer card disappears (the offer's `accepted_milestone_index` flipped on the indexer's `MilestoneFunded` handler). |

**What to confirm here:**

- Step 2 is a **sign** popup, not a tx popup — if MetaMask shows a gas
  estimate, the off-chain offer flow isn't being used.
- Step 5 is **a single tx** with no follow-up anchor.
- Milestone #1 shows the full `0.2 ETH` immediately (not `0 ETH`).

## V2.3 — Counter-offer (either party can counter)

| # | Action | Expected |
|---|---|---|
| 1 | While Carlos's offer is the head, as Anna fill the propose form with `0.15` | **Sign + propose** signs Anna's counter (different amount). |
| 2 | After post | Active offer card now shows `0.15 ETH · from you` on Anna's view, "from 0xabc…ef0" on Carlos's view. |
| 3 | Carlos can either fund (he can't — only client funds) or counter back | Carlos has no Fund button; he can re-counter with a new amount. |
| 4 | After several iterations, Anna funds the latest offer | Same as V2.2 step 5–6. The full offer chain is in the DB (`milestone_offers.prev_offer_id` links each one), persisting the negotiation history. |

## V2.4 — Mutual refund (replaces V1 unilateral refund)

V1's "either party clicks Refund and it's done" is gone — neither party
can unilaterally pull a deposit. Both must EIP-712-sign a
`MutualRefundAuthorization`; either then submits the on-chain tx.

| # | Action | Expected |
|---|---|---|
| 1 | While milestone `#1` is `funded`, as Anna click **Sign mutual refund** | **MetaMask "Signature request" popup with structured data** (typed-data, not a tx). Domain shows `LexNovaEscrow v1` and the contract address. Confirm. |
| 2 | After post | Toast: "Signature recorded; waiting for the other party". Below the milestone row: `Mutual refund: client ✓ signed · lawyer — not yet`. |
| 3 | Switch to Carlos | Same milestone row shows `client ✓ signed · lawyer — not yet`. **Sign mutual refund** button visible. |
| 4 | Carlos clicks **Sign mutual refund** | Typed-data popup (his sig). Confirm. Toast: "Both parties have signed — submit the refund to release funds". The status text now reads `client ✓ · lawyer ✓` and a **Submit refund (both signed)** button appears. |
| 5 | Either party clicks **Submit refund (both signed)** | **One MetaMask tx popup**: `mutualRefundMilestone(engagementId, 1, clientSig, lawyerSig)`. Confirm. |
| 6 | After ~1.5s | Milestone #1 badge flips to `refunded`. Anna's wallet recovers 0.2 ETH (minus gas she paid in step 5 if she submitted). |

**What to confirm here:**

- Steps 1 and 4 show MetaMask's EIP-712 typed-data UI (human-readable
  struct with field names), not a raw hash blob.
- Submitting before both sigs are present 409s with
  `{ error: "mutual refund requires both signatures", missing: [...] }`
  — try clicking Submit early as a sanity check.

## V2.5 — Close engagement (final root anchored inline)

V1 closed in two txs (close + anchor); V2 anchors atomically.

| # | Action | Expected |
|---|---|---|
| 1 | While milestone #0 is `released` and milestone #1 is `refunded` (both terminal), as either party click **Close engagement** | **One MetaMask tx popup**: `closeEngagement(engagementId, finalTranscriptRoot)`. Confirm. The final root is the latest `current_transcript_root` from the off-chain mirror. |
| 2 | After ~1.5s | Card replaced with "Engagement closed" alert. The Milestones card lists historical state with no action buttons. The on-chain `transcriptRoot` advanced to the final root (verify via `escrow.getEngagement(engId).transcriptRoot` if curious). |

## V2.6 — Lawyer escalation cooldown (still asymmetric)

Constitution Inv 6: cooldown is contract-enforced. V2 keeps `markDelivered`
on chain solely as the cooldown trigger.

| # | Action | Expected |
|---|---|---|
| 1 | Open a fresh engagement, fund milestone #0 | Standard prereq. |
| 2 | As Carlos, expand the "Advanced: start escalation cooldown" disclosure on milestone #0 | Reveals copy explaining this is for unresponsive-client scenarios + a **Start 30-day cooldown** ghost button. |
| 3 | Click **Start 30-day cooldown** | **One MetaMask tx popup**: `markDelivered(engagementId, 0)`. Confirm. Milestone badge flips to `delivered`; the row shows `cooldown clock started at <timestamp>`. |
| 4 | Try to call `escalateMilestone` immediately (DevTools fetch on `escalate-calldata` if/when that route is added — currently not built) | Contract reverts with `CooldownNotElapsed(unlockAt)`. Verifies Inv 6 still holds. |
| 5 | (Anna's view) After the lawyer marks delivered, the **Release** button is still available | V2 release accepts both `funded` and `delivered`, so step 3 doesn't lock Anna out. |

> **Note:** the escalation/dispute UI is deferred to Phase 5 (US3); the
> contract supports it but no `/dispute-calldata`, `/escalate-calldata`,
> `/assign-arbiter-calldata`, or `/resolve-calldata` routes exist yet.
> This step verifies the cooldown anchor only.

## V2.7 — Auth probes (defense-in-depth)

| # | Action | Expected |
|---|---|---|
| 1 | As Anna, hit `POST /api/engagements/<id>/milestones/0/deliver-calldata` (DevTools console fetch) | 403 — only the lawyer can call markDelivered. |
| 2 | As Carlos, hit `POST /api/engagements/<id>/milestones/0/release-calldata` | 403 — only the client can release. |
| 3 | As either, POST `/api/engagements/<id>/milestones/offers` with a `signature` not matching the SIWE-bound caller | 403 — "signature does not match SIWE-bound address". |
| 4 | POST `/api/engagements/<id>/milestones/0/refund-authorization` with a syntactically valid sig over a *different* engagement id | 403 — "signature does not match SIWE-bound address" (the recovered signer won't be you). |
| 5 | Hit `/api/engagements/<id>/milestones/99/refund-calldata` (nonexistent milestone) | 404 — milestone not found. |
| 6 | After engagement is closed, POST a follow-up offer | 409 — "engagement is closed". |
| 7 | After engagement is closed, hit `release-calldata` | 409 — same. |

## V2.8 — Privacy / scope checks (carries over from prior passes)

After running V2.1–V2.5, briefly recheck:

| Probe | Expected |
|---|---|
| `GET /api/engagements/<id>/messages` | Same ciphertext-only shape as before. New transcript leaves accumulating per chat send; the on-chain root only advances at close/dispute, but the off-chain `current_transcript_root` advances on every message. |
| `GET /api/engagements/<id>/milestones/offers` | Lists every signed offer for the engagement, including superseded ones. Each row exposes `proposer_address`, `amount_wei`, `note`, `nonce`, `signature` — but **never plaintext message content** (offers carry only the price + scoping note, which is already disclosed by design). |
| `GET /api/engagements/<id>/milestones/0/refund-authorization` | When called by a party, returns `{has_client_sig, has_lawyer_sig, ready, auths: [...]}`. The `auths` array holds `signer_address` + `created_at` only — full sigs are not exposed unless they're already needed for the `mutualRefundMilestone` calldata. |
| `GET /api/chain/config` (no auth) | Returns chain id + escrow address + attestation manager address. Public info; `Cache-Control: public, max-age=300`. |
| Network tab → response of any milestone calldata route | Body shape is `{contract_address, function_name, abi, args, value_wei?}` — V2 dropped the V1 `{primary, anchor}` envelope. Server returns no plaintext, no signed material the wallet didn't already see, only call args. |

## V2.9 — Per-milestone gas budget (regression bench)

Verify the gas reduction is real. Compare your wallet's **tx count** with
V1's pattern:

| Step                  | V1 txs | V2 txs |
| --------------------- | ------ | ------ |
| Fund first milestone  | 1 (client) | 1 (client) |
| Mark delivered        | 1 (lawyer) | **0** (off-chain attestation, optional on-chain) |
| Release               | 1 (client) + 1 anchor | 1 (client) |
| Propose follow-up     | 1 (either) + 1 anchor | **0** (signed offer) |
| Fund follow-up        | 1 (client) | 1 (client) |
| Close                 | 1 (either) + 1 anchor | 1 (either) |
| **Total per milestone** | **5–7 txs across both wallets** | **2 txs (both client-side)** |

If you see anything other than two MetaMask popups across the
fund→release happy path, V2 routing isn't fully wired — file the spot.

## What to record

For each section, note pass/fail + any toast text or error banner you saw.
The most demo-relevant evidence is V2.1 (release without markDelivered)
and V2.2 step 2 (sign-not-tx for offers). Those two prove the
gas-reduction story cleanly.

## Known UX warts (deferred)

- **Offer affordances are minimal.** The recipient of a signed offer has
  no explicit Counter or Decline button on the offer card — they have to
  scroll to the propose form below to sign a counter, and there's no
  decline path at all. The mechanics work; the UI rework will add
  Counter/Decline directly on the offer card and likely restrict
  client-originated offers to "counter only" (visible only when an
  active offer exists).
- **Dispute UI not built.** The contract + indexer + DB columns are V2-ready;
  no `disputeMilestone` / `escalateMilestone` / `assignArbiter` /
  `resolveDispute` calldata routes or buttons exist. Phase 5 (US3).
- **Delivery attestation chat bubble not built.** The
  `delivery_attestations` table exists; nothing posts to it or reads
  from it. The lawyer's "delivered" indicator is currently only the
  on-chain `Delivered` state, surfaced by the (rare) Advanced disclosure.
- **Operator admin UI for `assignArbiter` not built.** Same shape — the
  contract supports per-dispute assignment from the verified-arbiter
  pool, but there's no operator-facing page yet.
- **No in-page warning when MetaMask is on the wrong chain.** Carries
  over from V1; deferred to Phase 8 polish.
