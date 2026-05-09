import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  title: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  icon?: React.ReactNode;
  className?: string;
}

export function EmptyState({ title, body, ctaLabel, ctaHref, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-white p-12 text-center",
        className,
      )}
    >
      {icon && <div className="text-slate-300">{icon}</div>}
      <h3 className="font-display text-2xl text-navy-900">{title}</h3>
      {body && <p className="max-w-md text-[14px] leading-relaxed text-slate-500">{body}</p>}
      {ctaLabel && ctaHref && (
        <Button asChild className="mt-2 bg-teal-500 text-white hover:bg-teal-600">
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      )}
    </div>
  );
}
