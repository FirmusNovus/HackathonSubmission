import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getAddresses } from "@/lib/chain/addresses";
import { ESCROW_ABI, readCurrentTranscriptRoot, type EscrowCalldata } from "@/lib/escrow";
import { resolveEngagement } from "@/lib/engagement-resolve";

export const runtime = "nodejs";

/**
 * V2 dispute (client-only, no cooldown — Constitution III asymmetric path).
 * Builds calldata for `disputeMilestone(engId, idx, transcriptRoot)` with
 * the latest off-chain root embedded so the contract anchors atomically.
 *
 * The lawyer's path is the sibling escalate-calldata route, which adds a
 * cooldown gate.
 */
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
  if (r.role !== "client") {
    return NextResponse.json(
      { error: "only the client can dispute a milestone (lawyer must use escalate-calldata)" },
      { status: 403 }
    );
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
  if (milestone.state !== "funded" && milestone.state !== "delivered") {
    return NextResponse.json(
      { error: `milestone is ${milestone.state}; only 'funded' or 'delivered' can be disputed` },
      { status: 409 }
    );
  }

  const addrs = getAddresses();
  const transcriptRoot = readCurrentTranscriptRoot(db, r.engagement.engagement_id);
  const out: EscrowCalldata = {
    contract_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    function_name: "disputeMilestone",
    abi: ESCROW_ABI,
    args: [String(r.engagement.engagement_id), String(milestoneIndex), transcriptRoot],
  };
  return NextResponse.json(out);
}
