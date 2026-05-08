// Owner spec: 001-verified-legal-engagement.

import { Lock, ShieldCheck, AlertTriangle, RefreshCw } from 'lucide-react';
import type { ProposalState } from '@/lib/db/proposals';

const ICON: Record<ProposalState, React.ReactElement> = {
  Issued: <Lock className="h-3.5 w-3.5" aria-hidden />,
  Funded: <Lock className="h-3.5 w-3.5" aria-hidden />,
  Delivered: <Lock className="h-3.5 w-3.5" aria-hidden />,
  Released: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
  Disputed: <AlertTriangle className="h-3.5 w-3.5" aria-hidden />,
  Resolved: <ShieldCheck className="h-3.5 w-3.5" aria-hidden />,
  Refunded: <RefreshCw className="h-3.5 w-3.5" aria-hidden />,
};

const COPY: Record<ProposalState, string> = {
  Issued: 'Awaiting funding',
  Funded: 'Secure payment held',
  Delivered: 'Marked delivered',
  Released: 'Released to counsel',
  Disputed: 'Under review',
  Resolved: 'Resolved',
  Refunded: 'Refunded to client',
};

export function EscrowStatusIndicator({ state }: { state: ProposalState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-slate-700">
      {ICON[state]}
      {COPY[state]}
    </span>
  );
}
