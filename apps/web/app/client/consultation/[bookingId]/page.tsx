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
      }}
      conversationId={booking.conversation?.id ?? null}
    />
  );
}
