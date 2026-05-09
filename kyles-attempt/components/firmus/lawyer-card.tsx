import Link from "next/link";
import type { LawyerProfileWithUser } from "@/types";
import { AvatarBubble } from "./avatar-bubble";
import { PricingBadge } from "./pricing-badge";
import { Stars } from "./stars";
import { cn } from "@/lib/utils/cn";

interface LawyerCardProps {
  lawyer: Omit<LawyerProfileWithUser, "pricingItems">;
  compact?: boolean;
  className?: string;
}

export function LawyerCard({ lawyer, compact, className }: LawyerCardProps) {
  const verified = lawyer.verificationStatus === "VERIFIED";
  return (
    <Link
      href={`/lawyers/${lawyer.id}`}
      className={cn(
        "group block rounded-xl border border-slate-100 bg-white-0 transition-all hover:border-slate-200 hover:shadow-[var(--shadow-md)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500",
        compact ? "p-4" : "p-6",
        className,
      )}
    >
      <div className="flex items-start gap-4">
        <AvatarBubble name={lawyer.user.name ?? "Lawyer"} size={compact ? 52 : 64} verified={verified} />
        <div className="min-w-0 flex-1">
          <div className={cn("font-semibold text-navy-900", compact ? "text-[15px]" : "text-[17px]")}>
            {lawyer.user.name}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-slate-500">
            {lawyer.headline.split(" · ")[0]} · {lawyer.city}
          </div>
          <div className="mt-2 flex items-center gap-3">
            <Stars value={lawyer.rating} />
            <span className="text-slate-300">·</span>
            <span className="text-[13px] font-medium text-navy-900">{lawyer.pricingHeadline}</span>
          </div>
          <div className="mt-2">
            <PricingBadge kind={lawyer.pricingKind} />
          </div>
        </div>
      </div>
      {!compact && (
        <>
          <p className="mt-4 line-clamp-2 text-[14px] leading-[1.55] text-slate-500">{lawyer.bio.split(".")[0]}.</p>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex flex-wrap gap-1.5">
              {lawyer.tags.slice(0, 3).map((t) => (
                <span
                  key={t}
                  className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-medium text-slate-700"
                >
                  {t}
                </span>
              ))}
            </div>
            <span className="hidden text-[13px] font-medium text-teal-600 group-hover:underline sm:inline">
              View profile →
            </span>
          </div>
        </>
      )}
    </Link>
  );
}
