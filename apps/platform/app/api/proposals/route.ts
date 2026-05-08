// Owner spec: 001-verified-legal-engagement.
// POST: lawyer issues a signed off-chain proposal artifact for an existing
// engagement. The signature binds (engagementId, totalWei, itemsHash, nonce)
// — exactly what the contract verifies in fundProposal.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { keccak256, toBytes, type Address } from 'viem';
import { mnemonicToAccount } from 'viem/accounts';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getEngagement } from '@/lib/db/engagements';
import { upsertProposal, listProposalsForEngagement } from '@/lib/db/proposals';
import { getDb } from '@/lib/db/client';
import { ADDRESSES, CHAIN_ID } from '@/lib/chain/client';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { getPersonaByAddress } from '@/lib/dev/persona-fixtures';

export const runtime = 'nodejs';

const LineItem = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  kind: z.enum(['hourly', 'fixed']),
  hours: z.number().nonnegative().optional(),
  ratePerHour: z.string().optional(),
  fixedPrice: z.string().optional(),
  subtotal: z.string(),
});
const Deliverable = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
});
const Body = z.object({
  engagementId: z.number().int().nonnegative(),
  lineItems: z.array(LineItem).min(1),
  deliverables: z.array(Deliverable).min(1),
});

const PLATFORM_FEE_BPS = 500n;
const BASIS = 10000n;

export async function POST(req: NextRequest) {
  const session = await getSessionWithRoles();
  if (!session?.isLawyer) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'bad-request', issues: parsed.error.issues }, { status: 400 });
  }

  const e = getEngagement(parsed.data.engagementId);
  if (!e) return NextResponse.json({ error: 'engagement-not-found' }, { status: 404 });
  if (e.lawyer_address !== session.address.toLowerCase()) {
    return NextResponse.json({ error: 'not-engagement-lawyer' }, { status: 403 });
  }

  // Compute total + items hash.
  let total = 0n;
  for (const li of parsed.data.lineItems) total += BigInt(li.subtotal);
  const platformFee = (total * PLATFORM_FEE_BPS) / BASIS;
  const itemsHash = keccak256(
    toBytes(JSON.stringify({ items: parsed.data.lineItems, deliverables: parsed.data.deliverables })),
  );
  const nonce = keccak256(toBytes(`offer:${session.address}:${parsed.data.engagementId}:${Date.now()}:${Math.random()}`));

  // Sign EIP-712 ProposalOffer in dev-bypass mode (real wallet does this in prod).
  if (!isBypassActive()) {
    return NextResponse.json({ error: 'wallet-sign-not-implemented' }, { status: 501 });
  }
  const persona = getPersonaByAddress(session.address);
  if (!persona) return NextResponse.json({ error: 'unknown-persona' }, { status: 400 });
  const account = mnemonicToAccount(process.env.ANVIL_MNEMONIC ?? '', { addressIndex: persona.index });
  const signature = await account.signTypedData({
    domain: {
      name: 'FirmusNovusEscrow',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: ADDRESSES.legalEngagementEscrow as Address,
    },
    types: {
      ProposalOffer: [
        { name: 'engagementId', type: 'uint256' },
        { name: 'totalWei', type: 'uint256' },
        { name: 'itemsHash', type: 'bytes32' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'ProposalOffer',
    message: {
      engagementId: BigInt(parsed.data.engagementId),
      totalWei: total,
      itemsHash,
      nonce,
    },
  });

  // Persist as Issued. Index is current proposalCount on chain (we read it
  // from the engagement struct via the off-chain mirror).
  const existing = listProposalsForEngagement(parsed.data.engagementId);
  const nextIdx = existing.length === 0 ? (e ? 0 : 0) : Math.max(...existing.map((p) => p.proposal_index)) + 1;

  const now = Math.floor(Date.now() / 1000);
  upsertProposal({
    engagement_id: parsed.data.engagementId,
    proposal_index: nextIdx,
    kind: 'PROPOSAL',
    lawyer_address: session.address,
    total_wei: total.toString(),
    platform_fee_wei: platformFee.toString(),
    line_items: parsed.data.lineItems,
    deliverables: parsed.data.deliverables,
    items_hash: itemsHash,
    nonce,
    lawyer_offer_signature: signature,
    state: 'Issued',
    funded_tx_hash: null,
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

  return NextResponse.json({
    ok: true,
    engagementId: parsed.data.engagementId,
    proposalIndex: nextIdx,
    totalWei: total.toString(),
    platformFeeWei: platformFee.toString(),
    itemsHash,
    nonce,
    signature,
  });
}
