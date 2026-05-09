import { NextResponse } from "next/server";
import { getChainHealth } from "@/lib/chain/health";

// `GET /api/chain-health` — UI uses this before initiating wallet-sign actions
// (the contract surface is gated by capability + ZK + nonce checks; if the
// chain is unreachable, surfacing it ahead of the wallet prompt avoids an
// avoidable user-side rejection). In F1 the chain is always healthy because
// it's the in-DB mock; F4+ swaps in a real probe.
export async function GET() {
  try {
    const health = await getChainHealth();
    return NextResponse.json(health);
  } catch (err) {
    return NextResponse.json(
      { ok: false, blockNumber: 0, mode: "mock", error: err instanceof Error ? err.message : String(err) },
      { status: 503 },
    );
  }
}
