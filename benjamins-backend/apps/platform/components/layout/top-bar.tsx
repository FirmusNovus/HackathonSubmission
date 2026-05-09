import Link from "next/link";
import { FirmusLogo } from "@/components/firmus/firmus-logo";
import { ConnectWallet } from "@/components/ConnectWallet";

/** Minimal top bar: logo + wallet pill. Navigation is driven from the landing page. */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-6 border-b border-slate-100 bg-white px-6 py-5 lg:px-12">
      <Link href="/" className="inline-flex">
        <FirmusLogo />
      </Link>
      <div className="flex-1" />
      <ConnectWallet />
    </header>
  );
}
