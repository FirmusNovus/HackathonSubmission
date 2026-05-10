import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-[11px] font-medium uppercase tracking-[0.06em]",
  {
    variants: {
      kind: {
        verified: "bg-gold-100 text-gold-700",
        success: "bg-green-50 text-[#1A8A5C]",
        pending: "bg-amber-50 text-[#B7770F]",
        error: "bg-red-50 text-[#B62525]",
        info: "bg-teal-50 text-teal-700",
        neutral: "bg-slate-50 text-slate-700",
      },
    },
    defaultVariants: { kind: "info" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ kind, className, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ kind }), className)} {...props} />;
}
