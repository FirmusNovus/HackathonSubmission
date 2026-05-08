import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { emitForRequest } from "@/lib/messaging/event-bus";

export const runtime = "nodejs";

interface RequestRow {
  id: number;
  client_address: string;
  lawyer_address: string;
  status: string;
}

/**
 * Either party may decline a pending engagement request. No payload — the
 * SIWE-bound address authorises the action. The matter stays open so the
 * client can re-pitch it to a different lawyer.
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
  const request = db
    .prepare(`SELECT id, client_address, lawyer_address, status FROM engagement_requests WHERE id = ?`)
    .get(requestId) as RequestRow | undefined;
  if (!request) {
    return NextResponse.json({ error: "request not found" }, { status: 404 });
  }
  const isLawyer = request.lawyer_address.toLowerCase() === address.toLowerCase();
  const isClient = request.client_address.toLowerCase() === address.toLowerCase();
  if (!isLawyer && !isClient) {
    return NextResponse.json({ error: "not a party to this request" }, { status: 403 });
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `request is ${request.status}, cannot decline` },
      { status: 409 }
    );
  }

  // Lawyer-initiated → 'declined'; client-initiated → 'withdrawn'. Both states
  // are terminal; the matter stays open for re-pitching either way.
  const newStatus = isLawyer ? "declined" : "withdrawn";
  db.prepare(`UPDATE engagement_requests SET status = ? WHERE id = ?`).run(newStatus, requestId);

  // Notify engagement page + both parties' inbox/matters pages.
  emitForRequest(
    {
      kind: "proposal",
      request_id: requestId,
      engagement_id: null,
      detail: { decision: newStatus },
    },
    { client_address: request.client_address, lawyer_address: request.lawyer_address }
  );

  return NextResponse.json({ ok: true, status: newStatus });
}
