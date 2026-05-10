import { PricingKind } from "@/lib/db/enums";
import { cn } from "@/lib/utils/cn";

const MAP: Record<PricingKind, { bg: string; fg: string; label: string }> = {
  HOURLY: { bg: "bg-white-50", fg: "text-slate-500", label: "Hourly" },
  FIXED: { bg: "bg-teal-50", fg: "text-teal-700", label: "Fixed packages" },
  SUBSCRIPTION: { bg: "bg-slate-50", fg: "text-navy-800", label: "Subscription" },
  SUCCESS: { bg: "bg-gold-100", fg: "text-gold-700", label: "No win, no fee" },
};

// Accepts `string` because the column is a plain TEXT in SQLite. Falls back to
// the HOURLY style for unknown values rather than throwing.
export function PricingBadge({ kind, className }: { kind: string; className?: string }) {
  const p = MAP[kind as PricingKind] ?? MAP.HOURLY;
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center rounded px-2 text-[10px] font-medium uppercase tracking-[0.04em]",
        p.bg,
        p.fg,
        className,
      )}
    >
      {p.label}
    </span>
  );
}
