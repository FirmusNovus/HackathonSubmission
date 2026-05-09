import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { expandLawyerProfile } from "@/lib/db/json-array";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { ProfileEditor } from "./profile-editor";

export default async function ProfileEditPage() {
  const session = await requireLawyer();
  const row = await prisma.lawyerProfile.findUnique({ where: { userId: session.user.id } });
  if (!row) redirect("/verify-lawyer");
  const profile = expandLawyerProfile(row);

  return (
    <div className="min-h-screen bg-white-50 pb-24">
      <AppTopBar user={session.user} active="profile" />
      <main className="mx-auto max-w-[1280px] px-6 py-10 lg:px-8">
        <Link href="/lawyer/dashboard" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Dashboard
        </Link>
        <h1 className="font-display mt-6 text-3xl text-navy-900 sm:text-4xl">Edit your profile.</h1>
        <ProfileEditor
          profile={{
            id: profile.id,
            headline: profile.headline,
            bio: profile.bio,
            specialties: profile.specialties,
            languages: profile.languages,
            jurisdictions: profile.jurisdictions,
            verificationStatus: profile.verificationStatus,
            ebsiCredentialId: profile.ebsiCredentialId,
            barJurisdiction: profile.barJurisdiction,
            admissionDate: profile.admissionDate.toISOString(),
            pricingHeadline: profile.pricingHeadline,
            pricingKind: profile.pricingKind,
            hourlyRateEUR: Number(profile.hourlyRateEUR),
            user: { name: session.user.name ?? "" },
          }}
        />
      </main>
    </div>
  );
}
