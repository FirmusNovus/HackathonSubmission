import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { operatorAddress } from "@/lib/chain/clients";

export const runtime = "nodejs";

/**
 * Returns the platform operator's enrolled X25519 messaging pubkey, used
 * by parties in a dispute to encrypt their conversation archive to the
 * arbiter. Public on purpose — pubkeys aren't secret. We look up by
 * operator wallet address (env-derived) rather than role to be robust
 * against the operator User row being created lazily on first SIWE.
 */
export async function GET() {
  const wallet = operatorAddress().toLowerCase();
  const op = await prisma.user.findUnique({
    where: { walletAddress: wallet },
    select: { id: true, encryptionPublicKey: true, role: true },
  });
  if (!op || op.role !== Role.OPERATOR) {
    return NextResponse.json(
      { error: "Operator account not yet provisioned. The operator wallet has to sign in once first." },
      { status: 503 },
    );
  }
  if (!op.encryptionPublicKey) {
    return NextResponse.json(
      { error: "Operator hasn't enrolled a messaging key yet." },
      { status: 503 },
    );
  }
  return NextResponse.json({
    operatorUserId: op.id,
    encryptionPublicKey: op.encryptionPublicKey,
  });
}
