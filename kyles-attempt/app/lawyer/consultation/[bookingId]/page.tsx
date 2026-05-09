import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { requireLawyerForExistingBooking } from "@/lib/auth/session";
import { ConsultationRoom } from "@/app/client/consultation/[bookingId]/consultation-room";

// F2: role-only gate. A lawyer whose SCHEMA_LAWYER capability has been REVOKED
// must still be able to attend a consultation for a booking that was funded
// before the revoke — the AttestationManager + LegalEngagementEscrow contracts
// only gate `openEngagement*` on capability; in-flight engagement state lives
// on. Booking ownership is enforced below via the lawyerProfile.userId check.
export default async function LawyerConsultationPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const session = await requireLawyerForExistingBooking();
  const { bookingId } = await params;
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      client: true,
      lawyerProfile: true,
      conversation: { include: { messages: true } },
    },
  });
  if (!booking || booking.lawyerProfile.userId !== session.user.id) notFound();

  // F3: pull the linked Engagement + Proposal for the room's right-rail.
  const engagementRow =
    booking.engagementId != null
      ? await prisma.engagement.findUnique({
          where: { engagementId: booking.engagementId },
          include: { proposals: { where: { proposalIndex: booking.proposalIndex } } },
        })
      : null;
  const engagement = engagementRow
    ? {
        id: engagementRow.engagementId,
        state: engagementRow.state,
        proposalCount: engagementRow.proposalCount,
        transcriptRoot: engagementRow.transcriptRoot,
      }
    : null;
  const proposalRow = engagementRow?.proposals[0] ?? null;
  const proposal = proposalRow
    ? {
        state: proposalRow.state,
        deliveredAt: proposalRow.deliveredAt ? proposalRow.deliveredAt.toISOString() : null,
        amountWei: proposalRow.amountWei,
      }
    : null;

  return (
    <ConsultationRoom
      role="lawyer"
      currentUser={{ id: session.user.id, name: session.user.name ?? "You", role: "LAWYER" }}
      lawyerName={session.user.name ?? "You"}
      booking={{
        id: booking.id,
        practiceArea: booking.practiceArea,
        scheduledAt: booking.scheduledAt.toISOString(),
        durationMinutes: booking.durationMinutes,
        consultationFeeEUR: Number(booking.consultationFeeEUR),
        status: booking.status,
      }}
      conversationId={booking.conversation?.id ?? null}
      engagement={engagement}
      proposal={proposal}
    />
  );
}
