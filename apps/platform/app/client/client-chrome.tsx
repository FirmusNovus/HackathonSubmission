// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { truncateAddress } from '@/lib/format/address';
import { LogoutButton } from '@/components/firmus/logout-button';

export function ClientChrome({ address, children }: { address: string; children: React.ReactNode }) {
  return (
    <div>
      <header className="border-b border-slate-100 bg-white-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/client/home" className="font-display text-xl text-navy-900">
            Verified Counsel · Client
          </Link>
          <nav className="flex items-center gap-3">
            <Link href="/client/home" className="text-sm text-slate-700 hover:text-navy-900">
              Home
            </Link>
            <Link href="/lawyers" className="text-sm text-slate-700 hover:text-navy-900">
              Find counsel
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
