import Link from "next/link";
import { Role } from "@/lib/db/enums";
import { auth } from "@/lib/auth/config";
import { FirmusLogo } from "@/components/firmus/firmus-logo";
import { WalletButton } from "@/components/firmus/wallet-button";

type ActiveKey =
  | "lawyers"
  | "how"
  | "home"
  | "cases"
  | "messages"
  | "dashboard"
  | "orders"
  | "profile";

interface MarketingNavProps {
  active?: ActiveKey;
  dark?: boolean;
}

const PUBLIC_ITEMS: Array<{ key: ActiveKey; label: string; href: string }> = [
  { key: "lawyers", label: "Lawyers", href: "/lawyers" },
  { key: "how", label: "How It Works", href: "/#how" },
];

const CLIENT_ITEMS: Array<{ key: ActiveKey; label: string; href: string }> = [
  { key: "lawyers", label: "Find a Lawyer", href: "/lawyers" },
  { key: "home", label: "Home", href: "/client/home" },
  { key: "cases", label: "Cases", href: "/client/cases" },
  { key: "messages", label: "Messages", href: "/client/messages" },
];

const LAWYER_ITEMS: Array<{ key: ActiveKey; label: string; href: string }> = [
  { key: "dashboard", label: "Dashboard", href: "/lawyer/dashboard" },
  { key: "orders", label: "Orders", href: "/lawyer/orders" },
  { key: "cases", label: "Cases", href: "/lawyer/cases" },
  { key: "messages", label: "Messages", href: "/lawyer/messages" },
  { key: "profile", label: "Profile", href: "/lawyer/profile/edit" },
];

/**
 * Top header for marketing/public pages. Adapts to the viewer's session:
 *
 *   • Not signed in   → marketing links (Lawyers · How It Works) and a
 *                       "Sign In" button. Lawyers join via the same Sign In
 *                       button — the onboarding flow has a role-pick step.
 *   • Signed-in client → app links (Find a Lawyer · Home · Cases · Messages)
 *                       and the wallet pill.
 *   • Signed-in lawyer → app links (Dashboard · Orders · Messages · Profile)
 *                       and the wallet pill.
 *
 * Wallet connected ⇒ signed in; there is no separate sign-in entry.
 */
export async function MarketingNav({ active, dark }: MarketingNavProps) {
  const session = await auth();
  const role = session?.user?.role;
  const items = role === Role.LAWYER ? LAWYER_ITEMS : role === Role.CLIENT ? CLIENT_ITEMS : PUBLIC_ITEMS;

  return (
    <header
      className={
        dark
          ? "sticky top-0 z-30 flex items-center gap-6 border-b border-white/10 bg-navy-900 px-6 py-4 lg:px-8"
          : "sticky top-0 z-30 flex items-center gap-6 border-b border-slate-100 bg-white-0 px-6 py-4 lg:px-8"
      }
    >
      <Link
        href={role === Role.LAWYER ? "/lawyer/dashboard" : role === Role.CLIENT ? "/client/home" : "/"}
        className="inline-flex"
      >
        <FirmusLogo light={dark} size={18} />
      </Link>
      <nav className="hidden gap-6 md:flex">
        {items.map((it) => {
          const isActive = active === it.key;
          return (
            <Link
              key={it.key}
              href={it.href}
              className={
                dark
                  ? `border-b-2 pb-0.5 text-[13px] font-medium ${isActive ? "border-teal-500 text-white" : "border-transparent text-white/80 hover:text-white"}`
                  : `border-b-2 pb-0.5 text-[13px] font-medium ${isActive ? "border-teal-500 text-navy-900" : "border-transparent text-slate-700 hover:text-navy-900"}`
              }
            >
              {it.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex-1" />
      {/* Test-issuer link surfaced in the public nav so anyone trying out the
          flow can grab a stand-in PID / lawyer credential. The issuer is its
          own process behind the same proxy — relative path keeps it on
          whichever origin is fronting us (local or ngrok). */}
      {!session?.user && (
        <Link
          href="/issuer"
          target="_blank"
          rel="noreferrer"
          className={
            dark
              ? "hidden text-[13px] font-medium text-white/70 hover:text-white sm:inline"
              : "hidden text-[13px] font-medium text-slate-500 hover:text-navy-900 sm:inline"
          }
        >
          Get test credentials ↗
        </Link>
      )}
      <WalletButton />
    </header>
  );
}
