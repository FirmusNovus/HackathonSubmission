// Owner spec: 001-verified-legal-engagement.
// Dev-only: when DEV_BYPASS_EUDI=1 the platform may broadcast transactions
// on a persona's behalf using the anvil-derived private key. This stands in
// for a real browser wallet so the demo can run headlessly. NEVER active in
// production (FR-D01).

import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { createWalletClient, http } from 'viem';
import { isBypassActive } from './bypass-guard';
import { RPC_URL, CHAIN_ID, publicClient } from '@/lib/chain/client';
import { getPersonaByAddress } from './persona-fixtures';

const anvilChain = {
  id: CHAIN_ID,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] }, public: { http: [RPC_URL] } },
} as const;

export function devWalletForAddress(address: string) {
  if (!isBypassActive()) {
    throw new Error('persona-broadcast called outside dev bypass');
  }
  const persona = getPersonaByAddress(address);
  if (!persona) throw new Error(`unknown persona for address: ${address}`);
  const mnemonic = process.env.ANVIL_MNEMONIC;
  if (!mnemonic) throw new Error('ANVIL_MNEMONIC missing');
  const account = mnemonicToAccount(mnemonic, { addressIndex: persona.index });
  return createWalletClient({ chain: anvilChain, transport: http(RPC_URL), account });
}

export function devWalletForPrivateKey(pk: `0x${string}`) {
  return createWalletClient({
    chain: anvilChain,
    transport: http(RPC_URL),
    account: privateKeyToAccount(pk),
  });
}

export { publicClient };
