import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isHex, type Address, type Hex } from "viem";

import { mutualRefundDomain, recoverMutualRefundSigner } from "@lex-nova/crypto";
import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { resolveEngagement } from "@/lib/engagement-resolve";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import { emitForRequest } from "@/lib/messaging/event-bus";

export const runtime = "nodejs";

/**
 * V2 mutual refund: each party POSTs their EIP-712 signature here. Once
 * both rows exist, `/refund-calldata` returns the calldata payload for
 * `mutualRefundMilestone`. The contract verifies both sigs against the
 * engagement's client/lawyer addresses; the platform layer is the
 * gathering point, not the trust anchor.
 */
const Schema = z
  .object({
    signature: z.string().refine(isHex, "expected 0x-hex signature"),
  })
  .strict();

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

  let parsed: z.infer<typeof Schema>;
  try {
    parsed = Schema.parse(await req.json());
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
  if (r.engagement.state !== "active") {
    return NextResponse.json({ error: "engagement is closed" }, { status: 409 });
  }

  const milestone = db
    .prepare(`SELECT state FROM milestones WHERE engagement_id = ? AND milestone_index = ?`)
    .get(r.engagement.engagement_id, milestoneIndex) as { state: string } | undefined;
  if (!milestone) {
    return NextResponse.json({ error: "milestone not found" }, { status: 404 });
  }
  if (milestone.state !== "funded") {
    return NextResponse.json(
      { error: `milestone is ${milestone.state}; only 'funded' can be mutually refunded` },
      { status: 409 }
    );
  }

  // Verify the EIP-712 sig against the contract's domain. The recovered
  // signer must equal the SIWE-bound caller — anti-spoof.
  const addrs = getAddresses();
  const domain = mutualRefundDomain({
    chainId: getChainId(),
    verifyingContract: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
  });
  let recovered: Address;
  try {
    recovered = await recoverMutualRefundSigner({
      domain,
      message: {
        engagementId: BigInt(r.engagement.engagement_id),
        milestoneIndex: BigInt(milestoneIndex),
      },
      signature: parsed.signature as Hex,
    });
  } catch {
    return NextResponse.json({ error: "signature is malformed" }, { status: 400 });
  }
  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json(
      { error: "signature does not match SIWE-bound address" },
      { status: 403 }
    );
  }

  // Upsert this party's authorization. UNIQUE(engagement_id, milestone_index,
  // signer_address) collapses replays into a single row.
  const now = Math.floor(Date.now() / 1000);
  db.prepare(
    `INSERT INTO refund_authorizations
       (engagement_id, milestone_index, signer_address, signature, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(engagement_id, milestone_index, signer_address)
     DO UPDATE SET signature = excluded.signature, created_at = excluded.created_at`
  ).run(r.engagement.engagement_id, milestoneIndex, recovered.toLowerCase(), parsed.signature, now);

  // Compute readiness for the UI: do we have BOTH parties' sigs?
  const auths = db
    .prepare(
      `SELECT signer_address FROM refund_authorizations
       WHERE engagement_id = ? AND milestone_index = ?`
    )
    .all(r.engagement.engagement_id, milestoneIndex) as { signer_address: string }[];
  const hasClient = auths.some(
    (a) => a.signer_address === r.engagement.client_address.toLowerCase()
  );
  const hasLawyer = auths.some(
    (a) => a.signer_address === r.engagement.lawyer_address.toLowerCase()
  );
  const ready = hasClient && hasLawyer;

  emitForRequest(
    {
      kind: "milestone",
      request_id: requestId,
      engagement_id: r.engagement.engagement_id,
      detail: { milestone_index: milestoneIndex, kind: "refund_auth", ready },
    },
    { client_address: r.engagement.client_address, lawyer_address: r.engagement.lawyer_address }
  );

  return NextResponse.json({ ok: true, has_client_sig: hasClient, has_lawyer_sig: hasLawyer, ready });
}

export async function GET(
  _req: Request,
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

  const db = getDb();
  const r = resolveEngagement(db, requestId, address);
  if (!r) {
    return NextResponse.json({ error: "engagement not opened yet" }, { status: 404 });
  }
  if (r.role === "none") {
    return NextResponse.json({ error: "not a party to this engagement" }, { status: 403 });
  }

  const auths = db
    .prepare(
      `SELECT signer_address, created_at FROM refund_authorizations
       WHERE engagement_id = ? AND milestone_index = ?`
    )
    .all(r.engagement.engagement_id, milestoneIndex) as
    | { signer_address: string; created_at: number }[];
  const hasClient = auths.some(
    (a) => a.signer_address === r.engagement.client_address.toLowerCase()
  );
  const hasLawyer = auths.some(
    (a) => a.signer_address === r.engagement.lawyer_address.toLowerCase()
  );

  return NextResponse.json({
    has_client_sig: hasClient,
    has_lawyer_sig: hasLawyer,
    ready: hasClient && hasLawyer,
    auths,
  });
}
