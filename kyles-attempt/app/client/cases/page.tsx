import Link from "next/link";
import { headers } from "next/headers";
import { Calendar, Check, FileText, MessageSquare, Video } from "lucide-react";
import type { BookingStatus } from "@prisma/client";
import { requireClient } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/firmus/empty-state";
import { AvatarBubble } from "@/components/firmus/avatar-bubble";
import { formatEUR, formatScheduled } from "@/lib/utils/format";
import { isJoinableNow, joinabilityReason } from "@/lib/utils/booking";

type BookingResponse = {
  bookings: Array<{
    id: string;
    scheduledAt: string;
    durationMinutes: number;
    status: BookingStatus;
    practiceArea: string;
    consultationFeeEUR: string;
    platformFeeEUR: string;
    caseDescription: string;
    clientAcceptedAt: string | null;
    lawyerAcceptedAt: string | null;
    lawyerProfile: { user: { name: string | null }; city: string };
  }>;
};

function invoiceCaption(b: BookingResponse["bookings"][number]): string {
  if (b.clientAcceptedAt && b.lawyerAcceptedAt) return "Both parties signed · funds in escrow";
  if (b.clientAcceptedAt && !b.lawyerAcceptedAt) return "You signed · awaiting lawyer";
  if (!b.clientAcceptedAt && b.lawyerAcceptedAt) return "Lawyer sent invoice · review and sign";
  return "Awaiting signatures";
}

const STATUS_KIND: Record<BookingStatus, "pending" | "info" | "success" | "neutral" | "error"> = {
  REQUESTED: "pending",
  ACCEPTED: "info",
  IN_PROGRESS: "info",
  COMPLETED: "success",
  CANCELLED: "neutral",
  DECLINED: "neutral",
  DISPUTED: "error",
};

export const dynamic = "force-dynamic";

export default async function CasesPage({
  searchParams,
}: {
  searchParams: Promise<{ "just-booked"?: string }>;
}) {
  const session = await requireClient();
  const sp = await searchParams;
  const justBooked = sp["just-booked"];
  const h = await headers();
  const cookie = h.get("cookie") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const res = await fetch(`${proto}://${host}/api/bookings`, {
    headers: { cookie },
    cache: "no-store",
  });
  const { bookings } = (await res.json()) as BookingResponse;

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="cases" />
      <main className="mx-auto max-w-[1080px] px-6 py-10 lg:px-8">
        <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">Your cases</h1>
        <p className="mt-2 text-[15px] text-slate-500">
          Every consultation you've booked, in flight, or completed.
        </p>

        {justBooked && bookings.some((b) => b.id === justBooked) && (
          <div className="mt-6 flex items-start gap-3 rounded-xl border border-teal-100 bg-teal-50 p-4">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-teal-500 text-white">
              <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
            </span>
            <div className="text-[14px] leading-[1.55] text-navy-900">
              <strong className="font-semibold">Booking sent.</strong>{" "}
              <span className="text-slate-700">
                Your funds are held in smart-contract escrow until the consultation completes. The lawyer will accept or
                propose another time. You'll be able to join the consultation room from this page when the meeting opens.
              </span>
            </div>
          </div>
        )}

        {bookings.length === 0 ? (
          <div className="mt-10">
            <EmptyState
              title="No cases yet."
              body="Find a verified lawyer to book your first consultation."
              ctaLabel="Browse directory"
              ctaHref="/lawyers"
            />
          </div>
        ) : (
          <ul className="mt-8 divide-y divide-slate-100 rounded-xl border border-slate-100 bg-white-0">
            {bookings.map((b) => {
              const scheduled = new Date(b.scheduledAt);
              const joinable = isJoinableNow(b.status, scheduled, b.durationMinutes);
              const reason = joinabilityReason(b.status, scheduled);
              return (
                <li key={b.id} className="grid items-center gap-4 p-5 sm:grid-cols-[40px_1fr_auto]">
                  <AvatarBubble name={b.lawyerProfile.user.name ?? "Lawyer"} size={40} verified />
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-navy-900">
                        {b.lawyerProfile.user.name}
                      </span>
                      <Badge kind={STATUS_KIND[b.status]}>{b.status.toLowerCase()}</Badge>
                    </div>
                    <div className="mt-1 text-[13px] text-slate-500">
                      {b.practiceArea} · {b.lawyerProfile.city} ·{" "}
                      {formatScheduled(scheduled)} · {b.durationMinutes} min ·{" "}
                      {formatEUR(Number(b.consultationFeeEUR))}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-500">
                      <Calendar className="h-3 w-3" aria-hidden />
                      {reason}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-500">
                      <FileText className="h-3 w-3" aria-hidden />
                      Invoice {formatEUR(Number(b.consultationFeeEUR) + Number(b.platformFeeEUR))} ·{" "}
                      {invoiceCaption(b)}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      asChild
                      variant={!b.clientAcceptedAt && b.lawyerAcceptedAt ? "primary" : "outline"}
                      size="sm"
                    >
                      <Link href={`/client/cases/${b.id}`}>
                        <FileText className="h-3.5 w-3.5" aria-hidden />
                        {!b.clientAcceptedAt && b.lawyerAcceptedAt ? "Review & sign invoice" : "Invoice"}
                      </Link>
                    </Button>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/client/messages?booking=${b.id}`}>
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden /> Messages
                      </Link>
                    </Button>
                    {joinable ? (
                      <Button asChild size="sm">
                        <Link href={`/client/consultation/${b.id}`}>
                          <Video className="h-3.5 w-3.5" aria-hidden /> Join consultation
                        </Link>
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </main>
    </div>
  );
}
