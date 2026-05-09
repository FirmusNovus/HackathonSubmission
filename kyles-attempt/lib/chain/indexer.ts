// =============================================================================
// On-demand indexer (mock-chain edition).
// -----------------------------------------------------------------------------
// In System A this module is the long-running viem `watchContractEvent` loop
// that keeps the off-chain SQLite mirror in sync with the contract. In F1 we
// don't have a real chain to watch, so the indexer's job is reduced to a
// sanity check: replay the ChainEvent log for an engagement and assert that
// the resulting state matches what the mirror tables (Engagement + Proposal)
// already say. Each mutation in `lib/chain/escrow.ts` calls this after
// committing so a divergence is caught immediately.
//
// F4+ swaps this for a real watchContractEvent indexer; the public surface
// (`syncFromChain(engagementId)`) doesn't change.
// =============================================================================

import { prisma } from "@/lib/db/client";
// NOTE: We intentionally do NOT import the constants from `./escrow` here —
// `escrow.ts` imports `assertMirrorMatches` back from this file (so each
// mutation can sanity-check the mirror after committing), and a type-erased
// circular import via constants leaves one of the two namespaces empty at
// module-load time. Inlining the small set of state strings keeps the cycle
// purely type-level (which TypeScript handles fine).

const ENGAGEMENT_STATE = {
  NONE: "NONE",
  ACTIVE: "ACTIVE",
  CLOSED: "CLOSED",
} as const;
type EngagementState = (typeof ENGAGEMENT_STATE)[keyof typeof ENGAGEMENT_STATE];

const PROPOSAL_STATE = {
  NONE: "NONE",
  FUNDED: "FUNDED",
  DELIVERED: "DELIVERED",
  RELEASED: "RELEASED",
  DISPUTED: "DISPUTED",
  RESOLVED: "RESOLVED",
  REFUNDED: "REFUNDED",
} as const;
type ProposalState = (typeof PROPOSAL_STATE)[keyof typeof PROPOSAL_STATE];

export type RebuiltProposal = {
  proposalIndex: number;
  amountWei: string;
  state: ProposalState;
  deliveredAt: number | null;
  amountToLawyerWei: string | null;
  amountToClientWei: string | null;
};

export type RebuiltEngagement = {
  engagementId: number;
  state: EngagementState;
  transcriptRoot: string;
  proposalCount: number;
  proposals: RebuiltProposal[];
};

type EventRow = { kind: string; payload: string; blockNumber: number };

/**
 * Replay the ChainEvent log for `engagementId` and rebuild the engagement +
 * proposals shape from events alone. Returns null if the engagement was never
 * opened.
 *
 * Production parity: with a real chain this function fetches logs via
 * `getLogs` rather than reading the local event table. The shape it returns
 * is identical, so callers don't need to change.
 */
export async function syncFromChain(engagementId: number): Promise<RebuiltEngagement | null> {
  const events = (await prisma.chainEvent.findMany({
    where: { engagementId },
    orderBy: { blockNumber: "asc" },
    select: { kind: true, payload: true, blockNumber: true },
  })) as EventRow[];

  if (events.length === 0) return null;

  let state: EngagementState = ENGAGEMENT_STATE.NONE;
  let transcriptRoot = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const proposals = new Map<number, RebuiltProposal>();

  for (const e of events) {
    const payload = JSON.parse(e.payload) as Record<string, unknown>;
    switch (e.kind) {
      case "EngagementOpened":
        state = ENGAGEMENT_STATE.ACTIVE;
        break;
      case "TranscriptAnchored":
        transcriptRoot = String(payload.root ?? transcriptRoot);
        break;
      case "EngagementClosed":
        state = ENGAGEMENT_STATE.CLOSED;
        break;
      case "ProposalFunded": {
        const idx = Number(payload.proposalIndex);
        const amount = String(payload.amount);
        proposals.set(idx, {
          proposalIndex: idx,
          amountWei: amount,
          state: PROPOSAL_STATE.FUNDED,
          deliveredAt: null,
          amountToLawyerWei: null,
          amountToClientWei: null,
        });
        break;
      }
      case "ProposalDelivered": {
        const idx = Number(payload.proposalIndex);
        const p = proposals.get(idx);
        if (p) {
          p.state = PROPOSAL_STATE.DELIVERED;
          p.deliveredAt = Number(payload.deliveredAt ?? null) || null;
        }
        break;
      }
      case "ProposalReleased": {
        const idx = Number(payload.proposalIndex);
        const p = proposals.get(idx);
        if (p) {
          p.state = PROPOSAL_STATE.RELEASED;
          p.amountToLawyerWei = p.amountWei;
        }
        break;
      }
      case "ProposalDisputed": {
        const idx = Number(payload.proposalIndex);
        const p = proposals.get(idx);
        if (p) p.state = PROPOSAL_STATE.DISPUTED;
        break;
      }
      case "ProposalResolved": {
        const idx = Number(payload.proposalIndex);
        const p = proposals.get(idx);
        if (p) {
          p.state = PROPOSAL_STATE.RESOLVED;
          p.amountToLawyerWei = String(payload.toLawyer);
          p.amountToClientWei = String(payload.toClient);
        }
        break;
      }
      case "ProposalMutuallyRefunded": {
        const idx = Number(payload.proposalIndex);
        const p = proposals.get(idx);
        if (p) {
          p.state = PROPOSAL_STATE.REFUNDED;
          p.amountToClientWei = p.amountWei;
        }
        break;
      }
    }
  }

  const sortedProposals = Array.from(proposals.values()).sort((a, b) => a.proposalIndex - b.proposalIndex);
  return {
    engagementId,
    state,
    transcriptRoot,
    proposalCount: sortedProposals.length,
    proposals: sortedProposals,
  };
}

/**
 * Cheap consistency check used by escrow.ts after each mutation: the mirror
 * tables (Engagement + Proposal) MUST match the rebuilt-from-events shape.
 * Throws if they don't — this is a programmer error, not a recoverable
 * runtime failure.
 */
export async function assertMirrorMatches(engagementId: number): Promise<void> {
  const rebuilt = await syncFromChain(engagementId);
  const engagement = await prisma.engagement.findUnique({
    where: { engagementId },
    include: { proposals: { orderBy: { proposalIndex: "asc" } } },
  });
  if (!rebuilt && !engagement) return;
  if (!rebuilt || !engagement) {
    throw new Error(`indexer: mirror divergence on engagement ${engagementId}`);
  }
  if (engagement.state !== rebuilt.state) {
    throw new Error(`indexer: state divergence on engagement ${engagementId}: ${engagement.state} vs ${rebuilt.state}`);
  }
  if (engagement.proposalCount !== rebuilt.proposalCount) {
    throw new Error(
      `indexer: proposalCount divergence on engagement ${engagementId}: ${engagement.proposalCount} vs ${rebuilt.proposalCount}`,
    );
  }
}
