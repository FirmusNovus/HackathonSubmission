'use client';
// Owner spec: 001-verified-legal-engagement.

import { useEffect, useState } from 'react';
import { useAccount, useConnect, useDisconnect } from 'wagmi';
import { Button } from '@/components/ui/button';
import { truncateAddress } from '@/lib/format/address';

export function ConnectWallet() {
  // wagmi hydrates from localStorage; gate behind mounted to avoid SSR/CSR
  // hydration divergence when the wallet is already connected.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (!mounted) {
    return (
      <Button variant="secondary" size="sm" disabled>
        Connect wallet
      </Button>
    );
  }
  if (isConnected && address) {
    return (
      <div className="inline-flex items-center gap-2 text-sm">
        <span className="font-mono text-xs text-slate-500">{truncateAddress(address)}</span>
        <Button variant="ghost" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }
  const injectedConnector = connectors.find((c) => c.type === 'injected') ?? connectors[0];
  return (
    <Button
      onClick={() => injectedConnector && connect({ connector: injectedConnector })}
      disabled={isPending}
      size="sm"
    >
      {isPending ? 'Connecting…' : 'Connect wallet'}
    </Button>
  );
}
