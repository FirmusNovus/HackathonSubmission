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
      <Button
        variant="outline"
        disabled
        className="rounded-full border-slate-200 bg-white px-5 text-slate-700"
      >
        Connect wallet
      </Button>
    );
  }

  if (isConnected && address) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-slate-100 bg-white px-3 py-1.5 shadow-[var(--shadow-sm)]">
        <span className="h-2 w-2 rounded-full bg-teal-500" aria-hidden />
        <span className="font-mono text-[13px] text-slate-700">
          {address.slice(0, 6)}…{address.slice(-4)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => disconnect()}
          className="h-7 rounded-full px-2.5 text-[12px] text-slate-500 hover:bg-slate-50 hover:text-navy-900"
        >
          Disconnect
        </Button>
      </div>
    );
  }

  const injected = connectors.find((c) => c.type === "injected") ?? connectors[0];
  return (
    <Button
      onClick={() => injected && connect({ connector: injected })}
      disabled={isPending}
      className="rounded-full bg-teal-500 px-5 text-white shadow-[var(--shadow-sm)] hover:bg-teal-600"
    >
      {isPending ? "Connecting…" : "Connect wallet"}
    </Button>
  );
}
