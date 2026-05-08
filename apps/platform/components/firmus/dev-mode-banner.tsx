// Owner spec: 001-verified-legal-engagement.
// FR-D03: persistent gold banner whenever DEV_BYPASS_EUDI=1.

import { ShieldAlert } from 'lucide-react';

export function DevModeBanner() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-center gap-2 border-t border-gold-500 bg-gold-100 px-4 py-2 text-sm text-gold-700 shadow-md">
      <ShieldAlert className="h-4 w-4" aria-hidden />
      <span className="font-medium">
        Dev mode — credential checks bypassed. Do not deploy to production.
      </span>
    </div>
  );
}
