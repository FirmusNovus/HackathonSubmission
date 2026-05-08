import { cn } from "@/lib/utils/cn";

type Status = "verified" | "pending" | "active" | "error" | "complete" | "neutral";

const PALETTE: Record<Status, string> = {
  verified: "bg-gold-100 text-gold-700",
  pending: "bg-amber-50 text-[#B7770F]",
  active: "bg-teal-50 text-teal-700",
  error: "bg-red-50 text-[#B62525]",
  complete: "bg-green-50 text-[#1A8A5C]",
  neutral: "bg-slate-50 text-slate-700",
};

const LABELS: Record<Status, string> = {
  verified: "Verified",
  pending: "Pending",
  active: "Active",
  error: "Error",
  complete: "Complete",
  neutral: "Status",
};

export function StatusPill({
  status,
  children,
  className,
}: {
  status: Status;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-medium uppercase tracking-[0.06em]",
        PALETTE[status],
        className,
      )}
    >
      {children ?? LABELS[status]}
    </span>
  );
}
