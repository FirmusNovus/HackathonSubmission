import { NextResponse } from "next/server";
import { keccak256, pad, stringToBytes, toHex, type Hex } from "viem";

import { bytesToHex } from "@lex-nova/crypto";
import { getDb } from "@/lib/db";
import { getSessionAddress } from "@/lib/siwe/session";
import { getAddresses } from "@/lib/chain/addresses";
import { transcriptRootFromProposals } from "@/lib/transcript";

export const runtime = "nodejs";

/**
 * Returns the calldata payload (T059) for the client to broadcast
 * `LegalEngagementEscrow.openEngagementAndFundFirstMilestone(...)`. Includes:
 *   - contract address, function name, ABI fragment (so wagmi has everything it needs)
 *   - args: [lawyer, matterRef, amount, zkConflictProof, zkNullifier, initialTranscriptRoot]
 *   - matterRef = bytes32(uint256(requestId)) so the indexer can decode it back
 *   - initialTranscriptRoot = SHA-256 Merkle root over the negotiated proposal chain
 *
 * Stub ZK proof + nullifier (`0x` and `0x00…00`) until US4 (Phase 6) lands the
 * real Noir circuit. The contract's `StubZKConflictVerifier` accepts either.
 *
 * The server **never** holds the client's private key — the response is just
 * pre-computed call data; the client signs and broadcasts via wagmi.
 */
const ESCROW_ABI = [
  {
    type: "function",
    name: "openEngagementAndFundFirstMilestone",
    stateMutability: "payable",
    inputs: [
      { name: "lawyer", type: "address" },
      { name: "matterRef", type: "bytes32" },
      { name: "amount", type: "uint256" },
      { name: "zkConflictProof", type: "bytes" },
      { name: "zkNullifier", type: "bytes32" },
      { name: "initialTranscriptRoot", type: "bytes32" },
    ],
    outputs: [{ name: "engagementId", type: "uint256" }],
  },
] as const;

interface RequestRow {
  id: number;
  matter_id: number;
  client_address: string;
  lawyer_address: string;
  status: string;
}

interface ProposalRow {
  id: number;
  matter_id: number;
  proposer_address: string;
  amount_wei: string;
  note: string | null;
  signature: string;
  prev_proposal_id: number | null;
  superseded_by: number | null;
}

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
    .prepare(`SELECT * FROM engagement_requests WHERE id = ?`)
    .get(requestId) as RequestRow | undefined;
  if (!request) {
    return NextResponse.json({ error: "request not found" }, { status: 404 });
  }
  if (request.client_address.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json(
      { error: "only the requesting client can accept and fund" },
      { status: 403 }
    );
  }
  if (request.status !== "pending") {
    return NextResponse.json(
      { error: `request is ${request.status}, cannot fund` },
      { status: 409 }
    );
  }

  // The client can only accept a proposal whose head was authored by the
  // lawyer — funding the lawyer's own counter is the hand-shake. If the
  // current head is from the client, the lawyer needs to counter or accept.
  const proposals = db
    .prepare(
      `SELECT id, matter_id, proposer_address, amount_wei, note, signature,
              prev_proposal_id, superseded_by
       FROM engagement_proposals
       WHERE request_id = ?
       ORDER BY id ASC`
    )
    .all(requestId) as ProposalRow[];
  const head = proposals.find((p) => p.superseded_by === null);
  if (!head) {
    return NextResponse.json({ error: "no proposal on file yet" }, { status: 409 });
  }
  if (head.proposer_address.toLowerCase() !== request.lawyer_address.toLowerCase()) {
    return NextResponse.json(
      { error: "current head is your own counter; the lawyer must reply first" },
      { status: 409 }
    );
  }

  const transcriptRootBytes = await transcriptRootFromProposals(proposals);
  const initialTranscriptRoot = bytesToHex(transcriptRootBytes) as Hex;

  // matterRef encoding: bytes32(uint256(requestId)). The indexer in
  // lib/chain/indexer.ts decodes this back to look up the source request.
  const matterRef = pad(toHex(BigInt(requestId)), { size: 32 }) as Hex;

  const addrs = getAddresses();

  // Stub nullifier (replaced by real Noir-derived nullifier in US4 / Phase 6).
  // The contract guards against reuse via `mapping(bytes32 => bool) usedNullifiers`,
  // so we MUST emit a unique value per engagement open even though the
  // StubZKConflictVerifier accepts any value. Hash a request-specific string
  // so the value is deterministic but distinct across engagements.
  const zkNullifier = keccak256(stringToBytes(`lex-nova/v1/stub-nullifier/${requestId}`));

  return NextResponse.json({
    contract_address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    function_name: "openEngagementAndFundFirstMilestone",
    abi: ESCROW_ABI,
    args: [
      request.lawyer_address,
      matterRef,
      head.amount_wei,
      "0x" as Hex,
      zkNullifier,
      initialTranscriptRoot,
    ],
    value_wei: head.amount_wei,
    head_proposal: {
      id: head.id,
      proposer_address: head.proposer_address,
      amount_wei: head.amount_wei,
      note: head.note,
    },
  });
}
