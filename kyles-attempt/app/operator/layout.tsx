import Link from "next/link";
import { Scale, ShieldAlert } from "lucide-react";
import { requireOperator } from "@/lib/auth/session";
import { FirmusLogo } from "@/components/firmus/firmus-logo";
import { WalletButton } from "@/components/firmus/wallet-button";
import { truncateAddress } from "@/lib/utils/format";

// =============================================================================
// /operator/* layout — F7
// -----------------------------------------------------------------------------
// Operator-only layout. Gate runs at the layout level so every nested page
// inherits the access check. Mirrors A's `app/(operator)/layout.tsx`.
//
// The operator persona isn't a Role enum value — it's identified by the
// SCHEMA_OPERATOR capability OR a wallet match against the configured operator
// address. `requireOperator()` (lib/auth/session.ts) checks both signals.
//
// We intentionally don't use `AppTopBar` here because that component bakes in
// CLIENT vs LAWYER nav links. The operator view has its own minimal chrome:
// a logo, the page title, the wallet pill (which doubles as sign-out), and a
// single sidebar item for now. F8+ expand the sidebar with the multi-operator
// audit log + other operator surfaces.
// =============================================================================

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOperator();
  const address = truncateAddress(session.user.walletAddress);

  return (
    <div className="min-h-screen bg-white-50">
      <header className="sticky top-0 z-30 flex items-center gap-6 border-b border-slate-100 bg-white-0 px-6 py-4 lg:px-8">
        <Link href="/operator/disputes" className="inline-flex">
          <FirmusLogo size={18} />
        </Link>
        <div className="flex items-center gap-2">
          <Scale className="h-3.5 w-3.5 text-gold-700" aria-hidden />
          <span className="text-[13px] font-medium uppercase tracking-[0.18em] text-gold-700">
            Operator Console
          </span>
        </div>
        <div className="flex flex-1 justify-end items-center gap-3">
          <span className="hidden font-mono text-[12px] text-slate-500 sm:inline-block">
            {address}
          </span>
          <WalletButton />
        </div>
      </header>
      <div className="mx-auto flex max-w-[1240px] gap-8 px-6 py-10 lg:px-8">
        <aside className="hidden w-52 shrink-0 md:block">
          <nav className="sticky top-[88px] flex flex-col gap-1">
            <Link
              href="/operator/disputes"
              className="flex items-center gap-2 rounded-lg bg-navy-900 px-3 py-2 text-[13px] font-medium text-white"
            >
              <ShieldAlert className="h-4 w-4" aria-hidden />
              Disputes
            </Link>
          </nav>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
