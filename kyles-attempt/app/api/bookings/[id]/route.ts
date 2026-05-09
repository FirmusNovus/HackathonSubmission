import { NextResponse } from "next/server";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

// GET a single booking. The booking is visible to the client who owns it and the
// lawyer it's been routed to. Resolves the user fresh by walletAddress so the
// caller's session survives a database reseed.
//
// F3: also expand the linked Engagement + Proposal so the UI can render
// proposal-state-aware affordances (Mark Delivered button, Funds-in-escrow
// badge, Released banner). The expanded shape matches A's parallel route at
// `apps/platform/app/api/engagements/[requestId]/route.ts`.
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, name: true, walletAddress: true } },
      lawyerProfile: { include: { user: { select: { id: true, name: true, walletAddress: true } } } },
      conversation: { select: { id: true } },
    },
  });

  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isClient = booking.client.id === me.id;
  const isLawyer = booking.lawyerProfile.user.id === me.id;
  if (me.role === Role.CLIENT && !isClient) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (me.role === Role.LAWYER && !isLawyer) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // F3: expand engagement + proposal if the booking is on chain. Both shapes
  // are flat enough that the UI can pluck the right fields without an extra
  // round-trip.
  let engagement: {
    id: number;
    state: string;
    proposalCount: number;
    transcriptRoot: string;
    openedAt: string;
    closedAt: string | null;
  } | null = null;
  let proposal: {
    state: string;
    proposalIndex: number;
    deliveredAt: string | null;
    amountWei: string;
    fundTxHash: string;
    deliverTxHash: string | null;
    releaseTxHash: string | null;
    disputeTxHash: string | null;
    refundTxHash: string | null;
  } | null = null;

  if (booking.engagementId != null) {
    const eng = await prisma.engagement.findUnique({
      where: { engagementId: booking.engagementId },
      include: {
        proposals: { where: { proposalIndex: booking.proposalIndex } },
      },
    });
    if (eng) {
      engagement = {
        id: eng.engagementId,
        state: eng.state,
        proposalCount: eng.proposalCount,
        transcriptRoot: eng.transcriptRoot,
        openedAt: eng.openedAt.toISOString(),
        closedAt: eng.closedAt ? eng.closedAt.toISOString() : null,
      };
      const p = eng.proposals[0];
      if (p) {
        proposal = {
          state: p.state,
          proposalIndex: p.proposalIndex,
          deliveredAt: p.deliveredAt ? p.deliveredAt.toISOString() : null,
          amountWei: p.amountWei,
          fundTxHash: p.fundTxHash,
          deliverTxHash: p.deliverTxHash,
          releaseTxHash: p.releaseTxHash,
          disputeTxHash: p.disputeTxHash,
          refundTxHash: p.refundTxHash,
        };
      }
    }
  }

  return NextResponse.json({ booking, engagement, proposal });
}
