import Link from "next/link";
import { Search } from "lucide-react";
import { Role } from "@/lib/db/enums";
import { FirmusLogo } from "@/components/firmus/firmus-logo";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { WalletButton } from "@/components/firmus/wallet-button";

interface AppTopBarProps {
  user: { name?: string | null; walletAddress: string; role: Role };
  active?: "home" | "messages" | "cases" | "orders" | "dashboard" | "profile";
  dark?: boolean;
}

const CLIENT_LINKS: Array<{ key: NonNullable<AppTopBarProps["active"]>; label: string; href: string }> = [
  { key: "home", label: "Home", href: "/client/home" },
  { key: "cases", label: "Cases", href: "/client/cases" },
  { key: "messages", label: "Messages", href: "/client/messages" },
];

const LAWYER_LINKS: Array<{ key: NonNullable<AppTopBarProps["active"]>; label: string; href: string }> = [
  { key: "dashboard", label: "Dashboard", href: "/lawyer/dashboard" },
  { key: "orders", label: "Orders", href: "/lawyer/orders" },
  { key: "cases", label: "Cases", href: "/lawyer/cases" },
  { key: "messages", label: "Messages", href: "/lawyer/messages" },
  { key: "profile", label: "Profile", href: "/lawyer/profile/edit" },
];

export function AppTopBar({ user, active, dark }: AppTopBarProps) {
  const links = user.role === Role.LAWYER ? LAWYER_LINKS : CLIENT_LINKS;
  const wrapper = dark
    ? "sticky top-0 z-30 flex items-center gap-6 border-b border-white/10 bg-navy-950 px-6 py-4 lg:px-8"
    : "sticky top-0 z-30 flex items-center gap-6 border-b border-slate-100 bg-white-0 px-6 py-4 lg:px-8";
  return (
    <header className={wrapper}>
      <Link href={user.role === Role.LAWYER ? "/lawyer/dashboard" : "/client/home"} className="inline-flex">
        <FirmusLogo light={dark} size={18} />
      </Link>
      <nav className="hidden gap-6 md:flex">
        {links.map((it) => {
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
      <div className="hidden flex-1 lg:block">
        <div className={dark ? "flex h-9 max-w-md items-center gap-2 rounded-full bg-white/5 px-3.5" : "flex h-9 max-w-md items-center gap-2 rounded-full bg-slate-50 px-3.5"}>
          <Search className={dark ? "h-4 w-4 text-white/60" : "h-4 w-4 text-slate-500"} aria-hidden />
          <span className={dark ? "text-[13px] text-white/60" : "text-[13px] text-slate-500"}>Search</span>
        </div>
      </div>
      <div className="flex flex-1 lg:flex-none" />
      {/* The wallet pill / Sign out menu is the only place to leave a session.
          Using the same WalletButton as the marketing nav for parity. */}
      <WalletButton />
      <AvatarBubble name={user.name ?? "You"} size={32} />
    </header>
  );
}
