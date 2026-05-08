// Owner spec: 001-verified-legal-engagement.
// viem clients for read + operator-side write paths.

import { createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { ADDRESSES } from './addresses';

export const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? process.env.RPC_URL ?? 'http://127.0.0.1:8545';
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? process.env.CHAIN_ID ?? 31337);

const anvilChain = {
  id: CHAIN_ID,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
} as const;

export const publicClient = createPublicClient({
  chain: anvilChain,
  transport: http(RPC_URL),
});

export function operatorWalletClient() {
  const pk = process.env.OPERATOR_PRIVATE_KEY;
  if (!pk) throw new Error('OPERATOR_PRIVATE_KEY missing');
  if (process.env.NODE_ENV === 'production' && pk.startsWith('0x725845f3')) {
    throw new Error('Operator key is the demo anvil[0] value — refusing to start in production');
  }
  const account = privateKeyToAccount(pk as `0x${string}`);
  return createWalletClient({ chain: anvilChain, transport: http(RPC_URL), account });
}

export { ADDRESSES };
