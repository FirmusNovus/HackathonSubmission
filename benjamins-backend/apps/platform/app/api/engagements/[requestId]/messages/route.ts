import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isHex, type Address, type Hex } from "viem";

import { envelopeMessage, sha256, verifyMessageSignature, bytesToHex } from "@lex-nova/crypto";
import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getEngagementByRequest } from "@/lib/messaging/engagement-keys";
import { emitForRequest } from "@/lib/messaging/event-bus";
import {
  messageLeaf,
  proposalLeaf,
  transcriptRootFromAll,
  type ProposalLeafInput,
  type MessageLeafInput,
} from "@/lib/transcript";

export const runtime = "nodejs";

/**
 * Encrypted-message persistence (T063 / FR-023, FR-024).
 *
 * The platform NEVER sees plaintext. The body schema accepts only the
 * encrypted envelope fields plus the sender's wallet signature over them;
 * `.strict()` is the load-bearing guard — any `plaintext`, `text`, `body`,
 * or otherwise-unexpected key is rejected with a 400 before we even look at
 * the engagement.
 *
 * Each persisted row is a leaf in the per-engagement Merkle transcript
 * (Inv-5). The proposal chain forms the first N leaves; messages start at
 * index N. The on-chain anchor is updated by Group F's milestone-state-
 * change tx flow; this route just persists and recomputes the off-chain
 * mirror root so the next anchor will commit it.
 */
const POSTMessageSchema = z
  .object({
    sender: z.string().refine(isHex, "expected 0x address"),
    ciphertext_b64: z.string().min(1),
    iv_b64: z.string().min(1),
    salt_b64: z.string().min(1),
    signature: z.string().refine(isHex, "expected 0x-hex signature"),
    created_at_client: z.number().int().positive(),
  })
  .strict();

interface ProposalRow {
  matter_id: number;
  amount_wei: string;
  note: string | null;
  signature: string;
  prev_proposal_id: number | null;
}

interface MessageRow {
  id: number;
  engagement_id: number;
  sender_address: string;
  ciphertext: Buffer;
  iv: Buffer;
  salt: Buffer;
  signature: string;
  created_at: number;
  transcript_leaf_index: number;
  transcript_leaf_hash: string;
}

function decodeB64(b64: string): Buffer {
  return Buffer.from(b64, "base64");
}

function bufToHex(buf: Buffer): string {
  return "0x" + buf.toString("hex");
}

export async function POST(
  req: NextRequest,
  { params }: { params: { requestId: string } }
) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }

  let parsed: z.infer<typeof POSTMessageSchema>;
  try {
    parsed = POSTMessageSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "invalid_body", issues: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "malformed json" }, { status: 400 });
  }

  // Anti-spoof: the SIWE-bound caller is the only one who can post as itself.
  if (parsed.sender.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json(
      { error: "sender does not match SIWE-bound address" },
      { status: 403 }
    );
  }

  const db = getDb();
  const eng = getEngagementByRequest(db, requestId);
  if (!eng) {
    return NextResponse.json(
      { error: "no engagement opened for this request yet" },
      { status: 404 }
    );
  }
  const isParty =
    eng.client_address.toLowerCase() === address.toLowerCase() ||
    eng.lawyer_address.toLowerCase() === address.toLowerCase();
  if (!isParty) {
    return NextResponse.json({ error: "not a party to this engagement" }, { status: 403 });
  }
  if (eng.state !== "active") {
    return NextResponse.json({ error: "engagement is closed" }, { status: 409 });
  }

  // Decode binary fields and reconstruct the canonical envelope message the
  // sender signed over. The ciphertext-hash is sha256 of the raw ciphertext
  // bytes — clients compute the same hash before signing.
  const ciphertext = decodeB64(parsed.ciphertext_b64);
  const iv = decodeB64(parsed.iv_b64);
  const salt = decodeB64(parsed.salt_b64);
  const ctHashBytes = await sha256(new Uint8Array(ciphertext));
  const ctHashHex = bytesToHex(ctHashBytes);
  const ivHex = bufToHex(iv);
  const saltHex = bufToHex(salt);

  const canonical = envelopeMessage({
    engagementId: eng.engagement_id,
    ciphertextHashHex: ctHashHex,
    ivHex,
    saltHex,
  });

  let sigOk: boolean;
  try {
    sigOk = await verifyMessageSignature({
      address: parsed.sender as Address,
      message: canonical,
      signature: parsed.signature as Hex,
    });
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    return NextResponse.json(
      { error: "signature does not match sender" },
      { status: 400 }
    );
  }

  // Compute leaf index = proposal_count + existing_message_count for this
  // engagement (proposals occupy the first slots in the tree; messages
  // continue from there).
  const proposalCount = (db
    .prepare(`SELECT COUNT(*) AS c FROM engagement_proposals WHERE request_id = ?`)
    .get(requestId) as { c: number }).c;
  const existingMessageCount = (db
    .prepare(`SELECT COUNT(*) AS c FROM messages WHERE engagement_id = ?`)
    .get(eng.engagement_id) as { c: number }).c;
  const leafIndex = proposalCount + existingMessageCount;

  const leafBytes = await messageLeaf({
    engagement_id: eng.engagement_id,
    ciphertext_hash_hex: ctHashHex,
    iv_hex: ivHex,
    salt_hex: saltHex,
    signature: parsed.signature,
  });
  const leafHex = bytesToHex(leafBytes);

  const now = Math.floor(Date.now() / 1000);
  const inserted = db.transaction(() => {
    return db
      .prepare(
        `INSERT INTO messages
           (engagement_id, sender_address, ciphertext, iv, salt, signature,
            created_at, transcript_leaf_index, transcript_leaf_hash)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        eng.engagement_id,
        parsed.sender.toLowerCase(),
        ciphertext,
        iv,
        salt,
        parsed.signature,
        now,
        leafIndex,
        leafHex
      );
  })();

  // Recompute the running root over (proposals ++ messages) and mirror it
  // into engagement_off_chain. The on-chain anchor is updated by Group F.
  const proposals = db
    .prepare(
      `SELECT matter_id, amount_wei, note, signature, prev_proposal_id
       FROM engagement_proposals WHERE request_id = ? ORDER BY id ASC`
    )
    .all(requestId) as ProposalRow[];
  const messages = db
    .prepare(
      `SELECT id, engagement_id, sender_address, ciphertext, iv, salt, signature,
              created_at, transcript_leaf_index, transcript_leaf_hash
       FROM messages WHERE engagement_id = ? ORDER BY id ASC`
    )
    .all(eng.engagement_id) as MessageRow[];

  const propLeaves: ProposalLeafInput[] = proposals.map((p) => ({
    matter_id: p.matter_id,
    amount_wei: p.amount_wei,
    note: p.note,
    prev_proposal_id: p.prev_proposal_id,
    signature: p.signature,
  }));
  const msgLeaves: MessageLeafInput[] = await Promise.all(
    messages.map(async (m) => {
      const ctHash = await sha256(new Uint8Array(m.ciphertext));
      return {
        engagement_id: m.engagement_id,
        ciphertext_hash_hex: bytesToHex(ctHash),
        iv_hex: bufToHex(m.iv),
        salt_hex: bufToHex(m.salt),
        signature: m.signature,
      };
    })
  );
  const newRoot = bytesToHex(await transcriptRootFromAll(propLeaves, msgLeaves));
  db.prepare(
    `UPDATE engagement_off_chain SET current_transcript_root = ? WHERE engagement_id = ?`
  ).run(newRoot, eng.engagement_id);

  // Push to any subscribed SSE clients on this request so chat panels
  // refresh instantly instead of waiting for their next poll.
  emitForRequest(
    {
      kind: "message",
      request_id: requestId,
      engagement_id: eng.engagement_id,
      detail: { message_id: Number(inserted.lastInsertRowid), leaf_index: leafIndex },
    },
    { client_address: eng.client_address, lawyer_address: eng.lawyer_address }
  );

  return NextResponse.json({
    ok: true,
    message: {
      id: Number(inserted.lastInsertRowid),
      engagement_id: eng.engagement_id,
      sender_address: parsed.sender.toLowerCase(),
      transcript_leaf_index: leafIndex,
      transcript_leaf_hash: leafHex,
      created_at: now,
    },
    pending_transcript_root: newRoot,
  });
}

export async function GET(_req: Request, { params }: { params: { requestId: string } }) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }

  const db = getDb();
  const eng = getEngagementByRequest(db, requestId);
  if (!eng) {
    return NextResponse.json(
      { error: "no engagement opened for this request yet" },
      { status: 404 }
    );
  }
  const isParty =
    eng.client_address.toLowerCase() === address.toLowerCase() ||
    eng.lawyer_address.toLowerCase() === address.toLowerCase();
  if (!isParty) {
    return NextResponse.json({ error: "not a party to this engagement" }, { status: 403 });
  }

  const rows = db
    .prepare(
      `SELECT id, engagement_id, sender_address, ciphertext, iv, salt, signature,
              created_at, transcript_leaf_index, transcript_leaf_hash
       FROM messages
       WHERE engagement_id = ?
       ORDER BY transcript_leaf_index ASC, id ASC`
    )
    .all(eng.engagement_id) as MessageRow[];

  const messages = rows.map((r) => ({
    id: r.id,
    engagement_id: r.engagement_id,
    sender_address: r.sender_address,
    ciphertext_b64: r.ciphertext.toString("base64"),
    iv_b64: r.iv.toString("base64"),
    salt_b64: r.salt.toString("base64"),
    signature: r.signature,
    created_at: r.created_at,
    transcript_leaf_index: r.transcript_leaf_index,
    transcript_leaf_hash: r.transcript_leaf_hash,
  }));

  return NextResponse.json({
    engagement_id: eng.engagement_id,
    messages,
  });
}
