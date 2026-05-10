"use client";

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { useDisconnect } from "wagmi";
import { ChevronDown, LogOut, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { truncateAddress } from "@/lib/utils/format";
import { useConnectAndSignIn } from "@/lib/web3/use-connect-and-sign-in";

/**
 * Session-aware connect / sign-out control.
 *
 *   • Disconnected → "Connect wallet" button. Click triggers wagmi connect +
 *     SIWE inline (modern web3 pattern), then queries the chain for existing
 *     attestations: known lawyer → /lawyer/dashboard, known client → /client/home,
 *     unknown wallet → /connect to finish onboarding.
 *   • Connected → wallet pill with an explicit Sign out action that clears
 *     the NextAuth session, the wagmi connection state, and (best-effort
 *     via EIP-2255) MetaMask's "Connected sites" entry.
 */
export function WalletButton({ size = "sm" as const }) {
  const { data: session } = useSession();
  const { disconnectAsync } = useDisconnect();
  const { run: connectAndSignIn, pending: signingIn } = useConnectAndSignIn();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    setError(null);
    try {
      await connectAndSignIn();
      // Server-side, the SIWE provider already set User.role. Operator
      // wallet skips the chain attestation check and goes straight to the
      // admin dashboard. Otherwise we ask the chain directly for the
      // routing decision — truthful answer, doesn't depend on stale
      // session state.
      const meRes = await fetch("/api/auth/me/role", { cache: "no-store" });
      const me = meRes.ok ? ((await meRes.json()) as { role?: string }) : null;
      if (me?.role === "OPERATOR") {
        window.location.href = "/admin/dashboard";
        return;
      }
      const res = await fetch("/api/auth/me/attestations", { cache: "no-store" });
      if (!res.ok) throw new Error(`attestation check failed: HTTP ${res.status}`);
      const status = (await res.json()) as { client: boolean; lawyer: boolean };
      if (status.lawyer) {
        window.location.href = "/lawyer/dashboard";
      } else if (status.client) {
        window.location.href = "/client/home";
      } else {
        window.location.href = "/connect";
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (session?.user) {
    const address = truncateAddress(session.user.walletAddress);
    const handleSignOut = async () => {
      setBusy(true);
      try {
        await signOut({ redirect: false });
        await disconnectAsync().catch(() => {});
        // EIP-2255: ask the wallet to revoke the connection. Best-effort —
        // wallets that don't implement it just throw `method not supported`.
        try {
          const eth = (window as unknown as { ethereum?: { request: (args: { method: string; params: unknown[] }) => Promise<unknown> } }).ethereum;
          if (eth?.request) {
            await eth.request({
              method: "wallet_revokePermissions",
              params: [{ eth_accounts: {} }],
            });
          }
        } catch {
          // Wallet doesn't support EIP-2255 — leave it to the user to clear
          // the site from MetaMask's "Connected sites" if they want.
        }
      } finally {
        window.location.href = "/";
      }
    };
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label={`Account menu (${address})`}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-slate-50 pl-2 pr-3 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 data-[state=open]:bg-slate-100"
          >
            <span aria-hidden className="h-[22px] w-[22px] rounded-full" style={{ background: "linear-gradient(135deg, #14B8A6, #0A1F44)" }} />
            <span className="font-mono text-[13px] font-medium text-navy-900">{address}</span>
            <ChevronDown className="h-3.5 w-3.5 text-slate-400 transition-transform data-[state=open]:rotate-180" aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-60">
          <DropdownMenuLabel>
            <div>Signed in as</div>
            <div className="mt-0.5 truncate font-mono text-[13px] text-navy-900">{address}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            data-variant="danger"
            disabled={busy}
            onSelect={(e) => {
              e.preventDefault();
              void handleSignOut();
            }}
          >
            <LogOut className="h-3.5 w-3.5" aria-hidden />
            {busy ? "Signing out…" : "Sign out"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="primary"
        size={size}
        onClick={() => void handleConnect()}
        disabled={signingIn}
        aria-busy={signingIn}
        data-testid="connect-wallet"
      >
        {signingIn ? (
          <>
            <span aria-hidden className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            Connecting…
          </>
        ) : (
          <>
            <Wallet className="h-4 w-4" aria-hidden /> Connect wallet
          </>
        )}
      </Button>
      {error && <p className="max-w-[220px] text-right text-[11px] text-red-500">{error}</p>}
    </div>
  );
}
