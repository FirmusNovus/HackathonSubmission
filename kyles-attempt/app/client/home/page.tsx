import Link from "next/link";
import { Calendar, MessageSquare, Search, Video } from "lucide-react";
import { BookingStatus } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { containsValue, expandLawyerProfile } from "@/lib/db/json-array";
import { requireClient } from "@/lib/auth/session";
import { SCHEMA_LAWYER } from "@/lib/chain/schemas";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { LawyerCard } from "@/components/firmus/lawyer-card";
import { EmptyState } from "@/components/firmus/empty-state";
import { formatEUR, formatScheduled } from "@/lib/utils/format";
import { isJoinableNow, joinabilityReason } from "@/lib/utils/booking";

const CATEGORIES = ["All", "Family", "Property", "Employment", "Immigration", "Business", "Tax", "Estate"] as const;

const CATEGORY_SERVICES: Record<string, Array<{ title: string; price: number; desc: string }>> = {
  Business: [
    { title: "Incorporation in your EU country", price: 600, desc: "Entity formation, tax registration, bank account setup" },
    { title: "Founder agreement", price: 480, desc: "Vesting, IP assignment, role definitions" },
    { title: "Stock option plan setup", price: 1200, desc: "ESOP design + paperwork for 1–10 employees" },
  ],
  Immigration: [
    { title: "Schengen visa application", price: 450, desc: "Document review, application, follow-up" },
    { title: "EU residency permit", price: 1200, desc: "Full filing + follow-up consultation" },
    { title: "Family reunification", price: 2400, desc: "End-to-end with translations included" },
  ],
  Family: [
    { title: "Pre-nuptial agreement review", price: 320, desc: "Cross-jurisdiction; one revision included" },
    { title: "Custody arrangement", price: 240, desc: "60-min strategy session for separated parents" },
    { title: "Will update", price: 180, desc: "30-min review + redraft of an existing will" },
  ],
  Property: [
    { title: "Residential purchase review", price: 380, desc: "Title check + sale-and-purchase review" },
    { title: "Commercial lease", price: 540, desc: "Up to 30 pages; cross-jurisdiction friendly" },
    { title: "Property dispute strategy", price: 280, desc: "60-min session, action plan included" },
  ],
  Employment: [
    { title: "Wrongful dismissal assessment", price: 0, desc: "Free 30-min review of your situation" },
    { title: "Executive contract review", price: 480, desc: "Severance, non-compete, IP — full review" },
  ],
  Tax: [
    { title: "Cross-border tax check", price: 360, desc: "Personal or single-entity, 1 hr" },
    { title: "Annual tax filing review", price: 240, desc: "Spot-check + recommended optimizations" },
  ],
  Estate: [
    { title: "EU cross-border inheritance", price: 480, desc: "60-min strategy + summary deliverable" },
    { title: "Estate plan setup", price: 1100, desc: "Will + trust + tax-efficient structure" },
  ],
  All: [],
};

export default async function ClientHomePage({
  searchParams,
}: {
  searchParams: Promise<{ cat?: string }>;
}) {
  const session = await requireClient();
  const sp = await searchParams;
  const cat = (CATEGORIES as readonly string[]).includes(sp.cat ?? "All") ? (sp.cat ?? "All") : "All";

  const activeBooking = await prisma.booking.findFirst({
    where: {
      clientId: session.user.id,
      status: { in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS, BookingStatus.REQUESTED] },
    },
    orderBy: { scheduledAt: "asc" },
    include: { lawyerProfile: { include: { user: true } } },
  });

  // F2: capability-as-source-of-truth filter (see app/lawyers/page.tsx).
  const nowDate = new Date();
  const activeCaps = await prisma.capability.findMany({
    where: {
      schemaId: SCHEMA_LAWYER,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: nowDate } }],
    },
    select: { subjectAddress: true },
  });
  const verifiedWallets = activeCaps.map((c) => c.subjectAddress);
  const recommendedRows = verifiedWallets.length
    ? await prisma.lawyerProfile.findMany({
        where: {
          user: { walletAddress: { in: verifiedWallets } },
          ...(cat !== "All" ? { tags: containsValue(cat) } : {}),
        },
        include: { user: true },
        orderBy: [{ rating: "desc" }],
        take: 6,
      })
    : [];
  const recommended = recommendedRows.map((l) => ({ ...expandLawyerProfile(l), user: l.user }));

  const services = cat !== "All" ? CATEGORY_SERVICES[cat] ?? [] : [];

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="home" />
      <main className="mx-auto max-w-[1280px] px-6 py-10 lg:px-8">
      <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">
        Hi {session.user.name?.split(" ")[0] ?? "there"}, what do you need help with today?
      </h1>
      <p className="mt-2 text-[15px] text-slate-500">
        Describe your situation, browse a category, or pick up where you left off.
      </p>

      <div className="mt-6 max-w-[720px]">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-300" aria-hidden />
          <Input placeholder="e.g. cross-border inheritance, employment dispute…" className="h-12 pl-11" />
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {CATEGORIES.map((c) => {
          const active = c === cat;
          return (
            <Link
              key={c}
              href={c === "All" ? "/client/home" : `/client/home?cat=${encodeURIComponent(c)}`}
              className={cn(
                "inline-flex h-8 items-center rounded-full border px-3.5 text-[13px] font-medium transition-colors",
                active
                  ? "border-navy-900 bg-navy-900 text-white"
                  : "border-slate-100 bg-white-0 text-slate-700 hover:border-slate-300",
              )}
            >
              {c}
            </Link>
          );
        })}
      </div>

      {activeBooking && cat === "All" && (
        <ActiveConsultationCard
          id={activeBooking.id}
          lawyerName={activeBooking.lawyerProfile.user.name ?? "Your lawyer"}
          practiceArea={activeBooking.practiceArea}
          scheduledAt={activeBooking.scheduledAt}
          durationMinutes={activeBooking.durationMinutes}
          consultationFeeEUR={Number(activeBooking.consultationFeeEUR)}
          status={activeBooking.status}
        />
      )}

      {cat !== "All" && services.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display text-2xl text-navy-900">{cat} — sample services</h2>
          <p className="mt-1 text-[14px] text-slate-500">Fixed-fee starting points. Actual pricing depends on your lawyer.</p>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {services.map((s) => (
              <div key={s.title} className="rounded-xl border border-slate-100 bg-white-0 p-5 shadow-[var(--shadow-sm)]">
                <div className="text-[15px] font-semibold text-navy-900">{s.title}</div>
                <div className="mt-1 text-[13px] text-slate-500">{s.desc}</div>
                <div className="mt-3 flex items-center justify-between">
                  <span className="font-display text-2xl text-navy-900">
                    {s.price === 0 ? "Free" : `from ${formatEUR(s.price)}`}
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/lawyers?practice=${encodeURIComponent(cat)}`}>Find lawyer</Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-12">
        <div className="flex items-end justify-between">
          <div>
            <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-teal-600">Recommended</span>
            <h2 className="font-display mt-1 text-2xl text-navy-900">
              {cat === "All" ? "Verified lawyers for you." : `Verified ${cat.toLowerCase()} lawyers.`}
            </h2>
          </div>
          <Link href="/lawyers" className="text-[13px] font-medium text-teal-600 hover:underline">
            See all →
          </Link>
        </div>
        {recommended.length === 0 ? (
          <div className="mt-6">
            <EmptyState
              title="No matches in this category yet."
              body="Try the directory to widen your search."
              ctaLabel="Browse directory"
              ctaHref="/lawyers"
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            {recommended.map((l) => (
              <LawyerCard key={l.id} lawyer={l} />
            ))}
          </div>
        )}
      </section>
      </main>
    </div>
  );
}

function ActiveConsultationCard({
  id,
  lawyerName,
  practiceArea,
  scheduledAt,
  durationMinutes,
  consultationFeeEUR,
  status,
}: {
  id: string;
  lawyerName: string;
  practiceArea: string;
  scheduledAt: Date;
  durationMinutes: number;
  consultationFeeEUR: number;
  // Booking.status is `string` from Prisma (SQLite has no enums).
  status: string;
}) {
  const joinable = isJoinableNow(status, scheduledAt, durationMinutes);
  const reason = joinabilityReason(status, scheduledAt);
  return (
    <section className="mt-10 rounded-2xl border border-slate-100 bg-white-0 p-6 shadow-[var(--shadow-sm)]">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-teal-600">
            {status === "REQUESTED" ? "Booking pending" : "Upcoming consultation"}
          </span>
          <h2 className="mt-1 font-display text-2xl text-navy-900">{lawyerName}</h2>
          <p className="mt-1 text-[13px] text-slate-500">
            {practiceArea} · {formatScheduled(scheduledAt)} · {durationMinutes} min ·{" "}
            {formatEUR(consultationFeeEUR)}
          </p>
          <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] text-slate-500">
            <Calendar className="h-3 w-3" aria-hidden /> {reason}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button asChild variant="outline" size="sm">
            <Link href={`/client/messages?booking=${id}`}>
              <MessageSquare className="h-4 w-4" aria-hidden /> Messages
            </Link>
          </Button>
          {joinable ? (
            <Button asChild size="sm">
              <Link href={`/client/consultation/${id}`}>
                <Video className="h-4 w-4" aria-hidden /> Join consultation
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
