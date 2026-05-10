import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { PricingKind, VerificationStatus } from "@/lib/db/enums";
import { parseStringArray } from "@/lib/db/json-fields";
import { prisma } from "@/lib/db/client";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim().toLowerCase();
  const practice = searchParams.getAll("practice");
  const langs = searchParams.getAll("lang");
  const pricingKinds = searchParams.getAll("pricing").filter((k): k is PricingKind => k in PricingKind);
  const minRate = numberOr(searchParams.get("minRate"), 0);
  const maxRate = numberOr(searchParams.get("maxRate"), 10_000);

  const where: Prisma.LawyerProfileWhereInput = {
    verificationStatus: VerificationStatus.VERIFIED,
    hourlyRateEUR: { gte: minRate, lte: maxRate },
  };
  if (pricingKinds.length) where.pricingKind = { in: pricingKinds };
  if (q)
    where.OR = [
      { headline: { contains: q } },
      { bio: { contains: q } },
      { user: { name: { contains: q } } },
    ];

  const lawyers = await prisma.lawyerProfile.findMany({
    where,
    include: { user: true },
    orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
  });

  // Array-membership filters are evaluated in JS because tags/languages are
  // stored as JSON-encoded TEXT in SQLite (no native `hasSome` support).
  const filtered = lawyers.filter((l) => {
    if (practice.length) {
      const tags = parseStringArray(l.tags);
      if (!practice.some((p) => tags.includes(p))) return false;
    }
    if (langs.length) {
      const languages = parseStringArray(l.languages);
      if (!langs.some((lang) => languages.includes(lang))) return false;
    }
    return true;
  });

  return NextResponse.json({ lawyers: filtered });
}

function numberOr(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
