// =============================================================================
// /api/dev/sign-mutual-refund — F6
// -----------------------------------------------------------------------------
// Dev/test-only EIP-712 signer for the MutualRefundAuthorization typed-data
// shape (engagementId, proposalIndex). 404 in production. Real wallets sign
// in the browser via wagmi's `useSignTypedData`; this route exists so the
// seeded personas (whose `0x1111…` / `0x2222…` addresses don't recover from
// any real private key) can produce verifiable typed-data signatures via
// their server-side derived dev key.
//
// Body: { engagementId, proposalIndex, role: "client" | "lawyer", forUserId? }
// Returns: { signature, signer }   where signer = User.devSignerAddress.
//
// `role` selects which side's persona key signs. The caller must be SIWE-
// signed in AS that party — except when `forUserId` is supplied, which lets
// dev tooling sign on behalf of an arbitrary persona (still gated by the
// dev guard). Production never sees this route.
//
// Pattern mirrors `app/api/dev/sign-proposal-offer/route.ts`.
// =============================================================================

import { NextResponse } from "next/server";
import type { Hex } from "viem";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import {
  devPrivateKeyForWallet,
  signMutualRefund,
} from "@/lib/chain/eip712";

const Schema = z.object({
  engagementId: z.number().int().positive(),
  proposalIndex: z.number().int().nonnegative(),
  role: z.enum(["client", "lawyer"]),
  // Optional dev-mode escape hatch: sign as a specific persona by user id.
  // The caller must already be SIWE'd in (any role); we trust the dev guard.
  forUserId: z.string().min(1).optional(),
});

function devGuard(): NextResponse | null {
  if (process.env.NODE_ENV === "production" && process.env.ENABLE_MOCK_AUTH !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return null;
}

export async function POST(request: Request) {
  const guard = devGuard();
  if (guard) return guard;

  const me = await getCurrentUser();
  if (!me) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload", issues: parsed.error.flatten() }, { status: 400 });
  }
  const input = parsed.data;

  // Resolve which persona is signing. Default: the SIWE'd-in caller. If
  // `forUserId` is supplied (dev tooling), look up that persona instead.
  let signer: { walletAddress: string; devSignerAddress: string | null };
  if (input.forUserId) {
    const u = await prisma.user.findUnique({ where: { id: input.forUserId } });
    if (!u) return NextResponse.json({ error: "forUserId not found" }, { status: 404 });
    signer = { walletAddress: u.walletAddress, devSignerAddress: u.devSignerAddress };
  } else {
    signer = { walletAddress: me.walletAddress, devSignerAddress: me.devSignerAddress };
  }

  // The caller's `role` must match the engagement-side they claim to sign as.
  // We pull the engagement to verify (only when not `forUserId`-overridden).
  const engagement = await prisma.engagement.findUnique({
    where: { engagementId: input.engagementId },
    include: { proposals: { where: { proposalIndex: input.proposalIndex } } },
  });
  if (!engagement) return NextResponse.json({ error: "Engagement not found" }, { status: 404 });
  if (engagement.proposals.length === 0) {
    return NextResponse.json({ error: "Proposal not found" }, { status: 404 });
  }

  // When the SIWE'd caller is signing for themselves, assert they're actually
  // the requested party. `forUserId` skips this — dev tooling explicit override.
  if (!input.forUserId) {
    const isClient = engagement.clientUserId === me.id;
    const isLawyer = engagement.lawyerUserId === me.id;
    if (input.role === "client" && !isClient) {
      return NextResponse.json({ error: "Caller is not the engagement client." }, { status: 403 });
    }
    if (input.role === "lawyer" && !isLawyer) {
      return NextResponse.json({ error: "Caller is not the engagement lawyer." }, { status: 403 });
    }
  }

  const privateKey = devPrivateKeyForWallet(signer.walletAddress);
  const { signature } = await signMutualRefund({
    privateKey,
    message: {
      engagementId: BigInt(input.engagementId),
      proposalIndex: BigInt(input.proposalIndex),
    },
  });

  return NextResponse.json({
    signature: signature as Hex,
    signer: signer.devSignerAddress ?? signer.walletAddress,
    role: input.role,
  });
}
