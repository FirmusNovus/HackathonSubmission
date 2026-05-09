import { cn } from "@/lib/utils";

type Variant = "seal" | "inline" | "small";

const SIZES: Record<Variant, number> = { seal: 28, inline: 18, small: 12 };

interface EBSIBadgeProps {
  variant?: Variant;
  size?: number;
  label?: string;
  className?: string;
}

/** The muted-gold EBSI verification mark. seal = standalone, inline = with copy, small = badge corner. */
export function EBSIBadge({ variant = "inline", size, label, className }: EBSIBadgeProps) {
  const px = size ?? SIZES[variant];
  const id = `ebsi-grad-${px}`;
  const seal = (
    <svg width={px} height={px} viewBox="0 0 40 40" fill="none" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="40" y2="40">
          <stop offset="0" stopColor="#E0CD93" />
          <stop offset="1" stopColor="#9C7E3F" />
        </linearGradient>
      </defs>
      <circle cx="20" cy="20" r="18" fill={`url(#${id})`} />
      <circle cx="20" cy="20" r="14" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="0.75" />
      <circle cx="20" cy="20" r="11" fill="#C9A961" />
      <path
        d="M14 20 l4 4 l8 -8"
        stroke="#fff"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );

  if (variant === "seal") {
    return <span className={cn("inline-flex", className)}>{seal}</span>;
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[13px] font-medium text-gold-700",
        variant === "small" && "text-[11px]",
        className,
      )}
    >
      {seal}
      {label ?? "EBSI Verified"}
    </span>
  );
}
