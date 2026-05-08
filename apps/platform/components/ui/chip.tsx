'use client';
// Owner spec: 001-verified-legal-engagement.

import * as React from 'react';
import { cn } from '@/lib/utils';

interface ChipProps extends React.HTMLAttributes<HTMLSpanElement> {
  active?: boolean;
}

export function Chip({ className, active = false, ...props }: ChipProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm px-2.5 py-0.5 text-xs font-medium transition-colors',
        active
          ? 'bg-teal-100 text-teal-700'
          : 'bg-slate-50 text-slate-700 hover:bg-slate-100',
        className,
      )}
      {...props}
    />
  );
}
