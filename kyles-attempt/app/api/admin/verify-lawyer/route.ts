import { NextResponse } from "next/server";
import { z } from "zod";
import { VerificationStatus } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { verifyLawyerCredentials } from "@/lib/web3/ebsi";
import {
  attestVerifiedLawyer,
  getLatestCapability,
  OPERATOR_ADDRESS,
  revokeCapability,
} from "@/lib/chain/escrow";
import { SCHEMA_LAWYER, type LawyerClaims } from "@/lib/chain/schemas";
import { chainErrorToHttp, isChainError } from "@/lib/chain/errors";

// Admin-only manual trigger to flip a lawyer's verification status. The F2
// rewrite makes the capability the source of truth: VERIFY mints a
// SCHEMA_LAWYER capability via the mock chain, REVOKE invalidates it. The
// `verificationStatus` column is also updated so the UI's badge stays
// consistent without a separate read path.
//
// Protected by the ADMIN_API_KEY env var. There is no admin UI in the MVP.

const Schema = z
  .object({
    lawyerProfileId: z.string().min(1).optional(),
    walletAddress: z.string().min(1).optional(),
    action: z.enum(["VERIFY", "REJECT", "REVOKE"]).optional(),
    // Legacy F1 shape — keep accepting it. Maps onto VERIFY/REJECT.
    status: z.nativeEnum(VerificationStatus).optional(),
  })
  .refine((d) => d.lawyerProfileId || d.walletAddress, {
    message: "lawyerProfileId or walletAddress required",
  });

export async function POST(request: Request) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return NextResponse.json({ error: "Admin key not configured" }, { status: 500 });
  const got = request.headers.get("x-admin-key");
  if (got !== expected) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsed = Schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const profile = parsed.data.lawyerProfileId
    ? await prisma.lawyerProfile.findUnique({
        where: { id: parsed.data.lawyerProfileId },
        include: { user: true },
      })
    : await prisma.lawyerProfile.findFirst({
        where: { user: { walletAddress: parsed.data.walletAddress!.toLowerCase() } },
        include: { user: true },
      });
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Resolve the action. Legacy callers passed `status`; the F2 contract
  // is `action`. If neither is present, default to VERIFY (the F1 default).
  const action: "VERIFY" | "REJECT" | "REVOKE" =
    parsed.data.action ??
    (parsed.data.status === VerificationStatus.REJECTED
      ? "REJECT"
      : parsed.data.status === VerificationStatus.REVOKED
        ? "REVOKE"
        : "VERIFY");

  try {
    if (action === "VERIFY") {
      // Build the LawyerClaims JSON from profile fields. F4 will replace this
      // with a real EBSI presentation; for now we fabricate from the form
      // data we already have on the profile.
      const claims: LawyerClaims = {
        jurisdiction: profile.barJurisdiction,
        barAdmissionNumber: profile.barRegistrationNum,
        admittedAt: profile.admissionDate.toISOString(),
        validUntil: null,
      };
      const { uid } = await attestVerifiedLawyer({
        subject: profile.user.walletAddress,
        claims: claims as unknown as Record<string, unknown>,
        from: OPERATOR_ADDRESS,
        expiresAt: null,
      });
      let ebsiCredentialId = profile.ebsiCredentialId;
      if (!ebsiCredentialId) {
        const result = await verifyLawyerCredentials({
          userId: profile.userId,
          barRegistrationNum: profile.barRegistrationNum,
          jurisdiction: profile.barJurisdiction,
        });
        ebsiCredentialId = result.ebsiCredentialId;
      }
      const updated = await prisma.lawyerProfile.update({
        where: { id: profile.id },
        data: {
          verificationStatus: VerificationStatus.VERIFIED,
          ebsiCredentialId,
          capabilityUid: uid,
        },
      });
      return NextResponse.json({ profile: updated, capabilityUid: uid });
    }

    if (action === "REVOKE") {
      // Find the latest active capability for this lawyer and revoke it.
      const cap = await getLatestCapability(profile.user.walletAddress, SCHEMA_LAWYER);
      if (cap) {
        await revokeCapability({ uid: cap.attestationUid, from: OPERATOR_ADDRESS });
      }
      const updated = await prisma.lawyerProfile.update({
        where: { id: profile.id },
        data: {
          verificationStatus: VerificationStatus.REVOKED,
          capabilityUid: null,
        },
      });
      return NextResponse.json({ profile: updated });
    }

    // REJECT — flip the column only, no capability minted.
    const updated = await prisma.lawyerProfile.update({
      where: { id: profile.id },
      data: { verificationStatus: VerificationStatus.REJECTED },
    });
    return NextResponse.json({ profile: updated });
  } catch (err) {
    if (isChainError(err)) {
      const { status, body } = chainErrorToHttp(err);
      return NextResponse.json(body, { status });
    }
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
