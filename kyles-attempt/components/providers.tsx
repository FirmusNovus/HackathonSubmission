"use client";

import { SessionProvider } from "next-auth/react";

// Mock-mode providers. Wagmi / RainbowKit are not wired — every wallet
// interaction in the UI is simulated. See lib/web3/config.ts for how to
// switch back to a real wagmi config when production-ready.
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
