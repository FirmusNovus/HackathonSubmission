import { NextResponse } from "next/server";
import { Prisma, PricingKind, VerificationStatus } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const practice = searchParams.getAll("practice");
  const langs = searchParams.getAll("lang");
  const pricingKinds = searchParams.getAll("pricing").filter((k): k is PricingKind => k in PricingKind);
  const minRate = numberOr(searchParams.get("minRate"), 0);
  const maxRate = numberOr(searchParams.get("maxRate"), 10_000);

  const where: Prisma.LawyerProfileWhereInput = {
    verificationStatus: VerificationStatus.VERIFIED,
    hourlyRateEUR: { gte: minRate, lte: maxRate },
  };
  if (practice.length) where.tags = { hasSome: practice };
  if (langs.length) where.languages = { hasSome: langs };
  if (pricingKinds.length) where.pricingKind = { in: pricingKinds };
  if (q)
    where.OR = [
      { headline: { contains: q, mode: "insensitive" } },
      { bio: { contains: q, mode: "insensitive" } },
      { user: { name: { contains: q, mode: "insensitive" } } },
    ];

  const lawyers = await prisma.lawyerProfile.findMany({
    where,
    include: { user: true },
    orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
  });

  return NextResponse.json({ lawyers });
}

function numberOr(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
