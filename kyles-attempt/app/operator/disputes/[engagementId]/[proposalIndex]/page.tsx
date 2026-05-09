import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { Badge } from "@/components/ui/badge";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { formatEUR, formatScheduled, truncateAddress } from "@/lib/utils/format";
import { anonymousClientId } from "@/lib/utils/anonymize";
import { lawyerVerificationFromCapability } from "@/lib/auth/capability";
import { ResolveForm } from "./resolve-form";

// =============================================================================
// /operator/disputes/[engagementId]/[proposalIndex] — F7
// -----------------------------------------------------------------------------
// Single-dispute detail with the resolve form. Server component (data
// load + render); the form itself is a client component for the live sum
// validation and the modal confirmation.
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

function truncateRoot(root: string): string {
  if (root.length < 14) return root;
  return `${root.slice(0, 10)}…${root.slice(-6)}`;
}

interface LineItem {
  id: string;
  title: string;
  description?: string;
  kind?: "hourly" | "fixed";
  hours?: number;
  ratePerHour?: number;
  fixedPrice?: number;
  subtotal?: number;
}

interface Deliverable {
  id: string;
  title: string;
  description?: string;
}

export default async function OperatorDisputeDetailPage({
  params,
}: {
  params: Promise<{ engagementId: string; proposalIndex: string }>;
}) {
  const { engagementId: engIdRaw, proposalIndex: propIdxRaw } = await params;
  const engagementId = Number(engIdRaw);
  const proposalIndex = Number(propIdxRaw);
  if (!Number.isInteger(engagementId) || engagementId < 1) notFound();
  if (!Number.isInteger(proposalIndex) || proposalIndex < 0) notFound();

  const engagement = await prisma.engagement.findUnique({
    where: { engagementId },
    include: { proposals: { orderBy: { proposalIndex: "asc" } } },
  });
  if (!engagement) notFound();

  const targetProposal = engagement.proposals.find((p) => p.proposalIndex === proposalIndex);
  if (!targetProposal) notFound();

  const [client, lawyer, booking, transcriptHistory] = await Promise.all([
    prisma.user.findUnique({ where: { id: engagement.clientUserId } }),
    prisma.user.findUnique({
      where: { id: engagement.lawyerUserId },
      include: { lawyerProfile: true },
    }),
    prisma.booking.findFirst({ where: { engagementId } }),
    prisma.transcriptRootHistory.findMany({
      where: { engagementId },
      orderBy: { blockNumber: "asc" },
    }),
  ]);

  const lawyerProfile = lawyer?.lawyerProfile ?? null;
  const lawyerVerification = lawyer
    ? await lawyerVerificationFromCapability(lawyer.walletAddress)
    : "PENDING";

  const isConsultation = booking != null && proposalIndex === booking.proposalIndex;
  const description = isConsultation
    ? booking!.caseDescription
    : `Follow-up proposal #${proposalIndex} on engagement #${engagementId}`;
  const amountEUR = Number(targetProposal.amountWei) / 100;
  const trigger = targetProposal.deliveredAt != null ? "lawyer_escalation" : "client_dispute";
  const isResolved = targetProposal.state === "RESOLVED";

  const lineItems: LineItem[] =
    isConsultation && booking && Array.isArray(booking.lineItems)
      ? (booking.lineItems as unknown as LineItem[])
      : [];
  const deliverables: Deliverable[] =
    isConsultation && booking && Array.isArray(booking.deliverables)
      ? (booking.deliverables as unknown as Deliverable[])
      : [];

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/operator/disputes"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          All disputes
        </Link>
      </div>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[12px] text-slate-500">
            <ShieldAlert className="h-3.5 w-3.5 text-amber-600" aria-hidden />
            <span className="font-mono uppercase tracking-[0.12em]">
              Engagement #{engagementId} · Proposal #{proposalIndex}
            </span>
            <span className="text-slate-200">·</span>
            <span>{trigger === "lawyer_escalation" ? "Lawyer escalation" : "Client dispute"}</span>
          </div>
          <h1 className="mt-2 font-display text-3xl text-navy-900 sm:text-4xl">
            {isConsultation && booking ? booking.practiceArea : "Follow-up proposal"} dispute
          </h1>
          <p className="mt-2 max-w-2xl text-[15px] text-slate-600">{description}</p>
        </div>
        <Badge kind={isResolved ? "success" : "pending"}>
          {isResolved ? "Resolved" : "Disputed"}
        </Badge>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-slate-100 bg-white-0 p-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
            Lawyer
          </div>
          <div className="mt-2 flex items-center gap-2 text-[15px] font-medium text-navy-900">
            {lawyer?.name ?? "—"}
            {lawyerVerification === "VERIFIED" && <EBSIBadge variant="small" />}
          </div>
          {lawyerProfile?.barRegistrationNum && (
            <div className="mt-1 text-[12px] text-slate-500">
              Bar: {lawyerProfile.barRegistrationNum}
            </div>
          )}
          {lawyerProfile?.barJurisdiction && (
            <div className="text-[12px] text-slate-500">{lawyerProfile.barJurisdiction}</div>
          )}
          {lawyer && (
            <div className="mt-2 font-mono text-[11px] text-slate-400">
              {truncateAddress(lawyer.walletAddress)}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-100 bg-white-0 p-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
            Client (pseudonymous)
          </div>
          <div className="mt-2 font-mono text-[15px] font-medium text-navy-900">
            Client {client ? anonymousClientId(client.walletAddress) : "—"}
          </div>
          <p className="mt-1 text-[12px] text-slate-500">
            Identity is masked at the operator surface — only the wallet hash
            tail is displayed. The lawyer's real name + bar number are visible
            because they are public registration data.
          </p>
        </div>

        <div className="rounded-xl border border-slate-100 bg-white-0 p-5">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
            Amount in escrow
          </div>
          <div className="mt-2 font-display text-3xl text-navy-900">
            {formatEUR(amountEUR)}
          </div>
          <div className="mt-2 text-[12px] text-slate-500">
            Disputed {relativeTime(targetProposal.updatedAt)}
            {targetProposal.deliveredAt && (
              <>
                {" "}· Delivered {relativeTime(targetProposal.deliveredAt)}
              </>
            )}
          </div>
          {isConsultation && booking && (
            <div className="mt-1 text-[12px] text-slate-500">
              Scheduled {formatScheduled(booking.scheduledAt)} · {booking.durationMinutes} min
            </div>
          )}
        </div>
      </section>

      {isConsultation && booking && (lineItems.length > 0 || deliverables.length > 0) && (
        <section className="rounded-xl border border-slate-100 bg-white-0 p-5">
          <h2 className="font-display text-xl text-navy-900">Invoice + deliverables</h2>
          {lineItems.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Line items
              </div>
              <ul className="mt-2 divide-y divide-slate-100">
                {lineItems.map((li) => (
                  <li key={li.id} className="flex items-start justify-between gap-4 py-2">
                    <div className="min-w-0">
                      <div className="text-[14px] font-medium text-navy-900">{li.title}</div>
                      {li.description && (
                        <div className="mt-0.5 text-[12px] text-slate-500">{li.description}</div>
                      )}
                    </div>
                    <div className="font-mono text-[13px] text-navy-900">
                      {formatEUR(li.subtotal ?? li.fixedPrice ?? 0)}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {deliverables.length > 0 && (
            <div className="mt-4">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                Deliverables
              </div>
              <ul className="mt-2 list-disc pl-6 text-[14px] text-navy-900">
                {deliverables.map((d) => (
                  <li key={d.id}>
                    {d.title}
                    {d.description && (
                      <span className="text-[12px] text-slate-500"> — {d.description}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <section className="rounded-xl border border-slate-100 bg-white-0 p-5">
        <h2 className="font-display text-xl text-navy-900">Engagement history</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Every proposal under engagement #{engagementId} and its current state.
        </p>
        <ul className="mt-4 divide-y divide-slate-100">
          {engagement.proposals.map((p) => {
            const eur = Number(p.amountWei) / 100;
            const splitInfo =
              p.state === "RESOLVED" && p.amountToLawyerWei && p.amountToClientWei
                ? `· ${formatEUR(Number(p.amountToLawyerWei) / 100)} → lawyer · ${formatEUR(Number(p.amountToClientWei) / 100)} → client`
                : "";
            const isCurrent = p.proposalIndex === proposalIndex;
            return (
              <li
                key={p.proposalIndex}
                className={`flex items-center justify-between gap-4 py-3 ${isCurrent ? "rounded-md bg-amber-50/50 px-2" : ""}`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[13px]">
                    <span className="font-mono text-navy-900">
                      Proposal #{p.proposalIndex}
                    </span>
                    {isCurrent && <Badge kind="pending">This dispute</Badge>}
                  </div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    {formatEUR(eur)} {splitInfo}
                  </div>
                </div>
                <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-slate-500">
                  {p.state.toLowerCase()}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-xl border border-slate-100 bg-white-0 p-5">
        <h2 className="font-display text-xl text-navy-900">Transcript root timeline</h2>
        <p className="mt-1 text-[13px] text-slate-500">
          Every TranscriptAnchored event for this engagement, in block order. The current
          root is highlighted.
        </p>
        {transcriptHistory.length === 0 ? (
          <p className="mt-4 text-[13px] text-slate-500">
            No transcript anchors recorded.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100">
            {transcriptHistory.map((t, idx) => {
              const isCurrent = t.root === engagement.transcriptRoot;
              return (
                <li key={`${t.blockNumber}-${idx}`} className="flex items-center justify-between gap-4 py-2">
                  <div>
                    <div className="font-mono text-[12px] text-navy-900">{truncateRoot(t.root)}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">
                      Block #{t.blockNumber} · {t.anchoredAt.toISOString()}
                    </div>
                  </div>
                  {isCurrent && <Badge kind="info">Current</Badge>}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {isResolved ? (
        <section className="rounded-xl border border-green-200 bg-green-50/40 p-5">
          <h2 className="font-display text-xl text-navy-900">Already resolved</h2>
          <p className="mt-2 text-[14px] text-slate-600">
            This proposal was resolved.
            {targetProposal.amountToLawyerWei && targetProposal.amountToClientWei && (
              <>
                {" "}{formatEUR(Number(targetProposal.amountToLawyerWei) / 100)} went to the
                lawyer, {formatEUR(Number(targetProposal.amountToClientWei) / 100)} to the
                client.
              </>
            )}
          </p>
        </section>
      ) : (
        <ResolveForm
          engagementId={engagementId}
          proposalIndex={proposalIndex}
          amountEUR={amountEUR}
          amountWei={targetProposal.amountWei}
        />
      )}
    </div>
  );
}
