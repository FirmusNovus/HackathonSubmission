// Owner spec: 001-verified-legal-engagement.
// Lightweight on-demand indexer: pulls events since lastBlock when invoked,
// reconciles SQLite mirrors. Resilient to chain unavailability (FR-061).

import { publicClient } from './client';
import { escrow, attestationManager, SCHEMA_LAWYER, SCHEMA_CLIENT } from './contracts';
import { setProposalState } from '@/lib/db/proposals';
import { upsertDispute } from '@/lib/db/disputes';
import { upsertEngagement, getEngagement } from '@/lib/db/engagements';
import { setStatus as setConsultationStatus, getConsultationByEngagementId } from '@/lib/db/consultations';
import { getDb } from '@/lib/db/client';

let lastSyncedBlock: bigint | null = null;

export async function syncFromChain(): Promise<{ ok: true; toBlock: bigint } | { ok: false; error: string }> {
  try {
    const head = await publicClient.getBlockNumber();
    const fromBlock = lastSyncedBlock !== null ? lastSyncedBlock + 1n : 0n;
    if (fromBlock > head) {
      lastSyncedBlock = head;
      return { ok: true, toBlock: head };
    }

    // Pull AttestationManager Revoked events so the directory drops revoked
    // lawyers. We cleared `revoked_at` on attest from /api/dev/login already;
    // here we mirror chain-side revocations.
    const amLogs = await publicClient.getContractEvents({
      address: attestationManager.address,
      abi: attestationManager.abi,
      eventName: 'Revoked',
      fromBlock,
      toBlock: head,
    });
    const now = Math.floor(Date.now() / 1000);
    for (const log of amLogs) {
      const args = log.args as { subject?: string; schemaId?: string };
      const subject = (args.subject ?? '').toLowerCase();
      const role: 'lawyer' | 'client' | null =
        args.schemaId === SCHEMA_LAWYER ? 'lawyer'
        : args.schemaId === SCHEMA_CLIENT ? 'client'
        : null;
      if (subject && role) {
        getDb()
          .prepare(`UPDATE verified_users SET revoked_at = ? WHERE eth_address = ? AND attested_role = ?`)
          .run(now, subject, role);
      }
    }

    // Mirror Attested events too — re-attestation after a previous revoke
    // must clear revoked_at so the directory shows the lawyer again.
    const attestedLogs = await publicClient.getContractEvents({
      address: attestationManager.address,
      abi: attestationManager.abi,
      eventName: 'Attested',
      fromBlock,
      toBlock: head,
    });
    for (const log of attestedLogs) {
      const args = log.args as { subject?: string; schemaId?: string; attestationUid?: string };
      const subject = (args.subject ?? '').toLowerCase();
      const role: 'lawyer' | 'client' | null =
        args.schemaId === SCHEMA_LAWYER ? 'lawyer'
        : args.schemaId === SCHEMA_CLIENT ? 'client'
        : null;
      if (subject && role && args.attestationUid) {
        getDb()
          .prepare(`UPDATE verified_users SET revoked_at = NULL, attestation_uid = ? WHERE eth_address = ? AND attested_role = ?`)
          .run(args.attestationUid, subject, role);
      }
    }

    const logs = await publicClient.getContractEvents({
      address: escrow.address,
      abi: escrow.abi,
      fromBlock,
      toBlock: head,
    });

    for (const log of logs) {
      const name = log.eventName;
      const args = log.args as Record<string, unknown>;
      const txHash = log.transactionHash as `0x${string}` | undefined;
      switch (name) {
        case 'EngagementOpened': {
          const id = Number(args.engagementId as bigint);
          const existing = getEngagement(id);
          if (!existing) {
            upsertEngagement({
              engagement_id: id,
              client_address: args.client as string,
              lawyer_address: args.lawyer as string,
              matter_description: '',
              target_jurisdiction: '',
              target_practice_area: '',
              current_transcript_root: '',
              last_anchor_block: Number(log.blockNumber),
              state: 'Active',
              created_at: Math.floor(Date.now() / 1000),
              closed_at: null,
            });
          }
          break;
        }
        case 'ProposalFunded': {
          const engagementId = Number(args.engagementId as bigint);
          const proposalIndex = Number(args.proposalIndex as bigint);
          setProposalState(engagementId, proposalIndex, 'Funded', { funded_tx_hash: txHash ?? null });
          // For consultation index 0, only update the funding tx hash. The
          // REQUESTED → ACCEPTED transition is an off-chain lawyer action.
          if (proposalIndex === 0) {
            const c = getConsultationByEngagementId(engagementId);
            if (c && !c.escrow_funding_tx_hash) {
              setConsultationStatus(c.id, c.status, { escrow_funding_tx_hash: txHash ?? null });
            }
          }
          break;
        }
        case 'ProposalDelivered': {
          const engagementId = Number(args.engagementId as bigint);
          const proposalIndex = Number(args.proposalIndex as bigint);
          const ts = Number(args.deliveredAt as bigint);
          setProposalState(engagementId, proposalIndex, 'Delivered', {
            delivered_tx_hash: txHash ?? null,
            delivered_at_block_timestamp: ts,
          });
          break;
        }
        case 'ProposalReleased': {
          const engagementId = Number(args.engagementId as bigint);
          const proposalIndex = Number(args.proposalIndex as bigint);
          setProposalState(engagementId, proposalIndex, 'Released', { released_tx_hash: txHash ?? null });
          if (proposalIndex === 0) {
            const c = getConsultationByEngagementId(engagementId);
            if (c) setConsultationStatus(c.id, 'COMPLETED', { escrow_release_tx_hash: txHash ?? null });
          }
          break;
        }
        case 'ProposalDisputed': {
          const engagementId = Number(args.engagementId as bigint);
          const proposalIndex = Number(args.proposalIndex as bigint);
          const by = (args.by as string).toLowerCase();
          const e = getEngagement(engagementId);
          const filed_by: 'client' | 'lawyer' = e && e.client_address === by ? 'client' : 'lawyer';
          setProposalState(engagementId, proposalIndex, 'Disputed', {
            disputed_tx_hash: txHash ?? null,
            dispute_filed_by: filed_by,
          });
          if (proposalIndex === 0) {
            const c = getConsultationByEngagementId(engagementId);
            if (c && c.status !== 'COMPLETED') setConsultationStatus(c.id, 'DISPUTED');
          }
          upsertDispute({
            engagement_id: engagementId,
            proposal_index: proposalIndex,
            state: 'disputed',
            filed_by,
            filed_at: Math.floor(Date.now() / 1000),
            delivered_at: null,
            resolved_at: null,
            amount_to_lawyer_wei: null,
            amount_to_client_wei: null,
            dispute_tx_hash: txHash ?? '',
            resolve_tx_hash: null,
          });
          break;
        }
        case 'ProposalResolved': {
          const engagementId = Number(args.engagementId as bigint);
          const proposalIndex = Number(args.proposalIndex as bigint);
          const toLawyer = (args.toLawyer as bigint).toString();
          const toClient = (args.toClient as bigint).toString();
          setProposalState(engagementId, proposalIndex, 'Resolved', {
            resolved_tx_hash: txHash ?? null,
            amount_to_lawyer_wei: toLawyer,
            amount_to_client_wei: toClient,
          });
          upsertDispute({
            engagement_id: engagementId,
            proposal_index: proposalIndex,
            state: 'resolved',
            filed_by: 'client',
            filed_at: Math.floor(Date.now() / 1000),
            delivered_at: null,
            resolved_at: Math.floor(Date.now() / 1000),
            amount_to_lawyer_wei: toLawyer,
            amount_to_client_wei: toClient,
            dispute_tx_hash: '',
            resolve_tx_hash: txHash ?? null,
          });
          break;
        }
        case 'ProposalRefunded': {
          const engagementId = Number(args.engagementId as bigint);
          const proposalIndex = Number(args.proposalIndex as bigint);
          setProposalState(engagementId, proposalIndex, 'Refunded', { refunded_tx_hash: txHash ?? null });
          break;
        }
        case 'TranscriptAnchored': {
          const engagementId = Number(args.engagementId as bigint);
          const e = getEngagement(engagementId);
          if (e) {
            upsertEngagement({
              ...e,
              current_transcript_root: args.root as string,
              last_anchor_block: Number(args.atBlock as bigint),
            });
          }
          break;
        }
        case 'EngagementClosed': {
          const engagementId = Number(args.engagementId as bigint);
          const e = getEngagement(engagementId);
          if (e) {
            upsertEngagement({ ...e, state: 'Closed', closed_at: Math.floor(Date.now() / 1000) });
          }
          break;
        }
      }
    }
    lastSyncedBlock = head;
    return { ok: true, toBlock: head };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
