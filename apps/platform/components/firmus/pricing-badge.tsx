// Owner spec: 001-verified-legal-engagement.

import { cn } from '@/lib/utils';

interface Props {
  consultationKind: 'FREE' | 'PAID';
  pricingHeadline?: string;
  className?: string;
}

export function PricingBadge({ consultationKind, pricingHeadline, className }: Props) {
  if (consultationKind === 'FREE') {
    return (
      <span className={cn('inline-flex items-center rounded-pill bg-green-50 px-2.5 py-0.5 text-xs font-medium text-teal-700', className)}>
        Free initial consultation
      </span>
    );
  }
  return (
    <span className={cn('inline-flex items-center rounded-pill bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-700', className)}>
      {pricingHeadline ?? 'Paid consultation'}
    </span>
  );
}
