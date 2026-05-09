import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowRight, MessageSquare, ShieldCheck, Lock } from "lucide-react";
import { Role } from "@/lib/db/enums";
import { prisma } from "@/lib/db/client";
import { expandLawyerProfile } from "@/lib/db/json-array";
import { auth } from "@/lib/auth/config";
import { SCHEMA_LAWYER } from "@/lib/chain/schemas";
import { MarketingNav } from "@/components/layout/marketing-nav";
import { Footer } from "@/components/layout/footer";
import { NetworkPattern } from "@/components/firmus/network-pattern";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { LawyerCard } from "@/components/firmus/lawyer-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export default async function LandingPage() {
  // Signed-in viewers don't need the marketing landing — send them to their
  // role's home. The marketing pages remain reachable directly (e.g. clicking
  // the logo), but the default entry route is theirs.
  const session = await auth();
  if (session?.user) {
    redirect(session.user.role === Role.LAWYER ? "/lawyer/dashboard" : "/client/home");
  }

  // F2: filter on active SCHEMA_LAWYER capability rather than the
  // `verificationStatus` column. Two-step query: fetch the verified-lawyer
  // wallet set first, then `findMany` with `user.walletAddress in (…)`.
  const now = new Date();
  const activeCaps = await prisma.capability.findMany({
    where: {
      schemaId: SCHEMA_LAWYER,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { subjectAddress: true },
  });
  const verifiedWallets = activeCaps.map((c) => c.subjectAddress);
  const featuredRows = verifiedWallets.length
    ? await prisma.lawyerProfile.findMany({
        where: { user: { walletAddress: { in: verifiedWallets } } },
        include: { user: true },
        orderBy: { createdAt: "desc" },
        take: 3,
      })
    : [];
  const featured = featuredRows.map((l) => ({ ...expandLawyerProfile(l), user: l.user }));

  return (
    <>
      <MarketingNav active="home" />
      <Hero />
      <HowItWorks />
      <TrustStrip />
      <section className="px-6 py-24 lg:px-12">
        <div className="mx-auto max-w-[1180px]">
          <div className="mb-10 flex items-end justify-between">
            <div>
              <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-teal-600">Recently joined</span>
              <h2 className="font-display mt-3 text-4xl text-navy-900">Newly verified counsel.</h2>
            </div>
            <Link href="/lawyers" className="hidden text-[14px] font-medium text-teal-600 hover:underline sm:inline">
              Browse all lawyers →
            </Link>
          </div>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {featured.map((l) => (
              <LawyerCard key={l.id} lawyer={l} />
            ))}
          </div>
        </div>
      </section>
      <Footer />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pt-20 pb-24 text-center lg:px-12">
      <NetworkPattern opacity={0.55} />
      <div className="relative mx-auto max-w-[880px]">
        <Badge kind="info" className="mb-7">
          ★ EBSI · European Blockchain Services Infrastructure
        </Badge>
        <h1 className="font-display mx-auto text-[44px] leading-[1.04] text-navy-900 sm:text-6xl lg:text-[76px]">
          Verified Legal Counsel,
          <br />
          <em className="not-italic text-teal-600 italic">On-Chain.</em>
        </h1>
        <p className="mx-auto mt-7 max-w-[620px] text-[17px] leading-relaxed text-slate-500 sm:text-xl">
          Firmus Novus connects you with EBSI-verified lawyers across Europe.
          <br className="hidden sm:block" /> Trust, verified on the blockchain.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button asChild size="lg" variant="primary">
            <Link href="/lawyers">
              Find a Lawyer <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="ghost">
            <Link href="#how">How It Works</Link>
          </Button>
        </div>
        <div className="mt-12 inline-flex items-center gap-3 rounded-full border border-slate-100 bg-white-0/70 px-5 py-2.5 backdrop-blur-md">
          <EBSIBadge variant="seal" size={20} />
          <span className="text-[13px] font-medium tracking-[0.02em] text-slate-700">Verified through EBSI &amp; Blockchain</span>
        </div>
      </div>
    </section>
  );
}

const STEPS = [
  {
    n: "01",
    icon: MessageSquare,
    title: "Describe Need",
    body:
      "Tell us about your situation in plain language. We match you with lawyers who specialize in your kind of case.",
  },
  {
    n: "02",
    icon: ShieldCheck,
    title: "Match with Verified Lawyer",
    body:
      "Every lawyer on Firmus Novus is verified through EBSI — bar admission, credentials, and specializations all confirmed on-chain.",
  },
  {
    n: "03",
    icon: Lock,
    title: "Connect Securely",
    body:
      "Pay into smart-contract escrow, meet over secure video, release funds only after the consultation completes.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="border-y border-slate-100 bg-white-0 px-6 py-24 lg:px-12">
      <div className="mx-auto max-w-[1180px]">
        <div className="mb-16 text-center">
          <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-teal-600">How it works</span>
          <h2 className="font-display mt-3 text-3xl text-navy-900 sm:text-4xl">
            Three quiet steps to verified counsel.
          </h2>
        </div>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="relative border-t border-slate-100 pt-8">
              <div className="mb-5 flex items-baseline gap-3.5">
                <span className="font-display text-[28px] text-teal-500">{s.n}</span>
                <s.icon className="h-5 w-5 text-navy-900" aria-hidden />
              </div>
              <h3 className="text-xl font-semibold text-navy-900">{s.title}</h3>
              <p className="mt-2.5 text-[15px] leading-[1.6] text-slate-500">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TrustStrip() {
  const stats: Array<[string, string]> = [
    ["614", "Verified lawyers"],
    ["27", "EU jurisdictions"],
    ["12,400+", "Consultations completed"],
  ];
  return (
    <section className="bg-white-50 px-6 py-14 lg:px-12">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-center gap-12">
        <div className="flex items-center gap-3.5">
          <EBSIBadge variant="seal" size={32} />
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-gold-700">Verification</div>
            <div className="mt-0.5 text-base font-medium text-navy-900">Verified through EBSI &amp; Blockchain</div>
          </div>
        </div>
        <span aria-hidden className="hidden h-10 w-px bg-slate-200 md:block" />
        {stats.map(([n, l]) => (
          <div key={l} className="text-left">
            <div className="font-display text-[28px] tracking-tight text-navy-900">{n}</div>
            <div className="text-[13px] text-slate-500">{l}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
