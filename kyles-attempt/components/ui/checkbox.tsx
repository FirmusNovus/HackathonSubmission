"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils/cn";

export const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border border-slate-200 bg-white-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-teal-500 data-[state=checked]:bg-teal-500",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className="text-white">
      <Check className="h-3 w-3" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;
