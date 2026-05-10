import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { parseStringArray } from "@/lib/db/json-fields";
import type { PricingKind, VerificationStatus } from "@/lib/db/enums";
import { ProfileEditor } from "./profile-editor";

export default async function ProfileEditPage() {
  const session = await requireLawyer();

  // Self-heal for users whose role is LAWYER (chain attestation present) but
  // who never got a LawyerProfile row written — happens to anyone onboarded
  // before lawyer/finalize started upserting a profile, and would otherwise
  // produce a loop (no profile → redirect /connect → /connect sees lawyer
  // attested → bounces to /lawyer/dashboard → empty state → Profile click
  // → here again). Create a placeholder row inline; the user fills in the
  // marketplace-only fields directly in the editor below.
  const profile = await prisma.lawyerProfile.upsert({
    where: { userId: session.user.id },
    update: {},
    create: {
      userId: session.user.id,
      city: "—",
      headline: "Licensed legal professional",
      bio: "Profile pending — edit to add specialties, languages, and hourly rate.",
      specialties: "[]",
      languages: "[]",
      jurisdictions: "[]",
      pricingKind: "HOURLY",
      pricingHeadline: "0.06 ETH / hr",
      hourlyRateEUR: 0.06,
      consultationRate30: 0.03,
      consultationRate60: 0.06,
      yearsExperience: 0,
      verificationStatus: "VERIFIED",
      barRegistrationNum: "—",
      barJurisdiction: "—",
      admissionDate: new Date(),
    },
  });

  // Read the User row directly — `session.user.name` comes from the JWT, which
  // is only updated on sign-in or via explicit `useSession().update()`. After
  // lawyer/finalize writes the bar-credential disclosed name to `User.name`,
  // the JWT still has the pre-onboarding null. The DB row is the source of
  // truth; trust it.
  const userRow = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { name: true },
  });

  return (
    <div className="min-h-screen bg-white-50 pb-24">
      <AppTopBar user={session.user} active="profile" />
      <main className="mx-auto max-w-[1280px] px-6 py-10 lg:px-8">
        <Link
          href="/lawyer/dashboard"
          className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-500 hover:text-navy-900"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Dashboard
        </Link>
        <h1 className="font-display mt-6 text-3xl text-navy-900 sm:text-4xl">Edit your profile.</h1>
        <ProfileEditor
          profile={{
            id: profile.id,
            headline: profile.headline,
            bio: profile.bio,
            specialties: parseStringArray(profile.specialties),
            languages: parseStringArray(profile.languages),
            jurisdictions: parseStringArray(profile.jurisdictions),
            verificationStatus: profile.verificationStatus as VerificationStatus,
            ebsiCredentialId: profile.ebsiCredentialId,
            barJurisdiction: profile.barJurisdiction,
            admissionDate: profile.admissionDate.toISOString(),
            pricingHeadline: profile.pricingHeadline,
            pricingKind: profile.pricingKind as PricingKind,
            hourlyRateEUR: Number(profile.hourlyRateEUR),
            user: { name: userRow?.name ?? session.user.name ?? "" },
          }}
        />
      </main>
    </div>
  );
}
