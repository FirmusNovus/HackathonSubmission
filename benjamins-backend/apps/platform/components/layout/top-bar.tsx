import Link from "next/link";
import { FirmusLogo } from "@/components/firmus/firmus-logo";
import { ConnectWallet } from "@/components/ConnectWallet";

const NAV_ITEMS: Array<{ label: string; href: string }> = [
  { label: "Lawyers", href: "/lawyers" },
  { label: "Matters", href: "/matters" },
  { label: "Inbox", href: "/inbox" },
  { label: "How It Works", href: "/#how" },
];

/**
 * App-wide top header. Mirrors the Firmus marketing nav look (logo + sticky
 * white bar + teal-active links) but keeps the existing ConnectWallet as the
 * sign-in primitive — no auth/role wiring required.
 */
export function TopBar() {
  return (
    <header className="sticky top-0 z-30 flex items-center gap-10 border-b border-slate-100 bg-white px-6 py-5 lg:px-12">
      <Link href="/" className="inline-flex">
        <FirmusLogo />
      </Link>
      <nav className="hidden gap-8 md:flex">
        {NAV_ITEMS.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className="border-b-2 border-transparent pb-0.5 text-[14px] font-medium text-slate-700 hover:text-navy-900"
          >
            {it.label}
          </Link>
        ))}
      </nav>
      <div className="flex-1" />
      <ConnectWallet />
    </header>
  );
}
