import { redirect } from "next/navigation";
import { Role } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { requireClient } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { MessagesView } from "./messages-view";

export const dynamic = "force-dynamic";

export default async function ClientMessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const session = await requireClient();
  const sp = await searchParams;
  const conversations = await prisma.conversation.findMany({
    where: { participants: { some: { id: session.user.id } } },
    include: {
      booking: { include: { lawyerProfile: { include: { user: true } } } },
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
          <p className="mt-3 text-[15px] text-slate-500">When you book a consultation, a private thread opens here.</p>
          <a href="/lawyers" className="mt-6 inline-block rounded-lg bg-teal-500 px-5 py-2.5 text-[14px] font-medium text-white hover:bg-teal-600">
            Find a lawyer
          </a>
        </div>
      </div>
    );
  }

  if (!activeId) redirect("/client/home");

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="messages" />
      <MessagesView
        currentUserId={session.user.id}
        currentUserRole={Role.CLIENT}
        threads={conversations.map((c) => ({
          id: c.id,
          counterpartyName: c.booking?.lawyerProfile.user.name ?? "Lawyer",
          counterpartyWalletAddress: c.booking?.lawyerProfile.user.walletAddress ?? "",
          subject: c.booking?.practiceArea ?? "Consultation",
          lastMessage: c.messages[0]?.content ?? "",
          lastTime: (c.messages[0]?.createdAt ?? c.updatedAt).toISOString(),
          counterpartyVerified: c.booking?.lawyerProfile.verificationStatus === "VERIFIED",
        }))}
        initialActiveId={activeId}
      />
    </div>
  );
}
