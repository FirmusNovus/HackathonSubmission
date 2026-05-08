"use client";

import * as React from "react";
import { cn } from "@/lib/utils/cn";

interface ChipProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
}

export const Chip = React.forwardRef<HTMLButtonElement, ChipProps>(
  ({ className, active, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-medium transition-colors",
        active
          ? "border-navy-900 bg-navy-900 text-white"
          : "border-slate-100 bg-white-0 text-slate-700 hover:border-slate-300",
        className,
      )}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";
