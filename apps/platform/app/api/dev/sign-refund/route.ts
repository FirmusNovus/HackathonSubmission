// Owner spec: 001-verified-legal-engagement.
// Dev-only: signs the EIP-712 mutual-refund typed-data hash with the calling
// persona's anvil-derived private key. Returns the signature so the caller
// can post it to /api/proposals/.../mutual-refund/initiate. Replaces the
// real wallet signing step until wwWallet integration lands. FR-D01.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { signTypedData } from 'viem/accounts';
import { mnemonicToAccount } from 'viem/accounts';
import { isBypassActive } from '@/lib/dev/bypass-guard';
import { getSessionWithRoles } from '@/lib/auth/session';
import { getPersonaByAddress } from '@/lib/dev/persona-fixtures';
import { ADDRESSES, CHAIN_ID } from '@/lib/chain/client';

export const runtime = 'nodejs';

const Body = z.object({
  engagementId: z.number().int().nonnegative(),
  proposalIndex: z.number().int().nonnegative(),
  nonce: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
});

export async function POST(req: NextRequest) {
  if (!isBypassActive()) return NextResponse.json({ error: 'not-found' }, { status: 404 });
  const session = await getSessionWithRoles();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = Body.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'bad-request' }, { status: 400 });

  const persona = getPersonaByAddress(session.address);
  if (!persona) return NextResponse.json({ error: 'unknown-persona' }, { status: 400 });
  const mnemonic = process.env.ANVIL_MNEMONIC;
  if (!mnemonic) return NextResponse.json({ error: 'no-mnemonic' }, { status: 500 });

  const account = mnemonicToAccount(mnemonic, { addressIndex: persona.index });

  const signature = await account.signTypedData({
    domain: {
      name: 'FirmusNovusEscrow',
      version: '1',
      chainId: CHAIN_ID,
      verifyingContract: ADDRESSES.legalEngagementEscrow as `0x${string}`,
    },
    types: {
      MutualRefundAuthorization: [
        { name: 'engagementId', type: 'uint256' },
        { name: 'proposalIndex', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    primaryType: 'MutualRefundAuthorization',
    message: {
      engagementId: BigInt(parsed.data.engagementId),
      proposalIndex: BigInt(parsed.data.proposalIndex),
      nonce: parsed.data.nonce as `0x${string}`,
    },
  });

  return NextResponse.json({ ok: true, signature, signer: session.address });
}
