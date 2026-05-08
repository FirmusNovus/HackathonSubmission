// Owner spec: 001-verified-legal-engagement.
// FR-060.

import { CloudOff } from 'lucide-react';

export function ChainUnavailableBanner() {
  return (
    <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-500 bg-amber-50 px-4 py-3 text-sm text-slate-900">
      <CloudOff className="h-4 w-4" aria-hidden />
      <span>Secure payment network is temporarily unavailable — please try again in a moment.</span>
    </div>
  );
}
