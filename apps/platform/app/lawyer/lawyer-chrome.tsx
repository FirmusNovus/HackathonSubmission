// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { truncateAddress } from '@/lib/format/address';
import { LogoutButton } from '@/components/firmus/logout-button';

export function LawyerChrome({ address, children }: { address: string; children: React.ReactNode }) {
  return (
    <div>
      <header className="border-b border-slate-100 bg-white-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/lawyer/dashboard" className="font-display text-xl text-navy-900">
            Verified Counsel · Lawyer
          </Link>
          <nav className="flex items-center gap-3">
            <Link href="/lawyer/dashboard" className="text-sm text-slate-700 hover:text-navy-900">
              Dashboard
            </Link>
            <span className="text-xs text-slate-500 font-mono">{truncateAddress(address)}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
