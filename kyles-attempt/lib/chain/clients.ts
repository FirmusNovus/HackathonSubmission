// =============================================================================
// Mock chain singleton.
// -----------------------------------------------------------------------------
// In production this file owns the viem `publicClient` + `walletClient` pair.
// For F1 it owns the in-DB mock: a Prisma-backed object that hands out tx
// hashes and monotonic block numbers, and that wraps the typed-error contract
// surface from `lib/chain/escrow.ts`.
// =============================================================================

import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getDeployedAddresses } from "@/lib/chain/addresses";

const COUNTER_ID = "default";

/**
 * Generate a fake (but well-formed) tx hash. Production replaces this with
 * the real receipt hash returned by `walletClient.writeContract`. Calls inside
 * the chain layer use this; callers do NOT — they always read tx hashes off
 * the returned ChainEvent / mutation result.
 */
export function generateTxHash(): `0x${string}` {
  const chars = "0123456789abcdef";
  let out = "0x";
  for (let i = 0; i < 64; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out as `0x${string}`;
}

/**
 * Generate a fake EAS attestation UID. Real EAS UIDs are bytes32, derived from
 * `keccak256(schema || recipient || attester || time || ...)`. We fake a hex
 * string of the right shape; the platform doesn't depend on collision
 * resistance of the mock (the unique constraint on `Capability.attestationUid`
 * is enforced by the DB).
 */
export function generateAttestationUid(): `0x${string}` {
  return generateTxHash();
}

/**
 * Atomically increment + return the next mock block number. Callers MUST run
 * this inside their containing transaction so a concurrent mutation can't
 * return the same block to two callers — Prisma's `update` against the
 * singleton row serialises on the row lock.
 */
export async function nextMockBlock(tx: Prisma.TransactionClient): Promise<number> {
  // Upsert handles first-run cleanly; subsequent calls just increment.
  const row = await tx.mockChainCounter.upsert({
    where: { id: COUNTER_ID },
    update: { nextBlock: { increment: 1 } },
    create: { id: COUNTER_ID, nextBlock: 2, nextEngagement: 1 },
  });
  // We incremented to nextBlock; the *current* block is nextBlock - 1.
  return row.nextBlock - 1;
}

/**
 * Atomically increment + return the next engagementId. Mirrors the contract's
 * `++nextEngagementId` (1-indexed).
 */
export async function nextMockEngagementId(tx: Prisma.TransactionClient): Promise<number> {
  const row = await tx.mockChainCounter.upsert({
    where: { id: COUNTER_ID },
    update: { nextEngagement: { increment: 1 } },
    create: { id: COUNTER_ID, nextBlock: 1, nextEngagement: 2 },
  });
  return row.nextEngagement - 1;
}

/**
 * The mock chain singleton. Today this is a thin wrapper around Prisma; once
 * we wire viem in F4+, this becomes `{ publicClient, walletClient, prisma }`
 * and the escrow surface migrates from "write to Prisma directly" to "write
 * via writeContract, then sync via indexer".
 */
export const mockChain = {
  prisma: prisma as PrismaClient,
  addresses: getDeployedAddresses(),
  mode: "mock" as const,
};

export type MockChain = typeof mockChain;
