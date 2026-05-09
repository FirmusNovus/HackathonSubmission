import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { expandLawyerProfile } from "@/lib/db/json-array";
import { hasVerifiedCapability } from "@/lib/auth/capability";
import { SCHEMA_LAWYER } from "@/lib/chain/schemas";

// =============================================================================
// GET /api/lawyers/[id] — single lawyer profile.
// -----------------------------------------------------------------------------
// F2: returns 404 if the lawyer has no active SCHEMA_LAWYER capability (e.g.
// REVOKED or never minted). Mirrors A's `notFound()` after the capability
// check in `apps/platform/app/lawyers/[id]/page.tsx` — the public surface
// shouldn't admit revoked lawyers exist.
// =============================================================================

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const row = await prisma.lawyerProfile.findUnique({
    where: { id },
    include: { user: true },
  });
  if (!row) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const ok = await hasVerifiedCapability(row.user.walletAddress, SCHEMA_LAWYER);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const lawyer = { ...expandLawyerProfile(row), user: row.user };
  return NextResponse.json({ lawyer });
}
