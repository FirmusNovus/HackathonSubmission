import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import { NewOrderForm } from "./new-order-form";

export default async function NewFollowUpOrderPage({
  searchParams,
}: {
  searchParams: Promise<{ engagement?: string }>;
}) {
  const session = await requireLawyer();
  const profile = await prisma.lawyerProfile.findUnique({ where: { userId: session.user.id } });
  if (!profile) {
    // Lawyers without a profile can't have engagements; bail with a friendly note.
    return (
      <div className="min-h-screen bg-white-50">
        <AppTopBar user={session.user} active="orders" />
        <main className="mx-auto max-w-[720px] px-6 py-10 lg:px-8">
          <p className="text-[15px] text-slate-700">Set up your profile before sending follow-up orders.</p>
        </main>
      </div>
    );
  }

  // Show only ACTIVE engagements — closed engagements can't take new orders
  // (chain enforces this via the EngagementState check on `fundMilestone`).
  const engagements = await prisma.engagement.findMany({
    where: { lawyerProfileId: profile.id, status: "ACTIVE" },
    include: { client: true, booking: true },
    orderBy: { openedAt: "desc" },
  });

  const sp = await searchParams;
  const initialEngagementId =
    sp.engagement && engagements.some((e) => e.id === sp.engagement) ? sp.engagement : "";

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="orders" />
      <main className="mx-auto max-w-[720px] px-6 py-10 lg:px-8">
        <Link
          href="/lawyer/dashboard"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Dashboard
        </Link>
        <h1 className="font-display mt-6 text-3xl text-navy-900 sm:text-4xl">Send a follow-up order.</h1>
        <p className="mt-2 text-[15px] text-slate-500">
          Pick the engagement, describe the work, set the price. The client gets prompted to fund it from their wallet.
        </p>

        {engagements.length === 0 ? (
          <div className="mt-8 rounded-xl border border-dashed border-slate-200 bg-white-0 p-8 text-center text-[14px] text-slate-500">
            <p>No active engagements yet.</p>
            <p className="mt-1.5 text-[13px]">
              A client has to book a consultation and fund the escrow first — the engagement opens then, and you can
              send follow-up orders against it.
            </p>
          </div>
        ) : (
          <NewOrderForm
            initialEngagementId={initialEngagementId}
            engagements={engagements.map((e) => ({
              id: e.id,
              engagementIdOnChain: e.engagementIdOnChain,
              clientName: e.client.name ?? e.client.walletAddress.slice(0, 10) + "…",
              practiceArea: e.booking?.practiceArea ?? "—",
              openedAt: e.openedAt.toISOString(),
            }))}
            escrowAddress={getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS}
            expectedChainId={getChainId()}
          />
        )}
      </main>
    </div>
  );
}
