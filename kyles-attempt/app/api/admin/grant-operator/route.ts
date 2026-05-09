// =============================================================================
// /api/admin/grant-operator — F7
// -----------------------------------------------------------------------------
// Admin-only manual mint of a SCHEMA_OPERATOR capability for an arbitrary
// wallet. Mirrors the pattern of `/api/admin/verify-lawyer` (F2): protected by
// the ADMIN_API_KEY env var, body { walletAddress, note? }, calls
// `attestOperator` on the chain layer (which itself only allows the configured
// operator wallet to attest, so this is effectively the seeded operator
// granting operator status to a second wallet — the chain self-attest path).
//
// Production parity: the on-chain `AttestationManager` constructor pins the
// operator address, so adding a SECOND operator is a contract upgrade. The
// off-chain helper here exists for the demo + testing where multiple wallets
// may need operator capability without a re-seed.
// =============================================================================

import { NextResponse } from "next/server";
import { z } from "zod";
import { attestOperator, OPERATOR_ADDRESS } from "@/lib/chain/escrow";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

const Schema = z.object({
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  note: z.string().optional(),
});

export async function POST(request: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return NextResponse.json({ error: "Admin key not configured" }, { status: 500 });
  const got = request.headers.get("x-admin-key");
  if (got !== expected) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
      claims: { note: parsed.data.note ?? "Operator (granted via admin key)" },
      from: OPERATOR_ADDRESS,
      expiresAt: null,
    });
    return NextResponse.json({ capabilityUid: uid, txHash, walletAddress: parsed.data.walletAddress.toLowerCase() });
  } catch (err) {
    if (isChainError(err)) {
      const { status, body: errBody } = chainErrorToHttp(err);
      return NextResponse.json({ error: errBody }, { status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
