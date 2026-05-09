import { NextResponse } from "next/server";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";

/**
 * Lawyer confirms a client-initiated invoice. F3 update — escrow is ALREADY
 * funded at this point (the client funded `Proposal[0]` at booking-creation
 * time via `openEngagementAndFundFirstProposal`), so this handler is a pure
 * UX confirmation. No chain mutation happens here.
 *
 * Why no on-chain accept? System A's `LegalEngagementEscrow.sol` doesn't
 * expose a "lawyer accept" action — the engagement is simply open the moment
 * the client funds it, and the lawyer's first action is `markDelivered`.
 * Lawyer accept is a B-side UX layer (it gates the consultation room before
 * the meeting). The contract treats Funded as fully active.
 *
 * Lawyer-initiated invoices follow the symmetric path: the LAWYER drafts,
 * the CLIENT signs via `/sign` (which today still calls a stub `createEscrow`
 * — F4/F6 unify that path with this one). For F3 we leave that route alone.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.LAWYER) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { lawyerProfile: true, client: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.lawyerProfile.userId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!booking.clientAcceptedAt) {
    return NextResponse.json(
      { error: "Client has not signed this invoice — cannot accept yet." },
      { status: 409 },
    );
  }

  // Pure status flip; the chain is already open + funded.
  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status: BookingStatus.ACCEPTED,
      lawyerAcceptedAt: new Date(),
    },
  });
  return NextResponse.json({ booking: updated });
}
