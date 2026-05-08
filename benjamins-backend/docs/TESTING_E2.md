# Browser test plan — Group E2 (encrypted messaging UI)

This is the manual test pass for the chat panel that landed in Group E2
([apps/platform/components/EngagementChat.tsx](../apps/platform/components/EngagementChat.tsx)
+ [lib/messaging/transport.ts](../apps/platform/lib/messaging/transport.ts) +
[lib/messaging/keystore.ts](../apps/platform/lib/messaging/keystore.ts)).
The platform's wire shape is already covered end-to-end by the `_smoke-e1`
and `_smoke-e1-deep` Node tests; this document covers the path that runs in
a real browser, where the WebCrypto + wagmi + IndexedDB pieces light up.

## Setup (once per session)

```bash
# Terminal 1 — chain
pnpm anvil

# Terminal 2 — deploy + seed
pnpm scripts:reset

# Terminal 3 — all 4 services
pnpm dev
```

You'll need **two browser profiles** (or two browsers) so MetaMask can hold a
different account in each. The recommended split:

- **Profile 1 ("Anna")** — anvil account #1 in MetaMask. Acts as the client.
- **Profile 2 ("Carlos")** — anvil account #2. Acts as the lawyer.

Make sure each MetaMask is on chain id 31337 with RPC `http://127.0.0.1:8545`.

ngrok isn't strictly required for the chat tests, but the issuer + verifier
flows that produce the on-chain attestations do need it. Use the same
hostname in `.env`'s `PUBLIC_HOSTNAME`.

## Bring both personas to a live engagement

These steps reuse the Phase 4 path you already know — they're the
prerequisite for any chat test.

1. As Anna: visit `/onboarding/client`, sign SIWE, get a PID, present it,
   wait for the on-chain attestation to land.
2. As Carlos: visit `/onboarding/lawyer`, sign SIWE, get a bar credential,
   present it, wait for the attestation.
3. As Anna: visit `/matters` and post a matter. Then click into Carlos
   from `/lawyers/<address>` and "Send engagement request".
4. As Carlos: visit `/inbox`, propose 0.1 ETH on the request.
5. As Anna: visit `/engagements/<requestId>` and click **Accept & fund**.
   MetaMask should pop up; confirm the tx.
6. Wait for the indexer to flip the request to `accepted` — the page should
   replace the "Your move" card with the green "Engagement opened on chain"
   banner and **render the chat panel underneath**.

If you don't see the chat panel, the indexer didn't catch up — wait a couple
seconds and reload.

## E2.1 — Happy path: round-trip message

| # | Action | Expected |
|---|---|---|
| 1 | As Anna, on `/engagements/<id>`, see the chat panel after the engagement opens | "Publishing your messaging key…" briefly, then "Messaging key published." |
| 2 | Type "hello carlos" in the chat textarea, press the **Send** button (or `⌘⏎`/`Ctrl+⏎`) | MetaMask pops up with a `lex-nova/v1/message\nengagement:…\nct_hash:…\niv:…\nsalt:…` message; sign it. The textarea clears, the message appears in the panel as a "You" bubble, with a leaf number. |
| 3 | Switch to Carlos's browser, navigate to `/engagements/<id>` | The chat panel mounts, briefly publishes Carlos's key, then within 4 seconds polls and shows Anna's "hello carlos" decrypted. |
| 4 | As Carlos, send "hi anna" back | Same flow: MetaMask sig, message appears as "You" on Carlos, and within 4 s appears as a counterparty bubble in Anna's browser. |
| 5 | Reload Anna's tab | History persists — both messages are still there, decrypted. |

## E2.2 — Privacy invariants (FR-023, Inv-1)

Open Chrome/Firefox DevTools → Network tab. With chat panel mounted:

| # | Probe | Expected |
|---|---|---|
| 1 | Send a message; inspect the request to `POST /api/engagements/<id>/messages` | Body contains `{sender, ciphertext_b64, iv_b64, salt_b64, signature, created_at_client}`. **No `plaintext`, `text`, `body`, or `message` field anywhere.** |
| 2 | Inspect the response | `{ok: true, message: {…}, pending_transcript_root: "0x…"}`. No plaintext echoed. |
| 3 | Inspect `GET /api/engagements/<id>/messages` | Each row is `{ciphertext_b64, iv_b64, salt_b64, signature, transcript_leaf_index, transcript_leaf_hash, …}`. **No plaintext anywhere.** |
| 4 | Inspect `GET /api/engagements/<id>/messaging-keys` | Each key has `{kty: "EC", crv: "P-256", x, y}`. **No `d` field.** |
| 5 | Open DevTools → Application → IndexedDB → `lex-nova` → `engagement-keypairs` | A row keyed by `<requestId>` containing `{publicJwk, privateJwk}`. The `privateJwk` has a `d` field — that's *correct*: the private key lives here, in the browser, never on the server. |
| 6 | Open DevTools console, type `await fetch("/api/engagements/<id>/messages").then(r => r.text())` | Same ciphertext-only response. Plaintext exists only in the React state of *this* mounted chat panel. |

## E2.3 — Wallet disconnection (FR-026)

| # | Action | Expected |
|---|---|---|
| 1 | While on `/engagements/<id>`, disconnect the wallet from the header | Chat panel collapses to a single "Connect your wallet to view" Alert. |
| 2 | Reconnect the wallet | Chat panel re-mounts and re-fetches messages. |
| 3 | Connect a wallet that's *not* a party to this engagement | "Not a party" Alert at the page level (the engagement detail itself 403s, so the chat never even loads). |

## E2.4 — Counterparty hasn't published yet

| # | Action | Expected |
|---|---|---|
| 1 | Anna opens `/engagements/<id>` for the first time, but Carlos has never visited it | Anna's chat panel mounts, publishes her own key, and tries to send. Sending fails with toast "counterparty hasn't published their messaging key yet" because no one's encryption peer exists yet. |
| 2 | Carlos opens his side | His mount publishes his key. |
| 3 | Anna retries the send | Succeeds. |

This is expected: Anna can't encrypt a message without Carlos's public key. The
fix in real use is "wait for the counterparty to open the page once" — the
demo flow naturally does this.

## E2.5 — Tampering (the server already rejects, but confirm in browser)

These are best driven via the DevTools "Edit and Resend" panel (Firefox) or
by editing the request payload before submit.

| # | Action | Expected |
|---|---|---|
| 1 | Send a normal message. Capture the request body. Now resend that same body verbatim. | Server accepts (replay; no idempotency). Documented behavior — Phase 8 polish item. |
| 2 | Capture a request, mutate one base64 char of `ciphertext_b64`, resend | 400 — "signature does not match sender". |
| 3 | Capture a request, swap the `sender` field for the counterparty's address | 403 — "sender does not match SIWE-bound address". |
| 4 | Capture a request, add a `plaintext: "leak"` field, resend | 400 — `invalid_body / unrecognized_keys: ["plaintext"]`. |

## E2.6 — Cross-engagement isolation

If both Anna and Carlos are also engaged with a third persona (e.g. Anna ⇄
Dieter on a separate matter — recommended setup for a complete demo):

| # | Action | Expected |
|---|---|---|
| 1 | Navigate Anna's tab between `/engagements/<A.id>` and `/engagements/<B.id>` | Each chat shows only its own messages. Leaf numbers count from 1 within each engagement. |
| 2 | Inspect IndexedDB | Two separate keypair rows (`<A.id>` and `<B.id>`). Different keys per engagement — unlinkability. |
| 3 | Sign a message in A, then in B | The signed envelopes have different `engagement:` lines, so a sig captured in A can't be replayed against B. |

## E2.7 — Multiple browser sessions (key recovery awareness)

This isn't a "should work" — it's an **awareness** test. Per Inv-1 the
private key never leaves the browser, so:

| # | Action | Expected |
|---|---|---|
| 1 | After exchanging some messages, open `/engagements/<id>` in a brand-new browser profile that has the *same* MetaMask account but a *fresh* IndexedDB | The chat mounts. A new keypair gets generated. The pubkey is published — it overwrites the old one. **Old messages now show "[decrypt failed: …]"** because the old private key is gone. |

This is the *correct* behaviour for a hackathon-grade demo: cross-device key
sync is out of scope (the spec says E2EE is per-browser; production would
add E2EE key escrow or wallet-derived deterministic keys). But you should
*see* this happen so the constraint is concrete on stage.

## E2.8 — Transcript root advances

| # | Action | Expected |
|---|---|---|
| 1 | Send a message. Note the leaf index | Increments by 1 each send. |
| 2 | Open DevTools, inspect the POST response's `pending_transcript_root` | Different hex value after each new message. |
| 3 | Read the platform DB after several messages: `SELECT current_transcript_root FROM engagement_off_chain WHERE engagement_id = ?` | Matches the latest `pending_transcript_root` returned to the browser. |
| 4 | The on-chain `engagement.transcriptRoot` will *not* match yet | Expected — the chain root only advances when the next milestone state-change tx fires (T070, Group F). Document for the demo that this is the on-chain anchor checkpoint. |

## What to record

For each section, note: pass/fail + any toast text you saw. Pasting a
screenshot of the Network tab for E2.2 is high-signal evidence — that's the
"the platform never sees plaintext" claim, made visible.

If something fails, the most useful diagnostic is the `[platform]` log line
in the terminal running `pnpm dev` plus the failing request's response body
in DevTools.
