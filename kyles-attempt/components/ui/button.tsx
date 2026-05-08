import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils/cn";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "bg-teal-500 text-white hover:bg-teal-600 active:bg-teal-700",
        outline: "border border-teal-500 text-teal-600 bg-transparent hover:bg-teal-50",
        ghost: "bg-transparent text-slate-700 hover:bg-slate-50",
        subtle: "bg-slate-50 text-slate-700 hover:bg-slate-100",
        danger: "bg-red-500 text-white hover:bg-red-500/90",
        nav: "bg-navy-900 text-white hover:bg-navy-800",
      },
      size: {
        sm: "h-9 px-3.5 text-[13px]",
        md: "h-11 px-5 text-[15px]",
        lg: "h-13 px-7 text-[17px]",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = "Button";

export { buttonVariants };
