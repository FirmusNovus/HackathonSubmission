import { NextResponse } from "next/server";
import { z } from "zod";
import { VerificationStatus } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { verifyLawyerCredentials } from "@/lib/web3/ebsi";

// Admin-only manual trigger to flip a lawyer's verification status.
// Protected by the ADMIN_API_KEY env var. There is no admin UI in the MVP.

const Schema = z.object({
  lawyerProfileId: z.string().min(1),
  status: z.nativeEnum(VerificationStatus).optional(),
});

export async function POST(request: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return NextResponse.json({ error: "Admin key not configured" }, { status: 500 });
  const got = request.headers.get("x-admin-key");
  if (got !== expected) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const profile = await prisma.lawyerProfile.findUnique({
    where: { id: parsed.data.lawyerProfileId },
  });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const status = parsed.data.status ?? VerificationStatus.VERIFIED;
  let ebsiCredentialId = profile.ebsiCredentialId;
  if (status === VerificationStatus.VERIFIED && !ebsiCredentialId) {
    const result = await verifyLawyerCredentials({
      userId: profile.userId,
      barRegistrationNum: profile.barRegistrationNum,
      jurisdiction: profile.barJurisdiction,
    });
    ebsiCredentialId = result.ebsiCredentialId;
  }
  const updated = await prisma.lawyerProfile.update({
    where: { id: profile.id },
    data: { verificationStatus: status, ebsiCredentialId },
  });
  return NextResponse.json({ profile: updated });
}
