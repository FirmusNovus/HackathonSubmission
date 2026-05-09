import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getAddresses } from "@/lib/chain/addresses";
import { ESCROW_ABI, readCurrentTranscriptRoot, type EscrowCalldata } from "@/lib/escrow";
import { resolveEngagement } from "@/lib/engagement-resolve";

export const runtime = "nodejs";

/**
 * V2 lawyer-side dispute escalation. Constitution Inv 6 requires the
 * cooldown to be contract-enforced — the contract reverts unconditionally
 * with `CooldownNotElapsed(unlockAt)` if `block.timestamp <
 * deliveredAt + 30 days`. We pre-check the same condition server-side so
 * the UI surfaces a 409 with the unlock timestamp instead of letting the
 * wallet show a raw revert (FR-017's "clear message including the time
 * at which escalation becomes possible").
 */
const LAWYER_DISPUTE_COOLDOWN_SECONDS = 30 * 24 * 60 * 60;

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
      { error: "only the lawyer can escalate (client uses dispute-calldata directly)" },
      { status: 403 }
    );
  }
  if (r.engagement.state !== "active") {
    return NextResponse.json({ error: "engagement is closed" }, { status: 409 });
  }

  const milestone = db
    .prepare(
      `SELECT state, delivered_at FROM milestones WHERE engagement_id = ? AND milestone_index = ?`
    )
    .get(r.engagement.engagement_id, milestoneIndex) as
    | { state: string; delivered_at: number | null }
    | undefined;
  if (!milestone) {
    return NextResponse.json({ error: "milestone not found" }, { status: 404 });
  }
  if (milestone.state !== "delivered") {
    return NextResponse.json(
      {
        error: `milestone is ${milestone.state}; only 'delivered' can be escalated`,
        hint:
          milestone.state === "funded"
            ? "call markDelivered first to start the cooldown clock"
            : undefined,
      },
      { status: 409 }
    );
  }
  if (milestone.delivered_at === null) {
    // Should be impossible if state === 'delivered', but guard anyway.
    return NextResponse.json(
      { error: "milestone is delivered but has no delivered_at — indexer is out of sync" },
      { status: 500 }
    );
  }
  const unlockAt = milestone.delivered_at + LAWYER_DISPUTE_COOLDOWN_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  if (now < unlockAt) {
    return NextResponse.json(
      {
        error: "escalation cooldown has not elapsed yet",
        unlock_at: unlockAt,
        seconds_remaining: unlockAt - now,
      },
      { status: 409 }
    );
  }

  const addrs = getAddresses();
  const transcriptRoot = readCurrentTranscriptRoot(db, r.engagement.engagement_id);
  const out: EscrowCalldata = {
    contract_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    function_name: "escalateMilestone",
    abi: ESCROW_ABI,
    args: [String(r.engagement.engagement_id), String(milestoneIndex), transcriptRoot],
  };
  return NextResponse.json(out);
}
