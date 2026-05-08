'use client';
// Owner spec: 001-verified-legal-engagement.

import { useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  attestationUid: string;
  walletAddress: string;
  /** Async live check; if omitted the badge surfaces only the static UID. */
  onCheck?: () => Promise<boolean>;
}

export function EbsiBadge({ attestationUid, walletAddress, onCheck }: Props) {
  const [open, setOpen] = useState(false);
  const [live, setLive] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleClick() {
    setOpen(true);
    if (onCheck) {
      setLoading(true);
      try {
        const ok = await onCheck();
        setLive(ok);
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 rounded-pill bg-gold-100 px-2.5 py-1 text-xs font-medium text-gold-700 hover:opacity-90"
      >
        <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
        Verified · {attestationUid.slice(0, 10)}…
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-10 mt-2 w-72 rounded-lg border border-slate-100 bg-white-0 p-3 shadow-md text-xs text-slate-700">
          <div className="font-medium text-navy-900">Capability attestation</div>
          <div className="mt-1 break-all font-mono text-[11px]">{attestationUid}</div>
          <div className="mt-2 break-all font-mono text-[11px] text-slate-500">{walletAddress}</div>
          {onCheck ? (
            <div className="mt-2">
              {loading ? (
                <span className="text-slate-500">Checking on chain…</span>
              ) : live === true ? (
                <span className="text-teal-700">Active on chain.</span>
              ) : live === false ? (
                <span className="text-red-500">No active attestation.</span>
              ) : null}
            </div>
          ) : null}
          <div className="mt-2">
            <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
