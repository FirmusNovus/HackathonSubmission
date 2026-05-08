import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getAddresses } from "@/lib/chain/addresses";
import { ESCROW_ABI, readCurrentTranscriptRoot, type EscrowCalldata } from "@/lib/escrow";
import { resolveEngagement } from "@/lib/engagement-resolve";

export const runtime = "nodejs";

/**
 * Either party closes a clean engagement. V2: the final transcript root is
 * anchored atomically inside `closeEngagement(engId, finalRoot)` — no
 * separate `anchorTranscript` follow-up tx. The contract still enforces
 * that every milestone is in a terminal state; the platform pre-checks
 * the local mirror so the UI surfaces blockers as 409 rather than letting
 * the wallet show a raw revert.
 */
export async function POST(_req: Request, { params }: { params: { requestId: string } }) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
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

  const TERMINAL = new Set(["released", "refunded", "resolved"]);
  const milestones = db
    .prepare(
      `SELECT milestone_index, state FROM milestones
       WHERE engagement_id = ?
       ORDER BY milestone_index`
    )
    .all(r.engagement.engagement_id) as { milestone_index: number; state: string }[];
  const blockers = milestones.filter((m) => !TERMINAL.has(m.state));
  if (blockers.length > 0) {
    return NextResponse.json(
      {
        error: "cannot close: milestones in non-terminal states",
        blockers: blockers.map((b) => ({ milestone_index: b.milestone_index, state: b.state })),
      },
      { status: 409 }
    );
  }

  const addrs = getAddresses();
  const finalRoot = readCurrentTranscriptRoot(db, r.engagement.engagement_id);
  const out: EscrowCalldata = {
    contract_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    function_name: "closeEngagement",
    abi: ESCROW_ABI,
    args: [String(r.engagement.engagement_id), finalRoot],
  };
  return NextResponse.json(out);
}
