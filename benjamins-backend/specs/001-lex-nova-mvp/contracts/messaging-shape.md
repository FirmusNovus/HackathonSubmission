# Messaging Shape — E2EE Envelope + Transcript

The platform never possesses key material that can decrypt a message. Encryption happens in the browser via WebCrypto; ciphertext is opaque bytes to every server-side code path.

## Per-engagement key derivation

When an engagement opens, both parties derive a shared secret in the browser:

```text
sharedSecret  = ECDH(myWalletPrivateKey, theirWalletPublicKey)   // P-256
masterKey     = HKDF-SHA-256(sharedSecret, salt = engagementId, info = "lex-nova/v1/master")
```

`myWalletPrivateKey` is **not** the user's main wallet signing key (which is secp256k1, not exportable). It is a P-256 key generated client-side at onboarding, persisted in the wallet via `wagmi`-managed storage, and registered on chain at the engagement-opening transaction so the counterparty can fetch the public half. Implementation detail: the public half is one of the disclosed-attribute extras stored alongside the EAS attestation's metadata; it is *not* part of the SD-JWT VC.

For each message the sender derives a per-message AES-GCM key:

```text
messageKey    = HKDF-SHA-256(masterKey, salt = randomNonce, info = "lex-nova/v1/msg")
ciphertext    = AES-GCM-256(messageKey, iv = nonce[0..12], plaintext, aad = engagementId || senderAddress)
```

## Message envelope

What the browser POSTs to `/api/engagements/:id/messages`:

```json
{
  "engagementId": 42,
  "sender": "0xMartaAddress…",
  "ciphertext_b64": "<base64>",
  "iv_b64": "<base64 12-byte IV>",
  "salt_b64": "<base64 16-byte HKDF salt>",
  "signature": "<hex ECDSA secp256k1 signature over keccak256(ciphertext || iv || salt || sender || engagementId)>",
  "createdAtClient": 1714986300
}
```

Server-side persistence in the `messages` table — note the schema has no `plaintext` column, no `messageKey` column, no `masterKey` column. There is no key column anywhere. The signature is verified server-side against `sender`'s known address before insertion, so a third party cannot forge envelopes; this verification uses only public material.

## Per-engagement Merkle transcript

For every accepted envelope:

```text
leaf_i  = SHA-256(ciphertext || signature || sender || createdAtClient || i)
tree    = incremental-Merkle (depth 16, supports 65 536 messages per engagement)
root    = tree.root() after appending leaf_i
```

The off-chain root is held in `engagement_off_chain.current_transcript_root`. Whenever the contract takes any state-changing action on the engagement (fund / deliver / release / dispute / claim / resolve / refund / close / explicit `anchorTranscript`), the route handler that prepares the calldata first reads the latest off-chain root and includes it in the on-chain call, so the contract emits `TranscriptAnchored(engagementId, root, blockNumber)`.

## Why this scheme satisfies the constitution

- **Invariant 1 (no platform-held decryption keys)**: the browser holds the P-256 private key half; the server has neither half of the ECDH pair, nor the master key, nor any per-message key. Verified by absence — there is no decryption helper in `lib/crypto/` server side; the helpers exist only in the client bundle.
- **Invariant 5 (per-engagement message transcripts tamper-evident)**: every milestone state transition anchors the root. After the anchor, every prior message hash is committed; tampering with any prior ciphertext changes the leaf, changes the root, fails to match the chain.
- **Privilege as Cryptography (Principle I)**: a subpoena returns ciphertext + signatures + Merkle leaves + on-chain roots. None of these reveal plaintext.

## What can be disputed and how the parties surface evidence

If the lawyer escalates after cooldown or the client disputes, the arbiter sees on chain: the engagement parties, the matter description, the milestone amount, the deliveredAt, the transcript root chain, and the disclosed-attribute subsets of both parties.

Either party may *choose* to decrypt a portion of the message history client-side and share the plaintext directly with the arbiter through any channel they prefer (the platform offers a "share decrypted excerpt" UI button that produces a signed plaintext + the corresponding leaves + a proof of inclusion in the anchored root). The platform itself does not possess decryption keys for this; the parties always do.

If neither party shares anything, the arbiter sees only the metadata above — and the spec clarification holds that "if one side refuses to decrypt the interaction history, the cooperative side automatically wins" by default convention; the arbiter resolves accordingly. This is a social rule, not a contract rule (the arbiter still has full discretion under `resolveDispute`).

## What is NOT in this scheme (and why)

- **No XMTP/Waku transport**: in MVP, the transport is HTTP POST/GET against the Next.js API. The cryptographic shape is identical to what XMTP would use; substituting XMTP later is a transport swap, not a protocol change.
- **No threshold-encrypted backup of the master key**: production trajectory only.
- **No forward secrecy via Double Ratchet**: the constitution does not require it for MVP. Adding Signal-style ratcheting is a future amendment item.
- **No public-key infrastructure for the per-engagement P-256 keys**: the keys are short-lived (per-engagement) and registered by their owners on the engagement-open transaction. A future iteration could add a per-wallet long-lived registry.
