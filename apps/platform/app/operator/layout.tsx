// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { requireOperator } from '@/lib/auth/require-role';
import { LogoutButton } from '@/components/firmus/logout-button';
import { truncateAddress } from '@/lib/format/address';

export default async function OperatorLayout({ children }: { children: React.ReactNode }) {
  const session = await requireOperator();
  return (
    <div>
      <header className="border-b border-slate-100 bg-white-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/operator/disputes" className="font-display text-xl text-navy-900">
            Verified Counsel · Operator
          </Link>
          <nav className="flex items-center gap-3">
            <Link href="/operator/disputes" className="text-sm text-slate-700 hover:text-navy-900">
              Disputes
            </Link>
            <span className="text-xs text-slate-500 font-mono">{truncateAddress(session.address)}</span>
            <LogoutButton />
          </nav>
        </div>
      </header>
      {children}
    </div>
  );
}
