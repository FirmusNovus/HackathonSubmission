// Owner spec: 001-verified-legal-engagement.

import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  value: number;
  reviewCount?: number;
  className?: string;
}

export function Stars({ value, reviewCount, className }: Props) {
  const filled = Math.round(value);
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs text-slate-700', className)}>
      <span className="inline-flex">
        {Array.from({ length: 5 }).map((_, i) => (
          <Star
            key={i}
            className={cn('h-3.5 w-3.5', i < filled ? 'fill-gold-500 text-gold-500' : 'text-slate-300')}
            aria-hidden
          />
        ))}
      </span>
      <span>{value.toFixed(1)}</span>
      {typeof reviewCount === 'number' ? <span className="text-slate-500">({reviewCount})</span> : null}
    </span>
  );
}
