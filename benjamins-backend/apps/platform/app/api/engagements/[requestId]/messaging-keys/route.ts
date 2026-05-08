import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import {
  getEngagementByRequest,
  listMessagingKeys,
} from "@/lib/messaging/engagement-keys";

export const runtime = "nodejs";

/**
 * Returns the currently-published messaging keys for both parties of an
 * engagement (or whichever ones have published so far). Only the parties
 * themselves can read this — the disclosure surface is small but lawyers'
 * keys correlate with their wallets, which we keep gated.
 */
export async function GET(_req: Request, { params }: { params: { requestId: string } }) {
  const address = getSessionAddress();
  if (!address) {
    return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  }
  const requestId = Number(params.requestId);
  if (!Number.isInteger(requestId) || requestId <= 0) {
    return NextResponse.json({ error: "invalid request id" }, { status: 400 });
  }

  const eng = getEngagementByRequest(getDb(), requestId);
  if (!eng) {
    return NextResponse.json(
      { error: "no engagement opened for this request yet" },
      { status: 404 }
    );
  }
  const isParty =
    eng.client_address.toLowerCase() === address.toLowerCase() ||
    eng.lawyer_address.toLowerCase() === address.toLowerCase();
  if (!isParty) {
    return NextResponse.json({ error: "not a party to this engagement" }, { status: 403 });
  }

  const rows = listMessagingKeys(eng.engagement_id);
  return NextResponse.json({
    engagement_id: eng.engagement_id,
    keys: rows.map((r) => ({
      party_address: r.party_address,
      public_key_jwk: JSON.parse(r.public_key_jwk),
      created_at: r.created_at,
    })),
  });
}
