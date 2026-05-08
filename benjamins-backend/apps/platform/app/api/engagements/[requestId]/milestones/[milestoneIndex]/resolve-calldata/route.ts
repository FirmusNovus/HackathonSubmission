import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getAddresses } from "@/lib/chain/addresses";
import { operatorAddress } from "@/lib/chain/clients";
import { ESCROW_ABI, type EscrowCalldata } from "@/lib/escrow";
import { resolveEngagement } from "@/lib/engagement-resolve";

export const runtime = "nodejs";

/**
 * V2 dispute resolution. Constitution v2.0.0 (Session 2026-05-08) merged
 * the arbiter role into the operator address for the v3 demo scope. The
 * server-side checks mirror the on-chain `resolveDispute` gates so the
 * wallet UX surfaces clear 4xx responses before the user has to sign a
 * tx that would revert:
 *   - caller's SIWE-bound address must equal the operator address
 *   - milestone must be in `disputed` state (not already resolved)
 *   - `amount_to_lawyer + amount_to_client` must equal `milestone.amount`
 *     to the wei (FR-019a)
 */
const Schema = z
  .object({
    amount_to_lawyer: z.string().regex(/^\d+$/, "decimal big-int wei"),
    amount_to_client: z.string().regex(/^\d+$/, "decimal big-int wei"),
  })
  .strict();

interface MilestoneRow {
  amount_wei: string;
  state: string;
}

export async function POST(
  req: NextRequest,
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

  const milestone = db
    .prepare(
      `SELECT amount_wei, state
       FROM milestones WHERE engagement_id = ? AND milestone_index = ?`
    )
    .get(r.engagement.engagement_id, milestoneIndex) as MilestoneRow | undefined;
  if (!milestone) {
    return NextResponse.json({ error: "milestone not found" }, { status: 404 });
  }
  if (milestone.state !== "disputed") {
    return NextResponse.json(
      { error: `milestone is ${milestone.state}; only 'disputed' milestones can be resolved` },
      { status: 409 }
    );
  }

  // Split must equal milestone amount to the wei.
  let toLawyer: bigint;
  let toClient: bigint;
  try {
    toLawyer = BigInt(parsed.amount_to_lawyer);
    toClient = BigInt(parsed.amount_to_client);
  } catch {
    return NextResponse.json({ error: "amounts must be decimal big-int wei" }, { status: 400 });
  }
  const amount = BigInt(milestone.amount_wei);
  if (toLawyer + toClient !== amount) {
    return NextResponse.json(
      {
        error: "split sum must equal milestone amount",
        milestone_amount_wei: milestone.amount_wei,
        sum_wei: (toLawyer + toClient).toString(),
      },
      { status: 400 }
    );
  }

  const addrs = getAddresses();
  const out: EscrowCalldata = {
    contract_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    function_name: "resolveDispute",
    abi: ESCROW_ABI,
    args: [
      String(r.engagement.engagement_id),
      String(milestoneIndex),
      parsed.amount_to_lawyer,
      parsed.amount_to_client,
    ],
  };
  return NextResponse.json(out);
}
