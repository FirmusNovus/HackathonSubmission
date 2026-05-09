/**
 * On-chain event indexer.
 *
 * Listens for events from AttestationManager and LegalEngagementEscrow and
 * keeps SQLite mirrors (verified_users, engagement_off_chain, milestones) in
 * sync. The mirrors are *cache* — the chain is always canonical. The indexer
 * is run once at process boot from `instrumentation.ts`.
 *
 * Phase 2 wires the Attested/Revoked path. Phase 4 (US1) extended it to
 * EngagementOpened + TranscriptAnchored + EngagementClosed (Group D2) plus
 * MilestoneProposed/Funded/Delivered/Released/Refunded (Group F).
 */
import { parseAbi, type Address, type Log } from "viem";

import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { getDb } from "@/lib/db";
import { emitForEngagement, emitForRequest } from "@/lib/messaging/event-bus";

let _started = false;

// All AttestationManager events in one ABI fragment + all
// LegalEngagementEscrow events in another. Subscribing once per contract
// (instead of once per event) means viem delivers every block's events
// in a single onLogs batch in their natural emission order. Critical for
// the engagement-open flow which fires EngagementOpened + MilestoneProposed
// + MilestoneFunded + TranscriptAnchored from the same tx — separate
// subscriptions raced and the milestone amount would sometimes never land.
const ATTESTATION_MANAGER_EVENTS_ABI = parseAbi([
  "event Attested(address indexed subject, bytes32 indexed schemaId, bytes32 attestationUid)",
  "event Revoked(address indexed subject, bytes32 indexed schemaId)",
]);

// V2 escrow events. Notable changes from V1:
//   - MilestoneProposed is gone (no on-chain proposal step in V2)
//   - MilestoneFunded carries the amount inline (kills the V1 indexer race)
//   - MilestoneRefunded → MilestoneMutuallyRefunded (mutual sigs path)
//   - MilestoneDisputed / MilestoneResolved for the V2 dispute lifecycle
//   - 2026-05-08 simplification: ArbiterAssigned event no longer exists —
//     the operator address resolves disputes directly per Constitution
//     v2.0.0 (operator-as-arbiter). The engagement parties' dispute /
//     escalate APIs are unchanged.
const ESCROW_EVENTS_ABI = parseAbi([
  "event EngagementOpened(uint256 indexed engagementId, address indexed client, address indexed lawyer, bytes32 matterRef)",
  "event TranscriptAnchored(uint256 indexed engagementId, bytes32 root, uint256 blockNumber)",
  "event EngagementClosed(uint256 indexed engagementId)",
  "event MilestoneFunded(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 amount)",
  "event MilestoneDelivered(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint64 deliveredAt)",
  "event MilestoneReleased(uint256 indexed engagementId, uint256 indexed milestoneIndex)",
  "event MilestoneMutuallyRefunded(uint256 indexed engagementId, uint256 indexed milestoneIndex)",
  "event MilestoneDisputed(uint256 indexed engagementId, uint256 indexed milestoneIndex, address by)",
  "event MilestoneResolved(uint256 indexed engagementId, uint256 indexed milestoneIndex, uint256 toLawyer, uint256 toClient)",
]);

export function startIndexer(): void {
  if (_started) return;
  _started = true;

  const addrs = getAddresses();
  if (addrs.ATTESTATION_MANAGER_ADDRESS === "0x0000000000000000000000000000000000000000") {
    console.warn("[indexer] deployed-addresses.json absent or unfilled; skipping");
    _started = false;
    return;
  }

  console.log("[indexer] starting…");

  // One watcher per contract, dispatching by event name. Single polling
  // cycle = no inter-event race. Order within a block is preserved by
  // viem's onLogs batch.
  publicClient.watchContractEvent({
    address: addrs.ATTESTATION_MANAGER_ADDRESS,
    abi: ATTESTATION_MANAGER_EVENTS_ABI,
    onLogs: (logs) => {
      for (const log of logs as Array<Log & { eventName?: string }>) {
        switch (log.eventName) {
          case "Attested":
            handleAttested(log);
            break;
          case "Revoked":
            handleRevoked(log);
            break;
        }
      }
    },
  });

  publicClient.watchContractEvent({
    address: addrs.LEGAL_ENGAGEMENT_ESCROW_ADDRESS,
    abi: ESCROW_EVENTS_ABI,
    onLogs: (logs) => {
      for (const log of logs as Array<Log & { eventName?: string }>) {
        switch (log.eventName) {
          case "EngagementOpened":
            handleEngagementOpened(log);
            break;
          case "TranscriptAnchored":
            handleTranscriptAnchored(log);
            break;
          case "EngagementClosed":
            handleEngagementClosed(log);
            break;
          case "MilestoneFunded":
            handleMilestoneFunded(log);
            break;
          case "MilestoneDelivered":
            handleMilestoneDelivered(log);
            break;
          case "MilestoneReleased":
            handleMilestoneReleased(log);
            break;
          case "MilestoneMutuallyRefunded":
            handleMilestoneRefunded(log);
            break;
          case "MilestoneDisputed":
            handleMilestoneDisputed(log);
            break;
          case "MilestoneResolved":
            handleMilestoneResolved(log);
            break;
        }
      }
    },
  });
}

function schemaToRole(schemaId: string): "lawyer" | "client" | "arbiter" | null {
  const a = getAddresses();
  if (schemaId === a.SCHEMA_LAWYER) return "lawyer";
  if (schemaId === a.SCHEMA_CLIENT) return "client";
  if (schemaId === a.SCHEMA_ARBITER) return "arbiter";
  return null;
}

function handleAttested(log: Log) {
  const args = (log as any).args as { subject: Address; schemaId: `0x${string}`; attestationUid: `0x${string}` };
  const role = schemaToRole(args.schemaId);
  if (!role) return;
  const db = getDb();
  // Case-insensitive on the address — viem checksum-cases what the chain
  // emits, but that may differ from a row inserted via a manual seed/test
  // path. Stay consistent with the rest of the codebase's `lower(...)`
  // comparisons so updates always hit the right row.
  const existing = db
    .prepare(
      "SELECT 1 FROM verified_users WHERE lower(eth_address) = lower(?) AND attested_role = ?"
    )
    .get(args.subject, role);
  if (existing) {
    db.prepare(
      `UPDATE verified_users SET attestation_uid = ?, attested_at = ?
       WHERE lower(eth_address) = lower(?) AND attested_role = ?`
    ).run(args.attestationUid, Math.floor(Date.now() / 1000), args.subject, role);
  } else {
    db.prepare(
      `INSERT INTO verified_users (eth_address, attested_role, attested_at, attestation_uid, disclosed_attrs)
       VALUES (?, ?, ?, ?, ?)`
    ).run(args.subject, role, Math.floor(Date.now() / 1000), args.attestationUid, "{}");
  }
  console.log(`[indexer] Attested ${role} -> ${args.subject}`);
}

function handleRevoked(log: Log) {
  const args = (log as any).args as { subject: Address; schemaId: `0x${string}` };
  const role = schemaToRole(args.schemaId);
  if (!role) return;
  getDb()
    .prepare(
      "DELETE FROM verified_users WHERE lower(eth_address) = lower(?) AND attested_role = ?"
    )
    .run(args.subject, role);
  console.log(`[indexer] Revoked ${role} <- ${args.subject}`);
}

function handleEngagementOpened(log: Log) {
  const args = (log as any).args as {
    engagementId: bigint;
    client: Address;
    lawyer: Address;
    matterRef: `0x${string}`;
  };
  const db = getDb();

  // matterRef is `bytes32(uint256(requestId))` per the fund-calldata route.
  // Decode it back to find the originating engagement_request row so we can
  // mark it accepted and look up the matter_id without the brittle hex-pad
  // matching the previous version used.
  let requestId: number | null = null;
  try {
    const asBig = BigInt(args.matterRef);
    if (asBig > 0n && asBig <= BigInt(Number.MAX_SAFE_INTEGER)) {
      requestId = Number(asBig);
    }
  } catch {
    requestId = null;
  }

  let matterId = 0;
  if (requestId !== null) {
    const requestRow = db
      .prepare(`SELECT matter_id FROM engagement_requests WHERE id = ?`)
      .get(requestId) as { matter_id: number } | undefined;
    if (requestRow) {
      matterId = requestRow.matter_id;
      // Off-chain side-effects (T060): the request transitions to terminal
      // 'accepted' state and the matter to 'engaged'. The proposal chain is
      // already frozen — the propose/counter routes refuse to mutate a
      // request whose status isn't 'pending'.
      db.prepare(`UPDATE engagement_requests SET status = 'accepted' WHERE id = ?`).run(requestId);
      db.prepare(`UPDATE matters SET status = 'engaged' WHERE id = ?`).run(matterId);
    }
  }

  db.prepare(
    `INSERT OR REPLACE INTO engagement_off_chain
     (engagement_id, matter_id, client_address, lawyer_address, current_transcript_root, last_anchor_block, state, request_id)
     VALUES (?, ?, ?, ?, ?, ?, 'active', ?)`
  ).run(
    Number(args.engagementId),
    matterId,
    args.client,
    args.lawyer,
    "0x",
    Number(log.blockNumber ?? 0n),
    requestId
  );
  // Notify any open SSE subscribers so the client/lawyer pages flip out
  // of the "Accept & fund" / "Engagement pending" state instantly. This
  // is the load-bearing event for the whole funding-then-reload UX —
  // without it, the page would have to poll for the indexer to catch up.
  if (requestId !== null) {
    // Pass parties so the wallet channels fan out — without them the
    // lawyer's inbox (and client's /matters list) wouldn't refresh on
    // the funding event since they don't subscribe per-request.
    emitForRequest(
      {
        kind: "engagement",
        request_id: requestId,
        engagement_id: Number(args.engagementId),
        detail: { state: "active" },
      },
      { client_address: args.client, lawyer_address: args.lawyer }
    );
  }
  console.log(
    `[indexer] EngagementOpened #${args.engagementId} client=${args.client} lawyer=${args.lawyer} request=${requestId ?? "?"}`
  );
}

function handleTranscriptAnchored(log: Log) {
  const args = (log as any).args as { engagementId: bigint; root: `0x${string}`; blockNumber: bigint };
  // V2 emits TranscriptAnchored from openEngagementAndFundFirstMilestone,
  // disputeMilestone, escalateMilestone, closeEngagement, and the
  // standalone anchorTranscript. After every such event the local
  // `current_transcript_root` mirror catches up to whatever the contract
  // committed. `last_anchored_root` is preserved for completeness but no
  // longer drives any "should we anchor again?" logic — V2 has no
  // follow-up anchor tx.
  getDb()
    .prepare(
      `UPDATE engagement_off_chain
       SET current_transcript_root = ?,
           last_anchored_root = ?,
           last_anchor_block = ?
       WHERE engagement_id = ?`
    )
    .run(args.root, args.root, Number(args.blockNumber), Number(args.engagementId));
}

function handleEngagementClosed(log: Log) {
  const args = (log as any).args as { engagementId: bigint };
  const engagementId = Number(args.engagementId);
  const db = getDb();
  db.prepare(`UPDATE engagement_off_chain SET state = 'closed' WHERE engagement_id = ?`).run(engagementId);
  emitForEngagement(db, engagementId, { kind: "engagement", detail: { state: "closed" } });
  console.log(`[indexer] EngagementClosed #${engagementId}`);
}

function upsertMilestone(
  engagementId: number,
  milestoneIndex: number,
  patch: {
    amount_wei?: string;
    state?: string;
    delivered_at?: number | null;
  }
): void {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);
  const existing = db
    .prepare(
      `SELECT amount_wei, state, delivered_at FROM milestones
       WHERE engagement_id = ? AND milestone_index = ?`
    )
    .get(engagementId, milestoneIndex) as
    | {
        amount_wei: string;
        state: string;
        delivered_at: number | null;
      }
    | undefined;

  const nextAmount =
    patch.amount_wei !== undefined && patch.amount_wei !== "0"
      ? patch.amount_wei
      : existing?.amount_wei ?? "0";
  const nextState = patch.state ?? existing?.state ?? "funded";
  const nextDelivered =
    patch.delivered_at !== undefined ? patch.delivered_at : existing?.delivered_at ?? null;

  // The `assigned_arbiter` column from migration 007 is vestigial post
  // Constitution v2.0.0 (operator-as-arbiter); we no longer write to it.
  // Existing rows keep whatever value they had; new rows default to null.
  db.prepare(
    `INSERT INTO milestones
       (engagement_id, milestone_index, amount_wei, state, delivered_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(engagement_id, milestone_index) DO UPDATE SET
       amount_wei = excluded.amount_wei,
       state = excluded.state,
       delivered_at = excluded.delivered_at,
       updated_at = excluded.updated_at`
  ).run(engagementId, milestoneIndex, nextAmount, nextState, nextDelivered, now);
}

function emitMilestone(engagementId: number, milestoneIndex: number, state: string): void {
  emitForEngagement(getDb(), engagementId, {
    kind: "milestone",
    detail: { milestone_index: milestoneIndex, state },
  });
}

function handleMilestoneFunded(log: Log) {
  const a = (log as any).args as {
    engagementId: bigint;
    milestoneIndex: bigint;
    amount: bigint;
  };
  const eng = Number(a.engagementId);
  const idx = Number(a.milestoneIndex);
  // V2: amount comes inline with funding — single event creates the
  // milestone in the local mirror with both amount and state populated.
  upsertMilestone(eng, idx, { amount_wei: a.amount.toString(), state: "funded" });

  // If this funding materializes an off-chain `milestone_offers` row, mark
  // it accepted. We match by engagement + open offer with the exact funded
  // amount; the head offer is whichever isn't superseded or accepted yet.
  const db = getDb();
  const offer = db
    .prepare(
      `SELECT id FROM milestone_offers
       WHERE engagement_id = ?
         AND amount_wei = ?
         AND superseded_by IS NULL
         AND accepted_milestone_index IS NULL
       ORDER BY id DESC
       LIMIT 1`
    )
    .get(eng, a.amount.toString()) as { id: number } | undefined;
  if (offer) {
    db.prepare(`UPDATE milestone_offers SET accepted_milestone_index = ? WHERE id = ?`).run(
      idx,
      offer.id
    );
  }

  emitMilestone(eng, idx, "funded");
  console.log(`[indexer] MilestoneFunded #${eng}/${idx} ${a.amount} wei`);
}

function handleMilestoneDelivered(log: Log) {
  const a = (log as any).args as {
    engagementId: bigint;
    milestoneIndex: bigint;
    deliveredAt: bigint;
  };
  const eng = Number(a.engagementId);
  const idx = Number(a.milestoneIndex);
  upsertMilestone(eng, idx, { state: "delivered", delivered_at: Number(a.deliveredAt) });
  emitMilestone(eng, idx, "delivered");
  console.log(`[indexer] MilestoneDelivered #${eng}/${idx} at=${a.deliveredAt}`);
}

function handleMilestoneReleased(log: Log) {
  const a = (log as any).args as { engagementId: bigint; milestoneIndex: bigint };
  const eng = Number(a.engagementId);
  const idx = Number(a.milestoneIndex);
  upsertMilestone(eng, idx, { state: "released" });
  emitMilestone(eng, idx, "released");
  console.log(`[indexer] MilestoneReleased #${eng}/${idx}`);
}

function handleMilestoneRefunded(log: Log) {
  // V2 emits MilestoneMutuallyRefunded; the local state tag stays
  // "refunded" since the closure check treats it the same way.
  const a = (log as any).args as { engagementId: bigint; milestoneIndex: bigint };
  const eng = Number(a.engagementId);
  const idx = Number(a.milestoneIndex);
  upsertMilestone(eng, idx, { state: "refunded" });
  emitMilestone(eng, idx, "refunded");
  console.log(`[indexer] MilestoneMutuallyRefunded #${eng}/${idx}`);
}

function handleMilestoneDisputed(log: Log) {
  const a = (log as any).args as {
    engagementId: bigint;
    milestoneIndex: bigint;
    by: Address;
  };
  const eng = Number(a.engagementId);
  const idx = Number(a.milestoneIndex);
  upsertMilestone(eng, idx, { state: "disputed" });
  emitMilestone(eng, idx, "disputed");
  console.log(`[indexer] MilestoneDisputed #${eng}/${idx} by=${a.by}`);
}

function handleMilestoneResolved(log: Log) {
  const a = (log as any).args as {
    engagementId: bigint;
    milestoneIndex: bigint;
    toLawyer: bigint;
    toClient: bigint;
  };
  const eng = Number(a.engagementId);
  const idx = Number(a.milestoneIndex);
  upsertMilestone(eng, idx, { state: "resolved" });
  emitMilestone(eng, idx, "resolved");
  console.log(
    `[indexer] MilestoneResolved #${eng}/${idx} lawyer=${a.toLawyer} client=${a.toClient}`
  );
}
