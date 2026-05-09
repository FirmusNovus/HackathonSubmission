// =============================================================================
// /api/dev/grant-operator — F7
// -----------------------------------------------------------------------------
// Dev-only counterpart to `/api/admin/grant-operator`. Same effect (mints a
// SCHEMA_OPERATOR capability), no admin key required. 404 in production
// unless ENABLE_MOCK_AUTH=true. Exists so Playwright can grant operator
// status to a second wallet without faking up an admin key.
// =============================================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { attestOperator, OPERATOR_ADDRESS } from "@/lib/chain/escrow";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

const Schema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  note: z.string().optional(),
});

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_MOCK_AUTH !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

export async function POST(request: Request) {
  const guarded = devGuard();
  if (guarded) return guarded;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const { uid, txHash } = await attestOperator({
      subject: parsed.data.walletAddress,
      claims: { note: parsed.data.note ?? "Operator (granted via dev API)" },
      from: OPERATOR_ADDRESS,
      expiresAt: null,
    });
    return NextResponse.json({
      capabilityUid: uid,
      txHash,
      walletAddress: parsed.data.walletAddress.toLowerCase(),
    });
  } catch (err) {
    if (isChainError(err)) {
      const { status, body: errBody } = chainErrorToHttp(err);
      return NextResponse.json({ error: errBody }, { status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
