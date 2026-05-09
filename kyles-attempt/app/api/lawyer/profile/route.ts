import { NextResponse } from "next/server";
import { z } from "zod";
import { PricingKind, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { stringifyStrArray } from "@/lib/db/json-array";
import { getCurrentUser } from "@/lib/auth/session";

// PATCH endpoint for lawyer-side profile edits. Only the fields a lawyer can change
// post-verification are exposed here — bar registration / admission date are immutable
// from this surface (they require re-running EBSI verification).

const PatchSchema = z.object({
  headline: z.string().min(4).max(140).optional(),
  bio: z.string().min(20).max(2000).optional(),
  specialties: z.array(z.string().max(60)).optional(),
  languages: z.array(z.string().max(40)).optional(),
  jurisdictions: z.array(z.string().max(8)).optional(),
  pricingKind: z.nativeEnum(PricingKind).optional(),
  pricingHeadline: z.string().min(2).max(60).optional(),
  hourlyRateEUR: z.number().nonnegative().optional(),
});

export async function PATCH(request: Request) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const parsed = PatchSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }

  const profile = await prisma.lawyerProfile.findUnique({ where: { userId: me.id } });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const { specialties, languages, jurisdictions, ...rest } = parsed.data;
  const updated = await prisma.lawyerProfile.update({
    where: { id: profile.id },
    data: {
      ...rest,
      ...(specialties ? { specialties: stringifyStrArray(specialties), tags: stringifyStrArray(specialties.slice(0, 3)) } : {}),
      ...(languages ? { languages: stringifyStrArray(languages) } : {}),
      ...(jurisdictions ? { jurisdictions: stringifyStrArray(jurisdictions) } : {}),
    },
  });
  return NextResponse.json({ profile: updated });
}
