"use client";

import { useState } from "react";
import Link from "next/link";
import { signOut, useSession } from "next-auth/react";
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

/**
 * Session-aware sign-in / sign-out control.
 *   • Disconnected → "Sign In" button → /connect.
 *   • Connected    → wallet pill that opens a Radix DropdownMenu with an
 *                    explicit "Sign out" action. Connecting the wallet IS
 *                    sign-in; the menu is the only way back.
 *
 * The dropdown uses Radix so the cursor can travel from the trigger button
 * through the gap to the menu items without the menu collapsing — earlier
 * implementations hand-rolled a `onMouseLeave` close that fired during that
 * traversal and made the Sign out item nearly impossible to click.
 */
export function WalletButton({ size = "sm" as const }) {
  const { data: session } = useSession();
  const [busy, setBusy] = useState(false);

  if (session?.user) {
    const address = truncateAddress(session.user.walletAddress);
    const handleSignOut = async () => {
      setBusy(true);
      try {
        await signOut({ redirect: false });
      } finally {
        // Hard reload guarantees any cached server-rendered shell drops.
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
    <Button asChild variant="primary" size={size}>
      <Link href="/connect">
        <Wallet className="h-4 w-4" aria-hidden /> Sign In
      </Link>
    </Button>
  );
}
