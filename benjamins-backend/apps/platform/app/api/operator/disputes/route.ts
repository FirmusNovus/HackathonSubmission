import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { operatorAddress } from "@/lib/chain/clients";

export const runtime = "nodejs";

/**
 * Operator-only listing of every milestone currently in `disputed` state.
 * Constitution v2.0.0 (Session 2026-05-08) merged the arbiter role into
 * the operator address, so there is no separate arbiter pool to expose;
 * the operator resolves disputes inline from `app/(operator)/disputes/page.tsx`.
 */

interface DisputedRow {
  engagement_id: number;
  milestone_index: number;
  amount_wei: string;
  client_address: string;
  lawyer_address: string;
  request_id: number | null;
  matter_id: number;
  matter_description: string;
  matter_target_jurisdiction: string;
  matter_target_practice_area: string;
  delivered_at: number | null;
  updated_at: number;
}

export async function GET() {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  if (address.toLowerCase() !== operatorAddress().toLowerCase()) {
    return NextResponse.json({ error: "operator only" }, { status: 403 });
  }

  const db = getDb();
  const disputes = db
    .prepare(
      `SELECT m.engagement_id, m.milestone_index, m.amount_wei,
              m.delivered_at, m.updated_at,
              e.client_address, e.lawyer_address, e.request_id, e.matter_id,
              mt.description AS matter_description,
              mt.target_jurisdiction AS matter_target_jurisdiction,
              mt.target_practice_area AS matter_target_practice_area
       FROM milestones m
       JOIN engagement_off_chain e ON e.engagement_id = m.engagement_id
       JOIN matters mt ON mt.id = e.matter_id
       WHERE m.state = 'disputed'
       ORDER BY m.updated_at DESC`
    )
    .all() as DisputedRow[];

  return NextResponse.json({
    disputes: disputes.map((d) => ({
      engagement_id: d.engagement_id,
      milestone_index: d.milestone_index,
      amount_wei: d.amount_wei,
      delivered_at: d.delivered_at,
      updated_at: d.updated_at,
      // The dispute trigger isn't recorded on chain (the event has `by`
      // but we don't mirror it — `delivered_at !== null` is a proxy for
      // "lawyer-escalation path, since markDelivered must have run first
      // to start the cooldown clock"). Good enough for the operator's
      // at-a-glance view.
      trigger: d.delivered_at !== null ? "lawyer_escalation" : "client_dispute",
      engagement: {
        client_address: d.client_address,
        lawyer_address: d.lawyer_address,
        request_id: d.request_id,
        matter: {
          id: d.matter_id,
          description: d.matter_description,
          target_jurisdiction: d.matter_target_jurisdiction,
          target_practice_area: d.matter_target_practice_area,
        },
      },
    })),
    operator_address: operatorAddress(),
  });
}
