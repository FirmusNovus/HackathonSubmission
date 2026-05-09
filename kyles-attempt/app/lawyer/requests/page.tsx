import Link from "next/link";
import { BookingStatus } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { EmptyState } from "@/components/firmus/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatEUR, formatScheduled } from "@/lib/utils/format";
import { anonymousClientId } from "@/lib/utils/anonymize";

export default async function LawyerRequestsListPage() {
  const session = await requireLawyer();
  const profile = await prisma.lawyerProfile.findUnique({ where: { userId: session.user.id } });
  const requests = profile
    ? await prisma.booking.findMany({
        where: { lawyerProfileId: profile.id, status: BookingStatus.REQUESTED },
        include: { client: true },
        orderBy: { createdAt: "desc" },
      })
    : [];

  // F3: pull the proposal state for each request (the on-chain mirror of the
  // Funded escrow). Cheaper to do one batch query than N+1; the route is
  // already lightweight so this stays well under our render budget.
  const engagementIds = requests
    .map((r) => r.engagementId)
    .filter((x): x is number => x != null);
  const proposalRows = engagementIds.length
    ? await prisma.proposal.findMany({
        where: { engagementId: { in: engagementIds }, proposalIndex: 0 },
      })
    : [];
  const proposalByEngagement = new Map(proposalRows.map((p) => [p.engagementId, p]));

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="requests" />
      <main className="mx-auto max-w-[1080px] px-6 py-10 lg:px-8">
        <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">Pending requests</h1>
        <p className="mt-2 text-[15px] text-slate-500">Review and respond to consultation requests from prospective clients.</p>

        {requests.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="All caught up."
              body="New consultation requests show here. You'll also get a dot on the dashboard."
              ctaLabel="Back to dashboard"
              ctaHref="/lawyer/dashboard"
            />
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white-0">
            {requests.map((r) => {
              const proposal = r.engagementId != null ? proposalByEngagement.get(r.engagementId) : undefined;
              const proposalState = proposal?.state ?? null;
              return (
                <li key={r.id}>
                  <Link href={`/lawyer/requests/${r.id}`} className="flex items-start justify-between gap-4 p-5 hover:bg-white-50">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span>{r.practiceArea}</span>
                        <span className="text-slate-200">·</span>
                        <span className="font-mono">{anonymousClientId(r.client.walletAddress)}</span>
                        {proposalState && (
                          <>
                            <span className="text-slate-200">·</span>
                            <span className="font-mono uppercase tracking-wider">
                              proposal: {proposalState.toLowerCase()}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-1 line-clamp-1 text-[15px] font-medium text-navy-900">{r.caseDescription}</div>
                      <div className="mt-1.5 text-[12px] text-slate-500">
                        {formatScheduled(r.scheduledAt)} · {r.durationMinutes} min · {formatEUR(Number(r.consultationFeeEUR))}
                        {proposal && proposalState === "FUNDED" && (
                          <span className="ml-2 font-medium text-teal-700">· Funds in escrow</span>
                        )}
                      </div>
                    </div>
                    <Badge kind="pending">Review</Badge>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
