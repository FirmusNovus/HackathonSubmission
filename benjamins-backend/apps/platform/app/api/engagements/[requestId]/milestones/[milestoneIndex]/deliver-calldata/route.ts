import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getAddresses } from "@/lib/chain/addresses";
import { ESCROW_ABI, type EscrowCalldata } from "@/lib/escrow";
import { resolveEngagement } from "@/lib/engagement-resolve";

export const runtime = "nodejs";

/**
 * Lawyer-only on-chain `markDelivered`. In V2 this is OPTIONAL — the happy
 * path skips it entirely because `releaseMilestone` accepts both `funded`
 * and `delivered`. Its sole purpose is to start the 30-day escalation
 * cooldown clock against an unresponsive client (FR-017 + Constitution
 * Inv 6). The user-visible "delivered" badge in chat is the off-chain
 * signed `DeliveryAttestation`, surfaced by a separate flow.
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
  if (r.role !== "lawyer") {
    return NextResponse.json(
      { error: "only the lawyer can mark a milestone delivered" },
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
  if (milestone.state !== "funded") {
    return NextResponse.json(
      { error: `milestone is ${milestone.state}, only 'funded' can be delivered` },
      { status: 409 }
    );
  }

  const addrs = getAddresses();
  const out: EscrowCalldata = {
    contract_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    function_name: "markDelivered",
    abi: ESCROW_ABI,
    args: [String(r.engagement.engagement_id), String(milestoneIndex)],
  };
  return NextResponse.json(out);
}
