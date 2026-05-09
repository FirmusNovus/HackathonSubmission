/**
 * Browser-side messaging transport (T061).
 *
 * Wraps:
 *   keystore (per-engagement P-256 keypair)
 *   @lex-nova/crypto/ecdh (ECDH → HKDF → AES-GCM)
 *   @lex-nova/crypto/sign  (canonical envelope message)
 *   wagmi signMessage      (wallet binds the envelope to the sender)
 *
 * sendMessage(deps, requestId, plaintext)
 *   → encrypts client-side, signs envelope with the wallet, POSTs ciphertext-only
 *
 * loadMessages(deps, requestId)
 *   → fetches ciphertext envelopes and decrypts each one client-side
 *
 * The platform NEVER sees plaintext (Constitution Inv-1, FR-023). The server
 * route's zod `.strict()` schema makes that load-bearing — even an attacker
 * trying to sneak `plaintext` into the body gets a 400.
 */
"use client";

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  bytesToHex,
  deriveSharedSecret,
  envelopeMessage,
  hexToBytes,
  hkdf,
  randomBytes,
  sha256,
  type JwkP256Public,
} from "@lex-nova/crypto";

import { getOrCreateKeypair } from "./keystore";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;

export interface MessagingDeps {
  /** Wallet's signMessage — supplied by wagmi `useSignMessage`. */
  signMessage: (args: { message: string }) => Promise<`0x${string}`>;
  /** Caller's checksummed wallet address. */
  myAddress: `0x${string}`;
}

export interface DecryptedMessage {
  id: number;
  sender_address: string;
  plaintext: string;
  created_at: number;
  transcript_leaf_index: number;
  transcript_leaf_hash: string;
  is_self: boolean;
}

interface RequestDetail {
  request: {
    id: number;
    matter_id: number;
    client_address: string;
    lawyer_address: string;
    status: string;
  };
}

interface MessagingKeysResponse {
  engagement_id: number;
  keys: Array<{ party_address: string; public_key_jwk: JwkP256Public; created_at: number }>;
}

interface MessagesResponse {
  engagement_id: number;
  messages: Array<{
    id: number;
    sender_address: string;
    ciphertext_b64: string;
    iv_b64: string;
    salt_b64: string;
    signature: string;
    created_at: number;
    transcript_leaf_index: number;
    transcript_leaf_hash: string;
  }>;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${url}: HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function getEngagementContext(requestId: number, myAddress: string) {
  const detail = await fetchJson<RequestDetail>(`/api/engagements/${requestId}`);
  const counterpartyAddress =
    detail.request.client_address.toLowerCase() === myAddress.toLowerCase()
      ? detail.request.lawyer_address
      : detail.request.client_address;
  const keys = await fetchJson<MessagingKeysResponse>(`/api/engagements/${requestId}/messaging-keys`);
  const counterpartyKey = keys.keys.find(
    (k) => k.party_address.toLowerCase() === counterpartyAddress.toLowerCase()
  );
  return {
    engagementId: keys.engagement_id,
    counterpartyAddress,
    counterpartyKey: counterpartyKey?.public_key_jwk ?? null,
  };
}

/**
 * Ensure our P-256 keypair exists locally and that the platform's directory
 * has our public half. Idempotent: if both are already in place, no-op.
 */
export async function ensureKeypairPublished(requestId: number): Promise<JwkP256Public> {
  const kp = await getOrCreateKeypair(requestId);
  // Always POST — the server uses ON CONFLICT DO UPDATE so this is cheap
  // and self-healing if a previous publish was lost.
  const res = await fetch(`/api/engagements/${requestId}/messaging-key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ public_key_jwk: kp.publicJwk }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`publish messaging-key failed: HTTP ${res.status} — ${text}`);
  }
  return kp.publicJwk;
}

const INFO_PREFIX = "lex-nova/engagement/";

export async function sendMessage(
  deps: MessagingDeps,
  requestId: number,
  plaintext: string
): Promise<{ id: number; transcript_leaf_index: number; pending_transcript_root: string }> {
  await ensureKeypairPublished(requestId);
  const ctx = await getEngagementContext(requestId, deps.myAddress);
  if (!ctx.counterpartyKey) {
    throw new Error("counterparty hasn't published their messaging key yet");
  }
  const me = await getOrCreateKeypair(requestId);

  const sharedSecret = await deriveSharedSecret(me.privateJwk, ctx.counterpartyKey);
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const info = new TextEncoder().encode(INFO_PREFIX + ctx.engagementId);
  const aesKey = await hkdf(sharedSecret, salt, info, KEY_BYTES);

  const ciphertext = await aesGcmEncrypt(aesKey, iv, new TextEncoder().encode(plaintext));
  const ctHashHex = bytesToHex(await sha256(ciphertext));
  const ivHex = bytesToHex(iv);
  const saltHex = bytesToHex(salt);

  const canonical = envelopeMessage({
    engagementId: ctx.engagementId,
    ciphertextHashHex: ctHashHex,
    ivHex,
    saltHex,
  });
  const signature = await deps.signMessage({ message: canonical });

  const post = await fetch(`/api/engagements/${requestId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: deps.myAddress,
      ciphertext_b64: bytesToB64(ciphertext),
      iv_b64: bytesToB64(iv),
      salt_b64: bytesToB64(salt),
      signature,
      created_at_client: Math.floor(Date.now() / 1000),
    }),
  });
  if (!post.ok) {
    const text = await post.text();
    throw new Error(`send failed: HTTP ${post.status} — ${text}`);
  }
  const data = (await post.json()) as {
    message: { id: number; transcript_leaf_index: number };
    pending_transcript_root: string;
  };
  return {
    id: data.message.id,
    transcript_leaf_index: data.message.transcript_leaf_index,
    pending_transcript_root: data.pending_transcript_root,
  };
}

/**
 * Fetch the engagement's ciphertext envelopes and decrypt each one.
 *
 * ECDH is symmetric: both parties derive the same shared secret from
 * `(myPriv, counterpartyPub)`. So regardless of who sent a given message,
 * the recipient always uses the *counterparty's* pubkey here — never the
 * sender's. (Using the sender's pubkey would derive `(myPriv, myPub)` for
 * messages I sent myself, which is a different key from the one that
 * encrypted them — and that's the bug self-messages previously hit.)
 */
export async function loadMessages(
  myAddress: `0x${string}`,
  requestId: number
): Promise<DecryptedMessage[]> {
  const me = await getOrCreateKeypair(requestId);
  const detail = await fetchJson<RequestDetail>(`/api/engagements/${requestId}`);
  const counterpartyAddress =
    detail.request.client_address.toLowerCase() === myAddress.toLowerCase()
      ? detail.request.lawyer_address
      : detail.request.client_address;
  const keysResp = await fetchJson<MessagingKeysResponse>(
    `/api/engagements/${requestId}/messaging-keys`
  );
  const engagementId = keysResp.engagement_id;
  const counterpartyKey = keysResp.keys.find(
    (k) => k.party_address.toLowerCase() === counterpartyAddress.toLowerCase()
  )?.public_key_jwk;

  const messagesResp = await fetchJson<MessagesResponse>(
    `/api/engagements/${requestId}/messages`
  );
  const info = new TextEncoder().encode(INFO_PREFIX + engagementId);

  const out: DecryptedMessage[] = [];
  for (const m of messagesResp.messages) {
    const isSelf = m.sender_address.toLowerCase() === myAddress.toLowerCase();
    let plaintext: string;
    if (!counterpartyKey) {
      plaintext = "[counterparty's messaging key not on file]";
    } else {
      try {
        const sharedSecret = await deriveSharedSecret(me.privateJwk, counterpartyKey);
        const salt = b64ToBytes(m.salt_b64);
        const iv = b64ToBytes(m.iv_b64);
        const ct = b64ToBytes(m.ciphertext_b64);
        const aesKey = await hkdf(sharedSecret, salt, info, KEY_BYTES);
        const pt = await aesGcmDecrypt(aesKey, iv, ct);
        plaintext = new TextDecoder().decode(pt);
      } catch (e) {
        // Most likely cause: keystore was wiped after the message was sent,
        // so the local private key no longer matches the published public
        // key. Show the failure so the UI can prompt a re-publish.
        plaintext = `[decrypt failed: ${(e as Error).message}]`;
      }
    }
    out.push({
      id: m.id,
      sender_address: m.sender_address,
      plaintext,
      created_at: m.created_at,
      transcript_leaf_index: m.transcript_leaf_index,
      transcript_leaf_hash: m.transcript_leaf_hash,
      is_self: isSelf,
    });
  }
  return out;
}

// re-export for tests / debugging
export { hexToBytes };
