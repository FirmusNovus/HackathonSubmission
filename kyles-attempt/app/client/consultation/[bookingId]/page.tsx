import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { requireClient } from "@/lib/auth/session";
import { ConsultationRoom } from "./consultation-room";

export default async function ClientConsultationPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const session = await requireClient();
  const { bookingId } = await params;
  const booking = await prisma.booking.findFirst({
    where: { id: bookingId, clientId: session.user.id },
    include: { lawyerProfile: { include: { user: true } }, conversation: { include: { messages: true } } },
  });
  if (!booking) notFound();

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
      role="client"
      currentUser={{ id: session.user.id, name: session.user.name ?? "You", role: "CLIENT" }}
      lawyerName={booking.lawyerProfile.user.name ?? "Lawyer"}
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
