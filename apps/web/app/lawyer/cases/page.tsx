import Link from "next/link";
import { Calendar, MessageSquare, Video } from "lucide-react";
import { BookingStatus } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/firmus/empty-state";
import { formatETH, formatScheduled } from "@/lib/utils/format";
import { isJoinableNow, joinabilityReason } from "@/lib/utils/booking";
import { anonymousClientId } from "@/lib/utils/anonymize";

export const dynamic = "force-dynamic";

const STATUS_KIND: Record<string, "info" | "success" | "neutral" | "error"> = {
  ACCEPTED: "info",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
  DISPUTED: "error",
};

const STATUS_LABEL: Record<string, string> = {
  ACCEPTED: "Funds in escrow",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  DISPUTED: "Disputed",
};

/**
 * Post-signing work for the lawyer. Pending orders awaiting the lawyer's
 * signature live on /lawyer/orders — once both parties sign, the case appears
 * here. Detail page reuses /lawyer/orders/[id] which shows the right
 * informational state for any non-pending status.
 */
export default async function LawyerCasesListPage() {
  const session = await requireLawyer();
  const profile = await prisma.lawyerProfile.findUnique({ where: { userId: session.user.id } });
  const cases = profile
    ? await prisma.booking.findMany({
        where: {
          lawyerProfileId: profile.id,
          status: {
            in: [
              BookingStatus.ACCEPTED,
              BookingStatus.IN_PROGRESS,
              BookingStatus.COMPLETED,
              BookingStatus.CANCELLED,
              BookingStatus.DISPUTED,
            ],
          },
        },
        include: { client: true },
        orderBy: { scheduledAt: "desc" },
      })
    : [];

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="cases" />
      <main className="mx-auto max-w-[1080px] px-6 py-10 lg:px-8">
        <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">Your cases</h1>
        <p className="mt-2 text-[15px] text-slate-500">
          Active and completed work. Orders awaiting your signature live in{" "}
          <Link href="/lawyer/orders" className="font-medium text-teal-600 hover:underline">
            Orders
          </Link>
          .
        </p>

        {cases.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              title="No active cases yet."
              body="Once you sign an order from a client, it'll show up here as an active case."
              ctaLabel="Review pending orders"
              ctaHref="/lawyer/orders"
            />
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white-0">
            {cases.map((b) => {
              const joinable = isJoinableNow(b.status, b.scheduledAt, b.durationMinutes);
              const reason = joinabilityReason(b.status, b.scheduledAt);
              const fee = Number(b.consultationFeeEUR);
              const platformFee = Number(b.platformFeeEUR);
              const netToLawyer = fee - platformFee;
              const status = b.status as keyof typeof STATUS_LABEL;
              return (
                <li key={b.id} className="grid items-center gap-4 p-5 sm:grid-cols-[1fr_auto]">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-navy-900">
                        {b.client.name ?? (
                          <>
                            Client <span className="font-mono text-slate-500">{anonymousClientId(b.client.walletAddress)}</span>
                          </>
                        )}
                      </span>
                      <Badge kind={STATUS_KIND[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status.toLowerCase()}</Badge>
                    </div>
                    <div className="mt-1 line-clamp-1 text-[14px] text-navy-900">{b.caseDescription}</div>
                    <div className="mt-1 text-[13px] text-slate-500">
                      {b.practiceArea} · {formatScheduled(b.scheduledAt)} · {b.durationMinutes} min · {formatETH(fee)}{" "}
                      <span className="text-slate-400">(net {formatETH(netToLawyer)})</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-500">
                      <Calendar className="h-3 w-3" aria-hidden />
                      {reason}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/lawyer/orders/${b.id}`}>Manage case</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/lawyer/messages?booking=${b.id}`}>
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Messages
                      </Link>
                    </Button>
                    {joinable && (
                      <Button asChild size="sm">
                        <Link href={`/lawyer/consultation/${b.id}`}>
                          <Video className="h-3.5 w-3.5" aria-hidden /> Join
                        </Link>
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
