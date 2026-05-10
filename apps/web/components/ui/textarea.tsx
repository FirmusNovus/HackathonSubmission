import * as React from "react";
import { cn } from "@/lib/utils/cn";

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "min-h-[120px] w-full rounded-lg border border-slate-100 bg-white-0 px-3.5 py-3 text-[15px] leading-relaxed text-navy-900 placeholder:text-slate-300 transition-colors focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-50 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";
