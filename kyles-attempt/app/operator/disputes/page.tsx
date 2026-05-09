import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { EmptyState } from "@/components/firmus/empty-state";
import { Badge } from "@/components/ui/badge";
import { formatEUR } from "@/lib/utils/format";
import { anonymousClientId } from "@/lib/utils/anonymize";

// =============================================================================
// /operator/disputes — F7
// -----------------------------------------------------------------------------
// Lists every Proposal currently in DISPUTED state. Server component so the
// data is fresh on every navigation; the resolve action lives on the detail
// page below.
// =============================================================================

function relativeTime(d: Date): string {
  const ms = Date.now() - d.getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

export default async function OperatorDisputesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = (await searchParams) ?? {};
  const justResolved = sp.resolved === "1";
  const resolvedToLawyer = typeof sp.toLawyer === "string" ? Number(sp.toLawyer) : null;
  const resolvedToClient = typeof sp.toClient === "string" ? Number(sp.toClient) : null;

  const disputed = await prisma.proposal.findMany({
    where: { state: "DISPUTED" },
    orderBy: { updatedAt: "desc" },
  });

  const engagementIds = Array.from(new Set(disputed.map((p) => p.engagementId)));
  const engagements = engagementIds.length
    ? await prisma.engagement.findMany({ where: { engagementId: { in: engagementIds } } })
    : [];
  const engagementById = new Map(engagements.map((e) => [e.engagementId, e]));

  const userIds = Array.from(
    new Set(engagements.flatMap((e) => [e.clientUserId, e.lawyerUserId])),
  );
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds } },
        include: { lawyerProfile: true },
      })
    : [];
  const userById = new Map(users.map((u) => [u.id, u]));

  const bookings = engagementIds.length
    ? await prisma.booking.findMany({ where: { engagementId: { in: engagementIds } } })
    : [];
  const bookingByEngagement = new Map(bookings.map((b) => [b.engagementId, b]));

  return (
    <div>
      <header className="mb-8">
        <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">Active disputes</h1>
        <p className="mt-2 max-w-2xl text-[15px] text-slate-500">
          Every proposal currently in <span className="font-mono">disputed</span> state. Review
          the case, the engagement history, and adjudicate the split. The amounts must sum
          exactly to the parked total.
        </p>
      </header>

      {justResolved && resolvedToLawyer != null && resolvedToClient != null && (
        <div
          data-testid="resolve-toast"
          className="mb-6 flex items-start gap-3 rounded-xl border border-green-200 bg-green-50/50 px-4 py-3"
        >
          <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#1A8A5C]" aria-hidden />
          <div className="text-[13px] text-navy-900">
            Dispute resolved — {formatEUR(resolvedToLawyer)} to lawyer,{" "}
            {formatEUR(resolvedToClient)} to client.
          </div>
        </div>
      )}

      {disputed.length === 0 ? (
        <EmptyState
          title="No active disputes."
          body="When a client or lawyer disputes a proposal, it shows up here for review."
          ctaLabel="Refresh"
          ctaHref="/operator/disputes"
        />
      ) : (
        <ul
          className="divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white-0"
          data-testid="dispute-list"
        >
          {disputed.map((p) => {
            const engagement = engagementById.get(p.engagementId);
            const client = engagement ? userById.get(engagement.clientUserId) : null;
            const lawyer = engagement ? userById.get(engagement.lawyerUserId) : null;
            const lawyerProfile = lawyer?.lawyerProfile;
            const booking = bookingByEngagement.get(p.engagementId);
            const isConsultation = booking != null && p.proposalIndex === booking.proposalIndex;
            const description = isConsultation
              ? booking!.caseDescription
              : `Follow-up proposal #${p.proposalIndex} on engagement #${p.engagementId}`;
            const amountEUR = Number(p.amountWei) / 100;
            const trigger = p.deliveredAt != null ? "lawyer escalation" : "client dispute";
            return (
              <li key={`${p.engagementId}-${p.proposalIndex}`}>
                <Link
                  href={`/operator/disputes/${p.engagementId}/${p.proposalIndex}`}
                  data-testid={`dispute-row-${p.engagementId}-${p.proposalIndex}`}
                  className="flex items-start justify-between gap-4 p-5 hover:bg-white-50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                      <span className="font-mono">
                        Engagement #{p.engagementId} · Proposal #{p.proposalIndex}
                      </span>
                      <span className="text-slate-200">·</span>
                      <span>{trigger}</span>
                      {client && (
                        <>
                          <span className="text-slate-200">·</span>
                          <span className="font-mono">
                            Client {anonymousClientId(client.walletAddress)}
                          </span>
                        </>
                      )}
                      {lawyer && (
                        <>
                          <span className="text-slate-200">·</span>
                          <span>
                            {lawyer.name ?? "Lawyer"}
                            {lawyerProfile?.barRegistrationNum
                              ? ` · ${lawyerProfile.barRegistrationNum}`
                              : ""}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="mt-1 line-clamp-1 text-[15px] font-medium text-navy-900">
                      {description}
                    </div>
                    <div className="mt-1.5 text-[12px] text-slate-500">
                      {formatEUR(amountEUR)} parked · disputed {relativeTime(p.updatedAt)}
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge kind="pending">Disputed</Badge>
                    <span className="inline-flex items-center gap-1 text-[13px] font-medium text-teal-600">
                      Review
                      <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
