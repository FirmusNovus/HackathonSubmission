"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";

export function ConnectWallet() {
  // wagmi hydrates wallet state from localStorage in the browser, which means
  // the server-rendered HTML and the first client render diverge whenever a
  // wallet is already connected. Gate everything wagmi-state-dependent behind
  // a mounted flag so the SSR HTML matches the first client render.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const { address, isConnected } = useAccount();
  const { connectors, connect, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  if (!mounted) {
    return (
      <Button variant="outline" disabled>
        Connect wallet
      </Button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-mono text-muted-foreground">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <Button variant="outline" size="sm" onClick={() => disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }

  const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];
  return (
    <Button onClick={() => injected && connect({ connector: injected })} disabled={isPending}>
      {isPending ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
