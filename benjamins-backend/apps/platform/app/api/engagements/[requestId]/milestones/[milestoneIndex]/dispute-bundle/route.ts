import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isHex, type Address, type Hex } from "viem";

import { disputeBundleMessage, sha256, bytesToHex, verifyMessageSignature } from "@lex-nova/crypto";
import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { operatorAddress } from "@/lib/chain/clients";
import { resolveEngagement } from "@/lib/engagement-resolve";

export const runtime = "nodejs";

/**
 * Encrypted dispute bundle storage (Phase 5 dispute disclosure flow).
 *
 * POST: party-only. The disputer's browser assembles the engagement
 * transcript (decrypted plaintexts + signed envelopes + Merkle inclusion
 * proofs + off-chain proposals/offers/attestations), encrypts the bundle
 * to the operator's published P-256 pubkey via fresh-ephemeral ECDH, and
 * uploads the ciphertext here BEFORE submitting the on-chain dispute /
 * escalate tx. The platform stores ciphertext only — Constitution Inv 1.
 *
 * GET: operator-only. Returns the stored ciphertext for the operator's
 * browser to decrypt with their wallet's local private key (IndexedDB).
 */

const PostSchema = z
  .object({
    ciphertext_b64: z.string().min(1),
    iv_b64: z.string().min(1),
    salt_b64: z.string().min(1),
    ephemeral_public_key_jwk: z.record(z.string(), z.unknown()),
    signature: z.string().refine(isHex, "expected 0x-hex signature"),
  })
  .strict();

interface BundleRow {
  id: number;
  sender_address: string;
  ciphertext: Buffer;
  iv: Buffer;
  salt: Buffer;
  ephemeral_public_key_jwk: string;
  signature: string;
  created_at: number;
}

function decodeB64(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string; milestoneIndex: string } }
) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const requestId = Number(params.requestId);
  const milestoneIndex = Number(params.milestoneIndex);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }
  if (!Number.isInteger(milestoneIndex) || milestoneIndex < 0) {
    return NextResponse.json({ error: "invalid milestone index" }, { status: 400 });
  }

  let parsed: z.infer<typeof PostSchema>;
  try {
    parsed = PostSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_body", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  const db = getDb();
  const r = resolveEngagement(db, requestId, address);
  if (!r) {
    return NextResponse.json({ error: "engagement not opened yet" }, { status: 404 });
  }
  if (r.role === "none") {
    return NextResponse.json({ error: "not a party to this engagement" }, { status: 403 });
  }

  // Accept the bundle while the milestone is still in funded/delivered
  // OR already disputed (the disputer sometimes races the on-chain tx).
  // Anything else means the milestone has been resolved/refunded/released
  // and a bundle is no longer meaningful.
  const milestone = db
    .prepare(`SELECT state FROM milestones WHERE engagement_id = ? AND milestone_index = ?`)
    .get(r.engagement.engagement_id, milestoneIndex) as { state: string } | undefined;
  if (!milestone) {
    return NextResponse.json({ error: "milestone not found" }, { status: 404 });
  }
  if (
    milestone.state !== "funded" &&
    milestone.state !== "delivered" &&
    milestone.state !== "disputed"
  ) {
    return NextResponse.json(
      {
        error: `milestone is ${milestone.state}; bundle uploads are accepted only while a dispute is open or imminent`,
      },
      { status: 409 }
    );
  }

  // Verify the signature ties the SIWE-bound caller to this specific
  // (engagement, milestone, ciphertext) tuple. The canonical message hashes
  // the ciphertext, so swapping the bundle for a different one invalidates
  // the sig.
  const ciphertext = decodeB64(parsed.ciphertext_b64);
  const ctHashBytes = await sha256(new Uint8Array(ciphertext));
  const ctHashHex = bytesToHex(ctHashBytes);
  const canonical = disputeBundleMessage({
    engagementId: r.engagement.engagement_id,
    milestoneIndex,
    ciphertextHashHex: ctHashHex,
  });
  let sigOk: boolean;
  try {
    sigOk = await verifyMessageSignature({
      address: address as Address,
      message: canonical,
      signature: parsed.signature as Hex,
    });
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return NextResponse.json(
      { error: "signature does not match the SIWE-bound address" },
      { status: 400 }
    );
  }

  const iv = decodeB64(parsed.iv_b64);
  const salt = decodeB64(parsed.salt_b64);
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO dispute_bundles
       (engagement_id, milestone_index, sender_address, ciphertext, iv, salt,
        ephemeral_public_key_jwk, signature, created_at)
     VALUES (?, ?, lower(?), ?, ?, ?, ?, ?, ?)
     ON CONFLICT(engagement_id, milestone_index, sender_address) DO UPDATE SET
       ciphertext = excluded.ciphertext,
       iv = excluded.iv,
       salt = excluded.salt,
       ephemeral_public_key_jwk = excluded.ephemeral_public_key_jwk,
       signature = excluded.signature,
       created_at = excluded.created_at`
  ).run(
    r.engagement.engagement_id,
    milestoneIndex,
    address,
    ciphertext,
    iv,
    salt,
    JSON.stringify(parsed.ephemeral_public_key_jwk),
    parsed.signature,
    now
  );

  return NextResponse.json({ ok: true });
}

export async function GET(
  _req: Request,
  { params }: { params: { requestId: string; milestoneIndex: string } }
) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (address.toLowerCase() !== operatorAddress().toLowerCase()) {
    return NextResponse.json({ error: "operator only" }, { status: 403 });
  }
  const requestId = Number(params.requestId);
  const milestoneIndex = Number(params.milestoneIndex);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }
  if (!Number.isInteger(milestoneIndex) || milestoneIndex < 0) {
    return NextResponse.json({ error: "invalid milestone index" }, { status: 400 });
  }

  const db = getDb();
  const r = resolveEngagement(db, requestId, address);
  if (!r) {
    return NextResponse.json({ error: "engagement not opened yet" }, { status: 404 });
  }

  const rows = db
    .prepare(
      `SELECT id, sender_address, ciphertext, iv, salt, ephemeral_public_key_jwk,
              signature, created_at
       FROM dispute_bundles
       WHERE engagement_id = ? AND milestone_index = ?
       ORDER BY created_at ASC`
    )
    .all(r.engagement.engagement_id, milestoneIndex) as BundleRow[];

  return NextResponse.json({
    bundles: rows.map((b) => ({
      id: b.id,
      sender_address: b.sender_address,
      ciphertext_b64: b.ciphertext.toString("base64"),
      iv_b64: b.iv.toString("base64"),
      salt_b64: b.salt.toString("base64"),
      ephemeral_public_key_jwk: JSON.parse(b.ephemeral_public_key_jwk),
      signature: b.signature,
      created_at: b.created_at,
    })),
  });
}
