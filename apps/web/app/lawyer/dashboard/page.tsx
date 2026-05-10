import Link from "next/link";
import { Briefcase, Calendar, FileText, MessageSquare, Plus, TrendingUp, Video } from "lucide-react";
import { BookingStatus } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { requireLawyer } from "@/lib/auth/session";
import { AppTopBar } from "@/components/layout/app-top-bar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatETH, formatScheduled } from "@/lib/utils/format";
import { anonymousClientId } from "@/lib/utils/anonymize";

export default async function LawyerDashboardPage() {
  const session = await requireLawyer();
  // Self-heal: lawyers whose chain attestation exists but who don't yet have
  // a LawyerProfile (anyone onboarded before lawyer/finalize started writing
  // one) get a placeholder created here so the dashboard always renders. The
  // user fills in the marketplace fields on /lawyer/profile/edit.
  const profile = await prisma.lawyerProfile.upsert({
    where: { userId: session.user.id },
    update: {},
    create: {
      userId: session.user.id,
      city: "—",
      headline: "Licensed legal professional",
      bio: "Profile pending — edit to add specialties, languages, and hourly rate.",
      specialties: "[]",
      languages: "[]",
      jurisdictions: "[]",
      pricingKind: "HOURLY",
      pricingHeadline: "0.06 ETH / hr",
      hourlyRateEUR: 0.06,
      consultationRate30: 0.03,
      consultationRate60: 0.06,
      yearsExperience: 0,
      verificationStatus: "VERIFIED",
      barRegistrationNum: "—",
      barJurisdiction: "—",
      admissionDate: new Date(),
    },
  });

  const [pendingCount, upcoming, activeCount, completed30d, todays, orders] = await Promise.all([
    prisma.booking.count({ where: { lawyerProfileId: profile.id, status: BookingStatus.REQUESTED } }),
    prisma.booking.count({
      where: {
        lawyerProfileId: profile.id,
        status: BookingStatus.ACCEPTED,
        scheduledAt: { gte: new Date(), lte: new Date(Date.now() + 1000 * 60 * 60 * 24 * 7) },
      },
    }),
    prisma.booking.count({
      where: { lawyerProfileId: profile.id, status: { in: [BookingStatus.ACCEPTED, BookingStatus.IN_PROGRESS] } },
    }),
    prisma.booking.findMany({
      where: {
        lawyerProfileId: profile.id,
        status: BookingStatus.COMPLETED,
        updatedAt: { gte: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) },
      },
      select: { consultationFeeEUR: true, platformFeeEUR: true },
    }),
    prisma.booking.findMany({
      where: {
        lawyerProfileId: profile.id,
        scheduledAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt: new Date(new Date().setHours(24, 0, 0, 0)),
        },
      },
      include: { client: true },
      orderBy: { scheduledAt: "asc" },
    }),
    prisma.booking.findMany({
      where: { lawyerProfileId: profile.id, status: BookingStatus.REQUESTED },
      include: { client: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const earnings30d = completed30d.reduce(
    (acc, b) => acc + Number(b.consultationFeeEUR) - Number(b.platformFeeEUR),
    0,
  );

  return (
    <div className="min-h-screen bg-white-50">
      <AppTopBar user={session.user} active="dashboard" />
      <main className="mx-auto max-w-[1280px] px-6 py-10 lg:px-8">
        <div className="mb-8 flex flex-wrap items-baseline justify-between gap-4">
          <div>
            <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">
              Good morning, {session.user.name?.split(" ")[0] ?? "there"}.
            </h1>
            <p className="mt-2 text-[15px] text-slate-500">
              {pendingCount > 0
                ? `${pendingCount} pending ${pendingCount === 1 ? "order needs" : "orders need"} your attention.`
                : "No pending orders right now."}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <Link href="/lawyer/profile/edit">
                <Plus className="h-4 w-4" aria-hidden /> Edit profile
              </Link>
            </Button>
            <Button asChild>
              <Link href="/lawyer/orders/new">
                <FileText className="h-4 w-4" aria-hidden /> Create an order
              </Link>
            </Button>
          </div>
        </div>

        <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Stat icon={MessageSquare} label="Pending orders" value={String(pendingCount)} sub={pendingCount === 0 ? "all caught up" : "to review"} amber={pendingCount > 0} href="/lawyer/orders" />
          <Stat icon={Calendar} label="Upcoming" value={String(upcoming)} sub="this week" />
          <Stat icon={Briefcase} label="Active Cases" value={String(activeCount)} sub="in progress" href="/lawyer/cases" />
          <Stat icon={TrendingUp} label="Earnings (30d)" value={formatETH(earnings30d)} sub="ETH" />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
          <div className="rounded-xl border border-slate-100 bg-white-0 p-6">
            <div className="mb-5 flex items-baseline justify-between">
              <h2 className="font-display text-xl text-navy-900">Today's schedule</h2>
              <span className="text-[13px] text-slate-500">
                {new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" })}
              </span>
            </div>
            {todays.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-slate-500">No consultations scheduled today.</p>
            ) : (
              <ul>
                {todays.map((b, i) => (
                  <li
                    key={b.id}
                    className={i < todays.length - 1 ? "grid grid-cols-[80px_1fr_auto] items-center gap-4 border-b border-slate-100 py-3.5" : "grid grid-cols-[80px_1fr_auto] items-center gap-4 py-3.5"}
                  >
                    <div>
                      <div className="font-mono text-[14px] font-medium text-navy-900">
                        {new Date(b.scheduledAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                      </div>
                      <div className="font-mono text-[11px] text-slate-300">{b.durationMinutes} min</div>
                    </div>
                    <div className="border-l-2 border-teal-500 pl-4">
                      <div className="text-[14px] font-medium text-navy-900">{b.practiceArea}</div>
                      <div className="text-[12px] text-slate-500">
                        {b.client.name ? (
                          <>{b.client.name}</>
                        ) : (
                          <>Client <span className="font-mono">{anonymousClientId(b.client.walletAddress)}</span></>
                        )}
                      </div>
                    </div>
                    <Button asChild variant="primary" size="sm">
                      <Link href={`/lawyer/consultation/${b.id}`}>
                        <Video className="h-4 w-4" aria-hidden /> Join
                      </Link>
                    </Button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-8">
              <div className="mb-3 flex items-baseline justify-between">
                <h3 className="text-[15px] font-semibold text-navy-900">Earnings overview (30d)</h3>
                <span className="text-[13px] text-slate-500">{formatETH(earnings30d)}</span>
              </div>
              <Sparkline />
            </div>
          </div>

          <div className="rounded-xl border border-slate-100 bg-white-0 p-6">
            <div className="mb-4 flex items-baseline justify-between">
              <h2 className="font-display text-xl text-navy-900">Recent orders</h2>
              {pendingCount > 0 && <Badge kind="pending">{pendingCount} new</Badge>}
            </div>
            {orders.length === 0 ? (
              <p className="py-6 text-center text-[14px] text-slate-500">No new orders right now.</p>
            ) : (
              <ul>
                {orders.map((r, i) => (
                  <li
                    key={r.id}
                    className={i < orders.length - 1 ? "border-b border-slate-100 py-3.5" : "py-3.5"}
                  >
                    <Link href={`/lawyer/orders/${r.id}`} className="block hover:text-teal-600">
                      <div className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span>{r.practiceArea}</span>
                        <span className="text-slate-200">·</span>
                        {r.client.name ? (
                          <span>{r.client.name}</span>
                        ) : (
                          <span className="font-mono">{anonymousClientId(r.client.walletAddress)}</span>
                        )}
                      </div>
                      <div className="mt-1 text-[14px] font-medium text-navy-900">
                        {r.caseDescription.slice(0, 80)}…
                      </div>
                      <div className="mt-2 text-[12px] text-slate-500">
                        {formatScheduled(r.scheduledAt)} · {formatETH(Number(r.consultationFeeEUR))}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  sub,
  amber,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sub: string;
  amber?: boolean;
  href?: string;
}) {
  const inner = (
    <>
      <div className="flex items-center justify-between">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-50">
          <Icon className="h-4 w-4 text-teal-700" />
        </span>
        {amber && <span aria-hidden className="h-2 w-2 rounded-full bg-amber-500" />}
      </div>
      <div className="mt-4 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">{label}</div>
      <div className="font-display mt-1 text-3xl text-navy-900">{value}</div>
      <div className="mt-1 text-[12px] text-slate-500">{sub}</div>
    </>
  );
  const cls = "rounded-xl border border-slate-100 bg-white-0 p-5";
  if (href) {
    return (
      <Link href={href} className={`${cls} block transition-colors hover:border-teal-200 hover:bg-white-50`}>
        {inner}
      </Link>
    );
  }
  return <div className={cls}>{inner}</div>;
}

function Sparkline() {
  return (
    <svg viewBox="0 0 600 160" className="h-32 w-full" aria-hidden>
      <defs>
        <linearGradient id="earningGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#14B8A6" stopOpacity="0.18" />
          <stop offset="1" stopColor="#14B8A6" stopOpacity="0" />
        </linearGradient>
      </defs>
      {[40, 80, 120].map((y) => (
        <line key={y} x1="0" x2="600" y1={y} y2={y} stroke="#EEF1F4" />
      ))}
      <path
        d="M0,120 C40,110 80,100 120,90 C160,80 200,95 240,80 C280,65 320,75 360,55 C400,40 440,50 480,35 C520,25 560,30 600,20 L600,160 L0,160 Z"
        fill="url(#earningGrad)"
      />
      <path
        d="M0,120 C40,110 80,100 120,90 C160,80 200,95 240,80 C280,65 320,75 360,55 C400,40 440,50 480,35 C520,25 560,30 600,20"
        stroke="#14B8A6"
        strokeWidth="2"
        fill="none"
      />
    </svg>
  );
}
