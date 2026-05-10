import Link from "next/link";
import { AlertTriangle, ScrollText } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireOperator } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { Badge } from "@/components/ui/badge";
import { OperatorMessagingEnroll } from "@/components/firmus/operator-messaging-enroll";
import { formatETH, truncateAddress } from "@/lib/utils/format";

/**
 * Operator dashboard. The operator wallet (the address derived from
 * OPERATOR_PRIVATE_KEY) is detected at SIWE-time and pinned to
 * Role.OPERATOR — they don't go through PID/bar onboarding. From here
 * the operator can:
 *
 *   • Review open disputes and resolve them by calling the contract's
 *     `resolveDispute(eid, msIdx, toLawyer, toClient)` from the operator
 *     wallet.
 *   • See an at-a-glance view of every Engagement on the platform — useful
 *     for support / debugging when something looks off.
 *
 * Note: there is no "pending lawyer verifications" queue. Lawyers self-onboard
 * end-to-end via EUDI bar-credential disclosure → on-chain attestation; the
 * profile lands in VERIFIED state with no operator approval step.
 */
export default async function AdminDashboardPage() {
  const session = await requireOperator();

  const [disputedBookings, disputedOrders, engagements] = await Promise.all([
    prisma.booking.findMany({
      where: { status: "DISPUTED" },
      include: { client: true, lawyerProfile: { include: { user: true } }, engagement: true },
      orderBy: { disputedAt: "desc" },
    }),
    prisma.order.findMany({
      where: { status: "DISPUTED" },
      include: { engagement: { include: { client: true, lawyerProfile: { include: { user: true } } } } },
      orderBy: { disputedAt: "desc" },
    }),
    prisma.engagement.findMany({
      include: {
        client: true,
        lawyerProfile: { include: { user: true } },
        booking: true,
        orders: true,
      },
      orderBy: { openedAt: "desc" },
      take: 50,
    }),
  ]);

  const totalDisputes = disputedBookings.length + disputedOrders.length;

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="dashboard" />
      <main className="mx-auto max-w-[1100px] px-6 py-10 lg:px-8">
        <h1 className="font-display text-3xl text-navy-900">Operator dashboard</h1>
        <p className="mt-2 text-[14px] text-slate-500">
          Signed in as <code className="font-mono text-[12px]">{truncateAddress(session.user.walletAddress)}</code>{" "}
          — platform operator.
        </p>

        <OperatorMessagingEnroll />

        {/* Disputes — top of mind because they're the only thing that needs the operator to act on chain. */}
        <section className="mt-8">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 text-amber-600" aria-hidden /> Open disputes
            </h2>
            <Badge kind={totalDisputes > 0 ? "error" : "neutral"}>{totalDisputes}</Badge>
          </div>
          {totalDisputes === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-6 text-center text-[13px] text-slate-500">
              No open disputes.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white-0">
              {disputedBookings.map((b) => (
                <li key={`b-${b.id}`} className="p-4">
                  <Link href={`/admin/disputes/booking/${b.id}`} className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[14px] font-semibold text-navy-900">
                        Consultation · {b.lawyerProfile.user.name ?? "Lawyer"} ↔{" "}
                        {b.client.name ?? truncateAddress(b.client.walletAddress)}
                      </div>
                      <div className="mt-0.5 text-[12px] text-slate-500">
                        {b.practiceArea} · opened by {b.disputeOpenedBy?.toLowerCase() ?? "?"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[14px] font-medium text-navy-900">
                        {formatETH(Number(b.consultationFeeEUR))}
                      </div>
                      <Badge kind="error">disputed</Badge>
                    </div>
                  </Link>
                </li>
              ))}
              {disputedOrders.map((o) => (
                <li key={`o-${o.id}`} className="p-4">
                  <Link href={`/admin/disputes/order/${o.id}`} className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-[14px] font-semibold text-navy-900">
                        Follow-up · {o.engagement.lawyerProfile.user.name ?? "Lawyer"} ↔{" "}
                        {o.engagement.client.name ?? truncateAddress(o.engagement.client.walletAddress)}
                      </div>
                      <div className="mt-0.5 line-clamp-1 text-[12px] text-slate-500">{o.description}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[14px] font-medium text-navy-900">{formatETH(Number(o.amountETH))}</div>
                      <Badge kind="error">disputed</Badge>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Engagement index — read-only at-a-glance view of platform state. */}
        <section className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <ScrollText className="mr-1.5 inline h-3.5 w-3.5 text-slate-500" aria-hidden /> Recent engagements
            </h2>
            <span className="text-[12px] text-slate-500">{engagements.length} most recent</span>
          </div>
          {engagements.length === 0 ? (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-6 text-center text-[13px] text-slate-500">
              No engagements yet.
            </p>
          ) : (
            <ul className="mt-3 divide-y divide-slate-100 rounded-2xl border border-slate-100 bg-white-0">
              {engagements.map((e) => (
                <li key={e.id} className="flex items-start justify-between gap-3 p-4">
                  <div>
                    <div className="text-[14px] font-semibold text-navy-900">
                      {e.lawyerProfile.user.name ?? "Lawyer"} ↔{" "}
                      {e.client.name ?? truncateAddress(e.client.walletAddress)}
                    </div>
                    <div className="mt-0.5 text-[12px] text-slate-500">
                      Chain id #{e.engagementIdOnChain} · {e.booking?.practiceArea ?? "—"} ·{" "}
                      {e.orders.length} follow-up{e.orders.length === 1 ? "" : "s"}
                    </div>
                  </div>
                  <Badge kind={e.status === "ACTIVE" ? "info" : "neutral"}>{e.status.toLowerCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
