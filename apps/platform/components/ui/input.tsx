'use client';
// Owner spec: 001-verified-legal-engagement.

import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg border border-slate-100 bg-white-0 px-3 py-2 text-sm text-navy-900 placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      'flex min-h-24 w-full rounded-lg border border-slate-100 bg-white-0 px-3 py-2 text-sm text-navy-900 placeholder:text-slate-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
      className,
    )}
    {...props}
  />
));
Textarea.displayName = 'Textarea';
