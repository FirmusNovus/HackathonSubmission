import Link from "next/link";
import { FirmusLogo } from "@/components/firmus/firmus-logo";
import { NetworkPattern } from "@/components/firmus/network-pattern";

/** Wrapper used by the connect-wallet and lawyer-verification onboarding screens. */
export function AuthShell({ children, showNet = true, escapeHref = "/" }: { children: React.ReactNode; showNet?: boolean; escapeHref?: string }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-white-50">
      {showNet && <NetworkPattern opacity={0.4} />}
      <header className="relative flex items-center justify-between px-8 py-7 lg:px-12">
        <Link href="/"><FirmusLogo /></Link>
        <Link href={escapeHref} className="text-[13px] font-medium text-slate-500 hover:text-navy-900">
          Cancel
        </Link>
      </header>
      <main className="relative mx-auto max-w-[880px] px-6 pb-20">{children}</main>
    </div>
  );
}
