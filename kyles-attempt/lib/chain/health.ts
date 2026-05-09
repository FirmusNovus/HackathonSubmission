// =============================================================================
// Chain health probe.
// -----------------------------------------------------------------------------
// `/api/chain-health` reports the chain's reachability so the UI can disable
// wallet-sign actions when the chain is down. F1 is always healthy because
// the chain is the local SQLite mock; F4+ swaps in a real `publicClient.getBlockNumber`
// + a small timeout, returning `{ ok: false, error }` when it throws.
// =============================================================================

import { prisma } from "@/lib/db/client";

export type ChainHealth = {
  ok: boolean;
  blockNumber: number;
  mode: "mock" | "live";
};

const COUNTER_ID = "default";

export async function getChainHealth(): Promise<ChainHealth> {
  // We DO NOT increment here — health is a read. If the counter row is
  // missing (fresh DB), report block 0 and let the next mutation create it.
  const row = await prisma.mockChainCounter.findUnique({ where: { id: COUNTER_ID } });
  const blockNumber = row ? row.nextBlock - 1 : 0;
  return { ok: true, blockNumber: Math.max(0, blockNumber), mode: "mock" };
}
