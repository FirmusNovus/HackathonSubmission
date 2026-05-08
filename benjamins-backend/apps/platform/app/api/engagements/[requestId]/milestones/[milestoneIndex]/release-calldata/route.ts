import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getAddresses } from "@/lib/chain/addresses";
import { ESCROW_ABI, type EscrowCalldata } from "@/lib/escrow";
import { resolveEngagement } from "@/lib/engagement-resolve";

export const runtime = "nodejs";

/**
 * Client releases a Funded or Delivered milestone, transferring the parked
 * amount to the lawyer's wallet. V2: the "delivered" gate is gone — the
 * client may release as soon as they're satisfied, even if the lawyer has
 * never called `markDelivered`. This is the action that eliminates the
 * lawyer's mandatory tx in the happy path.
 *
 * V2 also drops the anchor follow-up — release does not advance the
 * on-chain transcript root (FR-025). Only close / dispute / escalate do.
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
      { error: "only the client can release a milestone" },
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
      { error: `milestone is ${milestone.state}; only 'funded' or 'delivered' can be released` },
      { status: 409 }
    );
  }

  const addrs = getAddresses();
  const out: EscrowCalldata = {
    contract_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    function_name: "releaseMilestone",
    abi: ESCROW_ABI,
    args: [String(r.engagement.engagement_id), String(milestoneIndex)],
  };
  return NextResponse.json(out);
}
