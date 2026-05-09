import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { ConsultationRoom } from "@/app/client/consultation/[bookingId]/consultation-room";

export default async function LawyerConsultationPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const session = await requireLawyer();
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
      }}
      conversationId={booking.conversation?.id ?? null}
    />
  );
}
