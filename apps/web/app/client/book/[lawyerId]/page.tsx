import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireClient } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { getAddresses, getChainId } from "@/lib/chain/addresses";
import { BookingForm } from "./booking-form";

export default async function BookConsultationPage({ params }: { params: Promise<{ lawyerId: string }> }) {
  const session = await requireClient();
  const { lawyerId } = await params;
  const lawyer = await prisma.lawyerProfile.findUnique({
    where: { id: lawyerId },
    include: { user: true },
  });
  if (!lawyer) notFound();

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="home" />
      <main className="mx-auto max-w-[1180px] px-6 py-10 lg:px-8">
      <Link href="/client/home" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to home
      </Link>
      <h1 className="font-display mt-6 text-3xl text-navy-900 sm:text-4xl">Book your consultation.</h1>
      <p className="mt-2 text-[15px] text-slate-500">
        Pick a time and we'll fund the smart-contract escrow. Funds release to {lawyer.user.name?.split(" ")[0] ?? "your lawyer"} only when the consultation is marked complete.
      </p>
      <div className="mt-8">
        <BookingForm
          lawyer={{
            id: lawyer.id,
            name: lawyer.user.name ?? "Lawyer",
            city: lawyer.city,
            specialty: lawyer.headline.split(" · ")[0],
            consultationRate30: Number(lawyer.consultationRate30),
            consultationRate60: Number(lawyer.consultationRate60),
            pricingHeadline: lawyer.pricingHeadline,
          }}
          escrowAddress={getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS}
          expectedChainId={getChainId()}
        />
      </div>
      </main>
    </div>
  );
}
