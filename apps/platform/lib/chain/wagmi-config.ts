'use client';
// Owner spec: 001-verified-legal-engagement.

import { http, createConfig } from 'wagmi';
import { anvil } from 'wagmi/chains';
import { injected } from 'wagmi/connectors';

const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? 'http://127.0.0.1:8545';

export const wagmiConfig = createConfig({
  chains: [anvil],
  transports: { [anvil.id]: http(RPC_URL) },
  connectors: [injected()],
});
