import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { LawyerInvoiceForm } from "./invoice-form";

export const dynamic = "force-dynamic";

export default async function NewLawyerInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string; from?: string }>;
}) {
  const session = await requireLawyer();
  const sp = await searchParams;
  const profile = await prisma.lawyerProfile.findUnique({ where: { userId: session.user.id } });

  // Pre-populate the client picker with anyone the lawyer has had a booking with.
  const previous = profile
    ? await prisma.booking.findMany({
        where: { lawyerProfileId: profile.id },
        select: { client: { select: { id: true, name: true, walletAddress: true } } },
        distinct: ["clientId"],
        orderBy: { createdAt: "desc" },
      })
    : [];
  const knownClients = previous
    .map((b) => b.client)
    .filter((v, i, arr) => arr.findIndex((c) => c.id === v.id) === i);

  // If we arrived here from a chat thread, ?client=<wallet> pre-fills "Bill to".
  const incomingWallet = sp.client?.toLowerCase().trim() ?? "";
  const incomingClientName =
    knownClients.find((c) => c.walletAddress.toLowerCase() === incomingWallet)?.name ?? null;

  return (
    <div className="min-h-screen bg-white-50 pb-24">
      <AppTopBar user={session.user} active="requests" />
      <main className="mx-auto max-w-[1100px] px-6 py-10 lg:px-8">
        <Link
          href={sp.from ? `/lawyer/messages?booking=${encodeURIComponent(sp.from)}` : "/lawyer/dashboard"}
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> {sp.from ? "Back to chat" : "Dashboard"}
        </Link>
        <h1 className="font-display mt-6 text-3xl text-navy-900 sm:text-4xl">
          {incomingClientName ? `Send an invoice to ${incomingClientName}.` : "Send an invoice to a client."}
        </h1>
        <p className="mt-2 max-w-[640px] text-[15px] text-slate-500">
          Draft the line items and deliverables, sign the invoice, and the client gets a request to counter-sign. Funds
          only move into escrow once both parties have signed.
        </p>

        <div className="mt-8">
          <LawyerInvoiceForm
            knownClients={knownClients}
            defaultRatePerHour={Number(profile?.hourlyRateEUR ?? 0)}
            preselectedClientWallet={incomingWallet || undefined}
          />
        </div>
      </main>
    </div>
  );
}
