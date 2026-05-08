// Owner spec: 001-verified-legal-engagement.
// Either party signs the EIP-712 mutual-refund authorization for a Funded
// proposal. The route verifies the signature against the caller's wallet,
// stores it, and returns the current state of the authorization (which
// signatures are present).

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { recoverTypedDataAddress, keccak256, toBytes, type Address } from 'viem';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getEngagement } from '@/lib/db/engagements';
import { getDb } from '@/lib/db/client';
import { ADDRESSES, CHAIN_ID } from '@/lib/chain/client';

export const runtime = 'nodejs';

const Body = z.object({
  signature: z.string().regex(/^0x[a-fA-F0-9]+$/),
  nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export async function POST(
  req: NextRequest,
  ctx: { params: { engagementId: string; proposalIndex: string } },
) {
  const session = await getSessionWithRoles();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const engagementId = Number(ctx.params.engagementId);
  const proposalIndex = Number(ctx.params.proposalIndex);
  const engagement = getEngagement(engagementId);
  if (!engagement) return NextResponse.json({ error: 'not-found' }, { status: 404 });

  const isClient = engagement.client_address === session.address.toLowerCase();
  const isLawyer = engagement.lawyer_address === session.address.toLowerCase();
  if (!isClient && !isLawyer) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  // Verify signature against EIP-712 typed data — same encoding as the contract.
  const domain = {
    name: 'FirmusNovusEscrow',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: ADDRESSES.legalEngagementEscrow as Address,
  } as const;
  const types = {
    MutualRefundAuthorization: [
      { name: 'engagementId', type: 'uint256' },
      { name: 'proposalIndex', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  } as const;
  const message = {
    engagementId: BigInt(engagementId),
    proposalIndex: BigInt(proposalIndex),
    nonce: parsed.data.nonce as `0x${string}`,
  };
  const recovered = await recoverTypedDataAddress({
    domain,
    types,
    primaryType: 'MutualRefundAuthorization',
    message,
    signature: parsed.data.signature as `0x${string}`,
  });
  if (recovered.toLowerCase() !== session.address.toLowerCase()) {
    return NextResponse.json({ error: 'signature-mismatch' }, { status: 400 });
  }

  // Upsert into mutual_refund_authorizations (one row per nonce).
  const db = getDb();
  const existing = db
    .prepare(
      `SELECT * FROM mutual_refund_authorizations WHERE engagement_id = ? AND proposal_index = ? AND nonce = ?`,
    )
    .get(engagementId, proposalIndex, parsed.data.nonce) as
    | { id: number; client_signature: string | null; lawyer_signature: string | null }
    | undefined;

  const now = Math.floor(Date.now() / 1000);
  if (existing) {
    db.prepare(
      `UPDATE mutual_refund_authorizations SET ${isClient ? 'client_signature' : 'lawyer_signature'} = ? WHERE id = ?`,
    ).run(parsed.data.signature, existing.id);
  } else {
    db.prepare(
      `INSERT INTO mutual_refund_authorizations (engagement_id, proposal_index, nonce, client_signature, lawyer_signature, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      engagementId,
      proposalIndex,
      parsed.data.nonce,
      isClient ? parsed.data.signature : null,
      isLawyer ? parsed.data.signature : null,
      now,
    );
  }

  const row = db
    .prepare(
      `SELECT client_signature, lawyer_signature FROM mutual_refund_authorizations WHERE engagement_id = ? AND proposal_index = ? AND nonce = ?`,
    )
    .get(engagementId, proposalIndex, parsed.data.nonce) as
    | { client_signature: string | null; lawyer_signature: string | null }
    | undefined;

  return NextResponse.json({
    ok: true,
    bothSigsPresent: !!(row?.client_signature && row?.lawyer_signature),
  });
}
