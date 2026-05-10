import Link from "next/link";
import { Calendar, Check, MessageSquare, Video } from "lucide-react";
import { prisma } from "@/lib/db/client";
import type { BookingStatus } from "@/lib/db/enums";
import { requireClient } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/firmus/empty-state";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { formatETH, formatScheduled } from "@/lib/utils/format";
import { isJoinableNow, joinabilityReason } from "@/lib/utils/booking";
import { orderPhase, orderPhaseLabel } from "@/lib/utils/order-phase";

export const dynamic = "force-dynamic";

// One consistent button label across every phase — the phase pill communicates
// what's pending; the case-detail page is where any pending action is taken.
const MANAGE_CTA_LABEL = "Manage case";

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ "just-booked"?: string }>;
}) {
  const session = await requireClient();
  const sp = await searchParams;
  const justBooked = sp["just-booked"];

  const bookings = await prisma.booking.findMany({
    where: { clientId: session.user.id },
    include: { lawyerProfile: { include: { user: true } }, engagement: true },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="cases" />
      <main className="mx-auto max-w-[1080px] px-6 py-10 lg:px-8">
        <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">Your cases</h1>
        <p className="mt-2 text-[15px] text-slate-500">
          Approve orders to fund escrow, then release funds when your lawyer's work is done.
        </p>

        {justBooked && bookings.some((b) => b.id === justBooked) && (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50 p-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-500 text-white">
              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
            </span>
            <div className="text-[14px] leading-[1.55] text-navy-900">
              <strong className="font-semibold">Booking sent.</strong>{" "}
              <span className="text-slate-700">
                The lawyer will review and either accept or decline. If they accept, you'll be prompted to fund the
                escrow from your wallet — funds only lock on chain after that signature.
              </span>
            </div>
          </div>
        )}

        {bookings.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              title="No cases yet."
              body="Find a verified lawyer to book your first consultation."
              ctaLabel="Browse directory"
              ctaHref="/lawyers"
            />
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white-0">
            {bookings.map((b) => {
              const phase = orderPhase({
                status: b.status as BookingStatus,
                clientAcceptedAt: b.clientAcceptedAt?.toISOString() ?? null,
                lawyerAcceptedAt: b.lawyerAcceptedAt?.toISOString() ?? null,
                totalEUR: Number(b.consultationFeeEUR),
                escrowReleaseHash: b.escrowReleaseHash,
                engagementIdOnChain: b.engagement?.engagementIdOnChain ?? null,
              });
              const phaseInfo = orderPhaseLabel(phase);
              const joinable = isJoinableNow(b.status, b.scheduledAt, b.durationMinutes);
              const reason = joinabilityReason(b.status, b.scheduledAt);
              const isActionable =
                phase === "awaiting-client" || phase === "awaiting-funding" || phase === "in-escrow";
              const lawyerName = b.lawyerProfile.user.name ?? "Lawyer";
              return (
                <li key={b.id} className="grid items-center gap-4 p-5 sm:grid-cols-[40px_1fr_auto]">
                  <AvatarBubble name={lawyerName} size={40} verified />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-navy-900">{lawyerName}</span>
                      <Badge kind={phaseInfo.kind}>{phaseInfo.label}</Badge>
                    </div>
                    <div className="mt-1 text-[13px] text-slate-500">
                      {b.practiceArea} · {b.lawyerProfile.city} · {formatScheduled(b.scheduledAt)} ·{" "}
                      {b.durationMinutes} min · {formatETH(Number(b.consultationFeeEUR))}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-500">
                      <Calendar className="h-3 w-3" aria-hidden />
                      {reason}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button asChild variant={isActionable ? "primary" : "outline"} size="sm">
                      <Link href={`/client/cases/${b.id}`}>{MANAGE_CTA_LABEL}</Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/client/messages?booking=${b.id}`}>
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Messages
                      </Link>
                    </Button>
                    {joinable && (
                      <Button asChild size="sm">
                        <Link href={`/client/consultation/${b.id}`}>
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
