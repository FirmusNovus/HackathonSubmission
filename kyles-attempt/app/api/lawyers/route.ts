import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { PricingKind } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { containsValue, expandLawyerProfile } from "@/lib/db/json-array";
import { SCHEMA_LAWYER } from "@/lib/chain/schemas";

// =============================================================================
// GET /api/lawyers — public directory.
// -----------------------------------------------------------------------------
// F2: the WHERE clause is now "has an active SCHEMA_LAWYER capability"
// rather than `verificationStatus = "VERIFIED"`. We resolve the set of
// verified wallet addresses up front (one Prisma query against `Capability`)
// and then filter `LawyerProfile` rows whose `user.walletAddress` is in
// that set. Lawyers without an active capability — including ones the
// operator REVOKED — are invisible in the directory.
// =============================================================================

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim();
  const practice = searchParams.getAll("practice");
  const langs = searchParams.getAll("lang");
  const pricingKinds = searchParams.getAll("pricing").filter((k): k is PricingKind => k in PricingKind);
  const minRate = numberOr(searchParams.get("minRate"), 0);
  const maxRate = numberOr(searchParams.get("maxRate"), 10_000);

  // Resolve the set of currently-verified lawyer wallets. Mirrors the F1
  // mock-chain `getLatestCapability` semantics: unrevoked + (no expiry OR
  // expiry in the future).
  const now = new Date();
  const activeCaps = await prisma.capability.findMany({
    where: {
      schemaId: SCHEMA_LAWYER,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { subjectAddress: true },
  });
  const verifiedWallets = activeCaps.map((c) => c.subjectAddress);
  if (verifiedWallets.length === 0) return NextResponse.json({ lawyers: [] });

  // SQLite stores `tags` / `languages` as JSON-encoded strings, so array
  // membership becomes a substring match against the quoted value (see
  // lib/db/json-array.ts). `hasSome` becomes an OR over per-value matches.
  const ANDs: Prisma.LawyerProfileWhereInput[] = [];
  if (practice.length) ANDs.push({ OR: practice.map((p) => ({ tags: containsValue(p) })) });
  if (langs.length) ANDs.push({ OR: langs.map((l) => ({ languages: containsValue(l) })) });

  const where: Prisma.LawyerProfileWhereInput = {
    user: { walletAddress: { in: verifiedWallets } },
    hourlyRateEUR: { gte: minRate, lte: maxRate },
    ...(ANDs.length ? { AND: ANDs } : {}),
  };
  if (pricingKinds.length) where.pricingKind = { in: pricingKinds };
  // SQLite's LIKE is case-insensitive for ASCII by default, so dropping
  // `mode: "insensitive"` (Postgres-only) preserves the search behavior.
  if (q)
    where.OR = [
      { headline: { contains: q } },
      { bio: { contains: q } },
      { user: { name: { contains: q } } },
    ];

  const rows = await prisma.lawyerProfile.findMany({
    where,
    include: { user: true },
    orderBy: [{ rating: "desc" }, { reviewCount: "desc" }],
  });
  const lawyers = rows.map((l) => ({ ...expandLawyerProfile(l), user: l.user }));

  return NextResponse.json({ lawyers });
}

function numberOr(value: string | null, fallback: number): number {
  if (!value) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}
