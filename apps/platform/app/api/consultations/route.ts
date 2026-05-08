// Owner spec: 001-verified-legal-engagement.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { keccak256, toBytes, toHex } from 'viem';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getLawyerProfile } from '@/lib/db/lawyer-profiles';
import { getVerifiedUser } from '@/lib/db/verified-users';
import { upsertEngagement } from '@/lib/db/engagements';
import { insertConsultation } from '@/lib/db/consultations';
import { upsertProposal } from '@/lib/db/proposals';
import { devWalletForAddress } from '@/lib/dev/persona-broadcast';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { escrow } from '@/lib/chain/contracts';
import { publicClient } from '@/lib/chain/client';
import { syncFromChain } from '@/lib/chain/indexer';
import { classifyRevert } from '@/lib/chain/broadcast';

export const runtime = 'nodejs';

const Body = z.object({
  lawyerAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  scheduledAt: z.number().int().positive(),
  durationMinutes: z.union([z.literal(30), z.literal(60)]),
  practiceArea: z.string().min(2),
  caseDescription: z.string().min(20),
});

const PLATFORM_FEE_BPS = 500n; // 5%
const BASIS = 10000n;
const ZERO_BYTES32 = ('0x' + '0'.repeat(64)) as `0x${string}`;

export async function POST(req: NextRequest) {
  const session = await getSessionWithRoles();
  if (!session?.isClient) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const lawyerProfile = getLawyerProfile(parsed.data.lawyerAddress);
  const lawyerVU = getVerifiedUser(parsed.data.lawyerAddress, 'lawyer');
  if (!lawyerProfile || !lawyerVU) {
    return NextResponse.json({ error: 'lawyer-not-verified' }, { status: 404 });
  }

  const isPaid = lawyerProfile.consultation_type === 'PAID';
  const rateWei = parsed.data.durationMinutes === 30 ? lawyerProfile.consultation_rate_30_wei : lawyerProfile.consultation_rate_60_wei;
  const consultationFeeWei = isPaid ? BigInt(rateWei) : 0n;
  const platformFeeWei = (consultationFeeWei * PLATFORM_FEE_BPS) / BASIS;

  const matterRef = keccak256(toBytes(`${parsed.data.caseDescription}|${parsed.data.practiceArea}|${(lawyerVU.disclosed_attrs.jurisdiction as string) ?? ''}`));
  const initialRoot = keccak256(toBytes(`engagement-init:${session.address}:${parsed.data.lawyerAddress}:${Date.now()}`));
  const proof = '0xc0ffee' as `0x${string}`;
  const nullifier = keccak256(toBytes(`nullifier:${session.address}:${parsed.data.lawyerAddress}:${Date.now()}:${Math.random()}`));

  if (!isBypassActive()) {
    return NextResponse.json({ error: 'wallet-broadcast-not-implemented' }, { status: 501 });
  }

  let engagementId: bigint;
  let txHash: `0x${string}`;
  try {
    const wallet = devWalletForAddress(session.address);
    if (isPaid) {
      txHash = await wallet.writeContract({
        ...escrow,
        functionName: 'openPaidEngagementAndFundConsultation',
        args: [parsed.data.lawyerAddress as `0x${string}`, matterRef, consultationFeeWei, proof, nullifier, initialRoot],
        value: consultationFeeWei,
      });
    } else {
      txHash = await wallet.writeContract({
        ...escrow,
        functionName: 'openFreeEngagement',
        args: [parsed.data.lawyerAddress as `0x${string}`, matterRef, proof, nullifier, initialRoot],
      });
    }
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    // Read the EngagementOpened log for the engagementId.
    engagementId = await publicClient.readContract({
      ...escrow,
      functionName: 'getEngagement',
      args: [0n],
    }).then(() => 0n).catch(() => 0n);
    // Better: parse from receipt logs.
    const opened = receipt.logs.find((l) => l.address.toLowerCase() === escrow.address.toLowerCase());
    if (opened?.topics?.[1]) engagementId = BigInt(opened.topics[1]);
  } catch (e) {
    const r = classifyRevert(e);
    return NextResponse.json({ error: r.code, detail: r.detail }, { status: r.status });
  }

  const engagementIdNum = Number(engagementId);
  const now = Math.floor(Date.now() / 1000);

  upsertEngagement({
    engagement_id: engagementIdNum,
    client_address: session.address,
    lawyer_address: parsed.data.lawyerAddress,
    matter_description: parsed.data.caseDescription,
    target_jurisdiction: (lawyerVU.disclosed_attrs.jurisdiction as string) ?? '',
    target_practice_area: parsed.data.practiceArea,
    current_transcript_root: initialRoot,
    last_anchor_block: null,
    state: 'Active',
    created_at: now,
    closed_at: null,
  });

  const consultationId = insertConsultation({
    engagement_id: engagementIdNum,
    client_id: session.address,
    lawyer_user_id: parsed.data.lawyerAddress,
    scheduled_at: parsed.data.scheduledAt,
    duration_minutes: parsed.data.durationMinutes,
    practice_area: parsed.data.practiceArea,
    case_description: parsed.data.caseDescription,
    consultation_kind: isPaid ? 'PAID' : 'FREE',
    consultation_fee_wei: consultationFeeWei.toString(),
    platform_fee_wei: platformFeeWei.toString(),
    status: 'REQUESTED',
    escrow_funding_tx_hash: isPaid ? txHash : null,
    escrow_release_tx_hash: null,
  });

  if (isPaid) {
    upsertProposal({
      engagement_id: engagementIdNum,
      proposal_index: 0,
      kind: 'CONSULTATION',
      lawyer_address: parsed.data.lawyerAddress,
      total_wei: consultationFeeWei.toString(),
      platform_fee_wei: platformFeeWei.toString(),
      line_items: [],
      deliverables: [],
      items_hash: '',
      nonce: '',
      lawyer_offer_signature: '',
      state: 'Funded',
      funded_tx_hash: txHash,
      delivered_tx_hash: null,
      delivered_at_block_timestamp: null,
      released_tx_hash: null,
      disputed_tx_hash: null,
      dispute_filed_by: null,
      resolved_tx_hash: null,
      amount_to_lawyer_wei: null,
      amount_to_client_wei: null,
      refunded_tx_hash: null,
      created_at: now,
      updated_at: now,
    });
  }

  await syncFromChain();
  return NextResponse.json({ ok: true, engagementId: engagementIdNum, consultationId, txHash });
}
