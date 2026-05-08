// Owner spec: 001-verified-legal-engagement.
// Returns a stable per-wallet anonymous identifier the lawyer surface displays
// before accept; pairs the client wallet to a label without leaking the
// underlying address.

import { keccak256, toBytes } from 'viem';

export function anonymousClientId(walletAddress: string): string {
  const hash = keccak256(toBytes(`platform:${walletAddress.toLowerCase()}`));
  return `anon-${hash.slice(2, 6).toUpperCase()}`;
}
