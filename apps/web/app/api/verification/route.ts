import { NextResponse } from "next/server";
import { z } from "zod";
import { PricingKind, Role, VerificationStatus } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { verifyLawyerCredentials } from "@/lib/web3/ebsi";
import { stringifyJson } from "@/lib/db/json-fields";

const SubmitSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email().optional(),
  city: z.string().min(1).max(60),
  headline: z.string().min(1).max(140),
  bio: z.string().min(20).max(2000),
  barRegistrationNum: z.string().min(1).max(60),
  barJurisdiction: z.string().min(1).max(120),
  jurisdictions: z.array(z.string().max(8)).min(1),
  admissionDate: z.string().min(4),
  specialties: z.array(z.string().max(60)).min(1),
  languages: z.array(z.string().max(40)).min(1),
  hourlyRateEUR: z.number().nonnegative(),
  pricingHeadline: z.string().min(1).max(60),
  pricingKind: z.nativeEnum(PricingKind),
  yearsExperience: z.number().int().nonnegative(),
  credentialDocsUrl: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = SubmitSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const v = parsed.data;

  await prisma.user.update({
    where: { id: me.id },
    data: { name: v.fullName, email: v.email },
  });

  const profile = await prisma.lawyerProfile.upsert({
    where: { userId: me.id },
    create: {
      userId: me.id,
      city: v.city,
      headline: v.headline,
      bio: v.bio,
      specialties: stringifyJson(v.specialties),
      languages: stringifyJson(v.languages),
      jurisdictions: stringifyJson(v.jurisdictions),
      pricingKind: v.pricingKind,
      pricingHeadline: v.pricingHeadline,
      hourlyRateEUR: v.hourlyRateEUR,
      consultationRate30: v.hourlyRateEUR / 2,
      consultationRate60: v.hourlyRateEUR,
      pricingItems: stringifyJson([]),
      yearsExperience: v.yearsExperience,
      verificationStatus: VerificationStatus.PENDING,
      barRegistrationNum: v.barRegistrationNum,
      barJurisdiction: v.barJurisdiction,
      admissionDate: new Date(v.admissionDate),
      credentialDocsUrl: stringifyJson(v.credentialDocsUrl),
      tags: stringifyJson(v.specialties.slice(0, 3)),
    },
    update: {
      city: v.city,
      headline: v.headline,
      bio: v.bio,
      specialties: stringifyJson(v.specialties),
      languages: stringifyJson(v.languages),
      jurisdictions: stringifyJson(v.jurisdictions),
      pricingKind: v.pricingKind,
      pricingHeadline: v.pricingHeadline,
      hourlyRateEUR: v.hourlyRateEUR,
      yearsExperience: v.yearsExperience,
      verificationStatus: VerificationStatus.PENDING,
      barRegistrationNum: v.barRegistrationNum,
      barJurisdiction: v.barJurisdiction,
      admissionDate: new Date(v.admissionDate),
      credentialDocsUrl: v.credentialDocsUrl.length ? stringifyJson(v.credentialDocsUrl) : undefined,
    },
  });

  // Dev-only auto-verify: simulates the EBSI 48h verification window.
  const autoSeconds = Number(process.env.DEV_AUTO_VERIFY_SECONDS);
  if (process.env.NODE_ENV !== "production" && autoSeconds > 0) {
    setTimeout(async () => {
      try {
        const result = await verifyLawyerCredentials({
          userId: me.id,
          barRegistrationNum: v.barRegistrationNum,
          jurisdiction: v.barJurisdiction,
        });
        await prisma.lawyerProfile.update({
          where: { id: profile.id },
          data: {
            verificationStatus: result.verified ? VerificationStatus.VERIFIED : VerificationStatus.REJECTED,
            ebsiCredentialId: result.ebsiCredentialId,
          },
        });
      } catch (err) {
        console.error("[dev-auto-verify] failed", err);
      }
    }, autoSeconds * 1000);
  }

  return NextResponse.json({ profile });
}

export async function GET() {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const profile = await prisma.lawyerProfile.findUnique({
    where: { userId: me.id },
  });
  return NextResponse.json({ profile });
}
