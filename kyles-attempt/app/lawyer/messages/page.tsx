import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { MessagesView } from "@/app/client/messages/messages-view";

export const dynamic = "force-dynamic";

export default async function LawyerMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const session = await requireLawyer();
  const sp = await searchParams;
  const conversations = await prisma.conversation.findMany({
    where: { participants: { some: { id: session.user.id } } },
    include: {
      booking: { include: { client: true, lawyerProfile: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
    orderBy: { updatedAt: "desc" },
  });

  let activeId: string | null = null;
  if (sp.booking) {
    const c = conversations.find((c) => c.bookingId === sp.booking);
    if (c) activeId = c.id;
  }
  if (!activeId && conversations[0]) activeId = conversations[0].id;

  if (!conversations.length) {
    return (
      <div className="min-h-screen bg-white-50">
        <AppTopBar user={session.user} active="messages" />
        <div className="mx-auto max-w-[600px] px-6 py-20 text-center">
          <h1 className="font-display text-3xl text-navy-900">No messages yet.</h1>
          <p className="mt-3 text-[15px] text-slate-500">When a client books with you, a thread opens here.</p>
        </div>
      </div>
    );
  }

  if (!activeId) redirect("/lawyer/dashboard");

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="messages" />
      <MessagesView
        currentUserId={session.user.id}
        currentUserRole={Role.LAWYER}
        threads={conversations.map((c) => ({
          id: c.id,
          counterpartyName:
            c.booking?.client.name ?? `Client ${c.booking?.client.walletAddress.slice(2, 4).toUpperCase() ?? "??"}`,
          counterpartyWalletAddress: c.booking?.client.walletAddress ?? "",
          subject: c.booking?.practiceArea ?? "Consultation",
          lastMessage: c.messages[0]?.content ?? "",
          lastTime: (c.messages[0]?.createdAt ?? c.updatedAt).toISOString(),
          counterpartyVerified: false,
        }))}
        initialActiveId={activeId}
      />
    </div>
  );
}
