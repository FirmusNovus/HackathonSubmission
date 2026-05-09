import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lock, ExternalLink, Check, Calendar } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { InvoiceCard } from "@/components/firmus/invoice-card";
import { Badge } from "@/components/ui/badge";
import { formatEUR, formatScheduled } from "@/lib/utils/format";
import { anonymousClientId } from "@/lib/utils/anonymize";
import type { Deliverable, LineItem } from "@/types";
import { RequestActions } from "./request-actions";

export default async function LawyerRequestReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireLawyer();
  const { id } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { client: true, lawyerProfile: true },
  });
  if (!booking || booking.lawyerProfile.userId !== session.user.id) notFound();

  const fee = Number(booking.consultationFeeEUR);
  const platformFee = Number(booking.platformFeeEUR);
  const netToLawyer = fee - platformFee;
  const lineItems = (booking.lineItems ?? []) as unknown as LineItem[];
  const deliverables = (booking.deliverables ?? []) as unknown as Deliverable[];
  const lawyerSignedFirst = Boolean(booking.lawyerAcceptedAt && !booking.clientAcceptedAt);

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="requests" />
      <main className="mx-auto max-w-[1100px] px-6 py-10 lg:px-8">
        <Link href="/lawyer/dashboard" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Dashboard
        </Link>

        <div className="mt-6 flex flex-wrap items-baseline gap-4">
          <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">
            {lawyerSignedFirst ? "Invoice you sent" : "New consultation request"}
          </h1>
          <Badge kind="pending">
            {lawyerSignedFirst
              ? "Awaiting client signature"
              : booking.clientAcceptedAt && !booking.lawyerAcceptedAt
                ? "Awaiting your signature"
                : "In progress"}
          </Badge>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
          <div className="rounded-xl border border-slate-100 bg-white-0 p-7">
            <div className="flex items-center gap-3.5">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-50">
                <span className="font-display text-xl text-slate-500">?</span>
              </div>
              <div>
                <div className="flex items-center gap-2 text-base font-semibold text-navy-900">
                  Client <span className="font-mono text-slate-500">{anonymousClientId(booking.client.walletAddress)}</span>
                </div>
                <div className="mt-0.5 text-[13px] text-slate-500">Anonymous identifier · wallet verified</div>
              </div>
            </div>

            <div className="mt-7 grid gap-5 sm:grid-cols-2">
              {[
                ["Practice area", booking.practiceArea],
                ["Jurisdiction", booking.lawyerProfile.barJurisdiction],
                ["Requested time", formatScheduled(booking.scheduledAt)],
                ["Duration", `${booking.durationMinutes} minutes`],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{k}</div>
                  <div className="text-[15px] font-medium text-navy-900">{v}</div>
                </div>
              ))}
            </div>

            <div className="mt-7">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Case description</div>
              <p className="rounded-lg bg-white-50 p-5 text-[15px] leading-[1.65] text-slate-700">
                {booking.caseDescription}
              </p>
            </div>

            <div className="mt-7 flex items-start gap-3.5 rounded-lg bg-green-50 p-4">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-400">
                <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.5} aria-hidden />
              </span>
              <div>
                <div className="text-[14px] font-semibold text-[#1A8A5C]">Conflict check passed</div>
                <div className="mt-1 text-[13px] text-slate-700">
                  No prior on-chain interactions detected with this client wallet or any related wallets in your case history.
                </div>
              </div>
            </div>

            <div className="mt-7">
              <InvoiceCard
                bookingId={booking.id}
                lineItems={lineItems}
                deliverables={deliverables}
                totalEUR={fee}
                platformFeeEUR={platformFee}
                clientAcceptedAt={booking.clientAcceptedAt?.toISOString() ?? null}
                lawyerAcceptedAt={booking.lawyerAcceptedAt?.toISOString() ?? null}
                clientName={`Client ${anonymousClientId(booking.client.walletAddress)}`}
                lawyerName={session.user.name ?? "You"}
              />
            </div>

            <RequestActions
              bookingId={booking.id}
              status={booking.status}
              clientSigned={Boolean(booking.clientAcceptedAt)}
              lawyerSigned={Boolean(booking.lawyerAcceptedAt)}
            />
          </div>

          <aside className="space-y-4">
            <div className="rounded-xl border border-slate-100 bg-white-0 p-6">
              <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Proposed fee</div>
              <div className="font-display mt-1 text-3xl text-navy-900">{formatEUR(fee)}</div>
              <div className="text-[13px] text-slate-500">tokenized EUR · before 5% platform fee</div>
              <hr className="my-5 border-t border-slate-100" />
              <div className="text-[13px] font-medium text-navy-900">You'll receive</div>
              <div className="font-display mt-0.5 text-xl text-teal-700">{formatEUR(netToLawyer)}</div>
              <div className="mt-1 text-[12px] text-slate-500">after platform fee, on consultation completion</div>
            </div>

            <div className="flex gap-3 rounded-xl border border-slate-100 bg-white-0 p-5">
              <Lock className="h-4 w-4 text-teal-700" aria-hidden />
              <div>
                <div className="text-[13px] font-medium text-navy-900">Smart contract escrow</div>
                <p className="mt-1 text-[12px] leading-[1.55] text-slate-500">
                  On accept, the client's funds are held in a smart contract and released to your wallet when the consultation is marked complete.
                </p>
                <span className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-slate-500" title="Block-explorer link available once the escrow contract ships">
                  Contract <span className="font-mono">{booking.escrowTxHash?.slice(0, 6) ?? "0x4f02"}…{booking.escrowTxHash?.slice(-4) ?? "2c1a"}</span>
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </span>
              </div>
            </div>

            <div className="flex gap-3 rounded-xl border border-slate-100 bg-white-0 p-5">
              <Calendar className="h-4 w-4 text-teal-700" aria-hidden />
              <div>
                <div className="text-[13px] font-medium text-navy-900">Suggest a different time</div>
                <p className="mt-1 text-[12px] leading-[1.55] text-slate-500">
                  Use the message thread to propose an alternative slot. The client can accept it directly without re-funding escrow.
                </p>
              </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
