/**
 * Browser-side dispute bundle assembly + encryption (Phase 5).
 *
 * When a party files a dispute or escalates, their browser:
 *   1. Decrypts the entire engagement transcript using their per-engagement
 *      P-256 keypair (already in IndexedDB from the messaging flow).
 *   2. Pulls the off-chain artifacts (proposal chain, milestone offers,
 *      delivery attestations, refund authorizations) that aren't stored
 *      in the encrypted transcript itself.
 *   3. Generates a fresh ephemeral P-256 keypair, derives a shared key via
 *      ECDH(ephemeral_priv, operator_pub), and AES-GCM-encrypts the JSON
 *      bundle.
 *   4. POSTs the ciphertext + ephemeral pubkey + a wallet signature over
 *      the canonical message tying the ciphertext hash to the milestone.
 *
 * Constitution Inv 1: the platform never sees plaintext. The operator's
 * private key lives in their browser's IndexedDB (operator-keystore.ts);
 * only the operator can re-derive the shared secret to decrypt.
 */
"use client";

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  bytesToHex,
  deriveSharedSecret,
  disputeBundleMessage,
  generateP256Keypair,
  hkdf,
  randomBytes,
  sha256,
  type JwkP256Private,
  type JwkP256Public,
} from "@lex-nova/crypto";

import { loadMessages, type DecryptedMessage, type MessagingDeps } from "./transport";

const KEY_BYTES = 32;
const IV_BYTES = 12;
const SALT_BYTES = 16;
const INFO_BUNDLE = new TextEncoder().encode("lex-nova/dispute-bundle/v1");

/**
 * Plaintext shape of an encrypted dispute bundle. The operator's browser
 * decrypts the ciphertext into JSON of this shape and renders it.
 */
export interface DisputeBundle {
  engagement_id: number;
  milestone_index: number;
  filed_by: string;
  filed_at: number;
  /**
   * Decrypted messages with their signed envelopes + Merkle leaf positions.
   * The operator can re-verify each leaf against the on-chain
   * `transcriptRoot` of the engagement.
   */
  messages: Array<{
    leaf_index: number;
    leaf_hash: string;
    sender: string;
    plaintext: string;
    created_at: number;
    signature: string;
  }>;
  /** Pre-engagement first-milestone proposal chain (engagement_proposals). */
  first_milestone_proposals: Array<{
    id: number;
    proposer: string;
    amount_wei: string;
    note: string | null;
    signature: string;
    superseded_by: number | null;
    created_at: number;
  }>;
  /** Follow-up MilestoneOffer rows (milestone_offers). */
  milestone_offers: Array<{
    id: number;
    proposer: string;
    amount_wei: string;
    note: string | null;
    nonce: string;
    signature: string;
    accepted_milestone_index: number | null;
    superseded_by: number | null;
    created_at: number;
  }>;
  /** MutualRefundAuthorization signatures collected for any milestone. */
  refund_authorizations: Array<{
    milestone_index: number;
    signer_address: string;
    signature: string;
    created_at: number;
  }>;
}

interface RequestDetailLite {
  proposals: Array<{
    id: number;
    proposer_address: string;
    amount_wei: string;
    note: string | null;
    signature: string;
    superseded_by: number | null;
    created_at: number;
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

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${url}: HTTP ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function deriveBundleKey(
  myPriv: JwkP256Private,
  theirPub: JwkP256Public,
  salt: Uint8Array
): Promise<Uint8Array> {
  const shared = await deriveSharedSecret(myPriv, theirPub);
  return hkdf(shared, salt, INFO_BUNDLE, KEY_BYTES);
}

/**
 * Disputer-side: assemble + encrypt + upload the bundle. Returns when
 * the platform has accepted the upload; the caller should then submit the
 * on-chain dispute / escalate tx.
 */
export async function uploadDisputeBundle(
  deps: MessagingDeps,
  args: {
    requestId: number;
    engagementId: number;
    milestoneIndex: number;
    operatorPublicKey: JwkP256Public;
  }
): Promise<void> {
  // 1. Pull plaintext messages via the existing transport. Decryption uses
  //    the disputer's per-engagement keypair (in IndexedDB).
  const messages = await loadMessages(deps.myAddress, args.requestId);

  // 2. Pull off-chain artifacts. These are part of the negotiation/refund
  //    record and the arbiter cares about their signed contents.
  const [requestDetail, offers, refundAuths] = await Promise.all([
    fetchJson<RequestDetailLite>(`/api/engagements/${args.requestId}`),
    fetchJson<{ offers: DisputeBundle["milestone_offers"] }>(
      `/api/engagements/${args.requestId}/milestones/offers`
    ).catch(() => ({ offers: [] })),
    collectRefundAuths(args.requestId, args.milestoneIndex),
  ]);

  const bundle: DisputeBundle = {
    engagement_id: args.engagementId,
    milestone_index: args.milestoneIndex,
    filed_by: deps.myAddress,
    filed_at: Math.floor(Date.now() / 1000),
    messages: messages.map((m: DecryptedMessage) => ({
      leaf_index: m.transcript_leaf_index,
      leaf_hash: m.transcript_leaf_hash,
      sender: m.sender_address,
      plaintext: m.plaintext,
      created_at: m.created_at,
      // The full signed envelope isn't surfaced by `loadMessages` directly.
      // For the demo we record the sender's wallet signature is verified
      // upstream — production should include the full envelope shape so the
      // arbiter can independently re-verify. Tracked as a follow-up.
      signature: "(redacted-by-loadMessages)",
    })),
    first_milestone_proposals: requestDetail.proposals.map((p) => ({
      id: p.id,
      proposer: p.proposer_address,
      amount_wei: p.amount_wei,
      note: p.note,
      signature: p.signature,
      superseded_by: p.superseded_by,
      created_at: p.created_at,
    })),
    milestone_offers: (offers.offers ?? []).map((o) => ({
      id: o.id,
      proposer: (o as unknown as { proposer_address: string }).proposer_address ?? o.proposer,
      amount_wei: o.amount_wei,
      note: o.note,
      nonce: o.nonce,
      signature: o.signature,
      accepted_milestone_index: o.accepted_milestone_index,
      superseded_by: o.superseded_by,
      created_at: o.created_at,
    })),
    refund_authorizations: refundAuths,
  };

  // 3. Encrypt to the operator's pubkey via fresh-ephemeral ECDH.
  const ephemeral = await generateP256Keypair();
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = await deriveBundleKey(ephemeral.privateJwk, args.operatorPublicKey, salt);
  const plaintextBytes = new TextEncoder().encode(JSON.stringify(bundle));
  const ciphertext = await aesGcmEncrypt(key, iv, plaintextBytes);

  // 4. Sign the canonical message binding (engagement, milestone, ct hash).
  const ctHash = bytesToHex(await sha256(ciphertext));
  const signature = await deps.signMessage({
    message: disputeBundleMessage({
      engagementId: args.engagementId,
      milestoneIndex: args.milestoneIndex,
      ciphertextHashHex: ctHash,
    }),
  });

  // 5. POST.
  const res = await fetch(
    `/api/engagements/${args.requestId}/milestones/${args.milestoneIndex}/dispute-bundle`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ciphertext_b64: bytesToB64(ciphertext),
        iv_b64: bytesToB64(iv),
        salt_b64: bytesToB64(salt),
        ephemeral_public_key_jwk: ephemeral.publicJwk,
        signature,
      }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`dispute-bundle upload failed: HTTP ${res.status} — ${text}`);
  }
}

interface RefundAuthsResp {
  auths: Array<{ signer_address: string; created_at: number }>;
}

async function collectRefundAuths(
  requestId: number,
  milestoneIndex: number
): Promise<DisputeBundle["refund_authorizations"]> {
  // The /refund-authorization GET returns signers + created_at but not the
  // raw sig (the route doesn't expose it for non-broadcast paths). For the
  // bundle we record presence only; the arbiter uses these to know who
  // attempted a refund, not to re-verify signatures. If we later want raw
  // sigs in the bundle, extend the GET endpoint to expose them.
  try {
    const data = await fetchJson<RefundAuthsResp>(
      `/api/engagements/${requestId}/milestones/${milestoneIndex}/refund-authorization`
    );
    return data.auths.map((a) => ({
      milestone_index: milestoneIndex,
      signer_address: a.signer_address,
      signature: "(not exposed in GET)",
      created_at: a.created_at,
    }));
  } catch {
    return [];
  }
}

// ============================================================
// Operator side: decrypt
// ============================================================

export interface EncryptedBundleEnvelope {
  id: number;
  sender_address: string;
  ciphertext_b64: string;
  iv_b64: string;
  salt_b64: string;
  ephemeral_public_key_jwk: JwkP256Public;
  signature: string;
  created_at: number;
}

/**
 * Operator-side: decrypt a single bundle envelope using the operator's
 * stored P-256 private key + the disputer's ephemeral pubkey from the
 * envelope.
 */
export async function decryptDisputeBundle(
  operatorPriv: JwkP256Private,
  envelope: EncryptedBundleEnvelope
): Promise<DisputeBundle> {
  const salt = b64ToBytes(envelope.salt_b64);
  const iv = b64ToBytes(envelope.iv_b64);
  const ciphertext = b64ToBytes(envelope.ciphertext_b64);
  const key = await deriveBundleKey(operatorPriv, envelope.ephemeral_public_key_jwk, salt);
  const plaintextBytes = await aesGcmDecrypt(key, iv, ciphertext);
  return JSON.parse(new TextDecoder().decode(plaintextBytes)) as DisputeBundle;
}
