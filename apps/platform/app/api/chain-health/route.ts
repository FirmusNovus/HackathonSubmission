// Owner spec: 001-verified-legal-engagement.
// FR-060: cached eth_blockNumber probe.

import { NextResponse } from 'next/server';
import { publicClient } from '@/lib/chain/client';

let cache: { healthy: boolean; lastBlock?: bigint; lastChecked: number } | null = null;
const TTL_MS = 5_000;

export async function GET() {
  if (cache && Date.now() - cache.lastChecked < TTL_MS) {
    return NextResponse.json({
      healthy: cache.healthy,
      lastBlock: cache.lastBlock?.toString(),
      lastChecked: cache.lastChecked,
    });
  }
  try {
    const block = await publicClient.getBlockNumber();
    cache = { healthy: true, lastBlock: block, lastChecked: Date.now() };
  } catch {
    cache = { healthy: false, lastChecked: Date.now() };
  }
  return NextResponse.json({
    healthy: cache.healthy,
    lastBlock: cache.lastBlock?.toString(),
    lastChecked: cache.lastChecked,
  });
}
