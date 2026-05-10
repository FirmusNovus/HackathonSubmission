import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { BookingStatus, Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { getCurrentUser } from "@/lib/auth/session";
import { publicClient } from "@/lib/chain/clients";
import { getAddresses } from "@/lib/chain/addresses";
import { parseReleasedReceipt } from "@/lib/web3/escrow";
import { publishBookingChanged } from "@/lib/events/realtime";

export const runtime = "nodejs";

/**
 * Confirm an on-chain `releaseMilestone` tx submitted by the client's wallet.
 * Symmetric to /api/bookings/[id]/funded — only the client can release
 * (msg.sender == client gate in the contract), so the server's job is to
 * verify the receipt and write `escrowReleaseHash` + advance the booking
 * to COMPLETED. Phase 6 funded milestone 0 only; we hard-code that here.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const me = await getCurrentUser();
  if (!me || me.role !== Role.CLIENT) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { txHash?: string };
  const txHash = body.txHash;
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: "Invalid txHash" }, { status: 400 });
  }

  const booking = await prisma.booking.findUnique({
    where: { id },
    include: { engagement: true },
  });
  if (!booking) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (booking.clientId !== me.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (booking.escrowReleaseHash) {
    return NextResponse.json({ booking }); // idempotent
  }
  if (!booking.engagement) {
    return NextResponse.json(
      { error: "Booking has no on-chain engagement — fund first." },
      { status: 409 },
    );
  }
  if (booking.status !== BookingStatus.ACCEPTED) {
    return NextResponse.json(
      { error: `Booking status is ${booking.status} — release expects ACCEPTED.` },
      { status: 409 },
    );
  }

  const receipt = await publicClient
    .waitForTransactionReceipt({ hash: txHash as Hex })
    .catch(() => null);
  if (!receipt) {
    return NextResponse.json({ error: "Tx receipt unavailable — is the chain reachable?" }, { status: 502 });
  }
  if (receipt.status !== "success") {
    return NextResponse.json({ error: "Release tx reverted on chain." }, { status: 400 });
  }

  const escrow = getAddresses().LEGAL_ENGAGEMENT_ESCROW_ADDRESS.toLowerCase();
  if (receipt.to?.toLowerCase() !== escrow) {
    return NextResponse.json(
      { error: `Tx target ${receipt.to} is not the escrow contract.` },
      { status: 400 },
    );
  }

  let parsed;
  try {
    parsed = parseReleasedReceipt(receipt.logs);
  } catch (e) {
    return NextResponse.json(
      { error: `Could not parse release event: ${(e as Error).message}` },
      { status: 400 },
    );
  }

  if (Number(parsed.engagementId) !== booking.engagement.engagementIdOnChain) {
    return NextResponse.json(
      {
        error: `Release engagementId ${parsed.engagementId} does not match this booking's engagement ${booking.engagement.engagementIdOnChain}.`,
      },
      { status: 400 },
    );
  }
  // Booking releases are always for milestone 0 (the consultation). Follow-up
  // orders use POST /api/orders/[id]/released for milestones 1+.
  if (parsed.milestoneIndex !== 0n) {
    return NextResponse.json(
      { error: `Booking release expects milestone 0; got ${parsed.milestoneIndex}.` },
      { status: 400 },
    );
  }

  const updated = await prisma.booking.update({
    where: { id },
    data: {
      status: BookingStatus.COMPLETED,
      escrowReleaseHash: txHash,
    },
  });

  publishBookingChanged(id);
  return NextResponse.json({ booking: updated });
}
