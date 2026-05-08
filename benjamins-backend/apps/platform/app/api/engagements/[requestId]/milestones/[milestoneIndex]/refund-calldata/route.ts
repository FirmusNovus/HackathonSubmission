import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getAddresses } from "@/lib/chain/addresses";
import { ESCROW_ABI, type EscrowCalldata } from "@/lib/escrow";
import { resolveEngagement } from "@/lib/engagement-resolve";

export const runtime = "nodejs";

/**
 * V2 mutual refund (replaces V1's unilateral `refundUndeliveredMilestone`).
 * The route returns calldata only when BOTH parties have submitted their
 * EIP-712 signatures via `/refund-authorization`; otherwise it 409s with
 * the still-missing signer.
 *
 * The contract verifies both sigs against the engagement's
 * client/lawyer addresses inside `mutualRefundMilestone`, so this route
 * just packs them in the args. Either party may call this endpoint to
 * obtain the calldata — which one of them broadcasts the tx is up to
 * them.
 */

interface AuthRow {
  signer_address: string;
  signature: string;
}

export async function POST(
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
      { error: `milestone is ${milestone.state}, only 'funded' can be refunded` },
      { status: 409 }
    );
  }

  const auths = db
    .prepare(
      `SELECT signer_address, signature FROM refund_authorizations
       WHERE engagement_id = ? AND milestone_index = ?`
    )
    .all(r.engagement.engagement_id, milestoneIndex) as AuthRow[];

  const clientAuth = auths.find(
    (a) => a.signer_address.toLowerCase() === r.engagement.client_address.toLowerCase()
  );
  const lawyerAuth = auths.find(
    (a) => a.signer_address.toLowerCase() === r.engagement.lawyer_address.toLowerCase()
  );

  if (!clientAuth || !lawyerAuth) {
    const missing: string[] = [];
    if (!clientAuth) missing.push("client");
    if (!lawyerAuth) missing.push("lawyer");
    return NextResponse.json(
      { error: "mutual refund requires both signatures", missing },
      { status: 409 }
    );
  }

  const addrs = getAddresses();
  const out: EscrowCalldata = {
    contract_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    function_name: "mutualRefundMilestone",
    abi: ESCROW_ABI,
    args: [
      String(r.engagement.engagement_id),
      String(milestoneIndex),
      clientAuth.signature,
      lawyerAuth.signature,
    ],
  };
  return NextResponse.json(out);
}
