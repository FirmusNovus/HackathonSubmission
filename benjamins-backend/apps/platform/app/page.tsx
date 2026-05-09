import Link from "next/link";
import { ArrowRight, MessageSquare, ShieldCheck, Lock, Briefcase, Inbox } from "lucide-react";
import { NetworkPattern } from "@/components/firmus/network-pattern";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { FirmusBadge } from "@/components/firmus/firmus-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function Home() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <TrustStrip />
      <GetStarted />
    </>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden bg-white px-6 pt-20 pb-24 text-center lg:px-12">
      <NetworkPattern opacity={0.55} />
      <div className="relative mx-auto max-w-[880px]">
        <FirmusBadge kind="info" className="mb-7">
          ★ EUDI · EAS · Pseudonymous Legal Advice
        </FirmusBadge>
        <h1 className="font-display mx-auto text-[44px] leading-[1.04] text-navy-900 sm:text-6xl lg:text-[76px]">
          Verified Legal Counsel,
          <br />
          <em className="not-italic italic text-teal-600">On-Chain.</em>
        </h1>
        <p className="mx-auto mt-7 max-w-[620px] text-[17px] leading-relaxed text-slate-500 sm:text-xl">
          Lex Nova connects you with cryptographically verified lawyers across Europe.
          <br className="hidden sm:block" /> Trust, proven on the blockchain.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="h-12 rounded-lg bg-teal-500 px-7 text-[15px] text-white hover:bg-teal-600"
          >
            <Link href="/lawyers">
              Find a Lawyer <ArrowRight className="h-4 w-4" aria-hidden />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="ghost"
            className="h-12 rounded-lg px-7 text-[15px] text-slate-700 hover:bg-slate-50"
          >
            <Link href="#how">How It Works</Link>
          </Button>
        </div>
        <div className="mt-12 inline-flex items-center gap-3 rounded-full border border-slate-100 bg-white/70 px-5 py-2.5 backdrop-blur-md">
          <EBSIBadge variant="seal" size={20} />
          <span className="text-[13px] font-medium tracking-[0.02em] text-slate-700">
            Verified through EUDI &amp; on-chain attestation
          </span>
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
      "Post a matter in plain language. No price tags up front — pricing is the lawyer's response, not part of the brief.",
  },
  {
    n: "02",
    icon: ShieldCheck,
    title: "Match with Verified Lawyer",
    body:
      "Every lawyer on Lex Nova has presented a bar credential from their wallet, proven on-chain via EAS attestation.",
  },
  {
    n: "03",
    icon: Lock,
    title: "Engage Pseudonymously",
    body:
      "Clients prove EU residency through PID — only country-of-residence and age-over-18 are disclosed. Nothing more leaves the wallet.",
  },
];

function HowItWorks() {
  return (
    <section id="how" className="border-y border-slate-100 bg-white px-6 py-24 lg:px-12">
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
    ["EUDI", "Wallet-native credentials"],
    ["EAS", "On-chain attestations"],
    ["27", "EU jurisdictions"],
  ];
  return (
    <section className="bg-background px-6 py-14 lg:px-12">
      <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-center gap-12">
        <div className="flex items-center gap-3.5">
          <EBSIBadge variant="seal" size={32} />
          <div>
            <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-gold-700">Verification</div>
            <div className="mt-0.5 text-base font-medium text-navy-900">
              Cryptographic, not credential-photographic.
            </div>
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

const GET_STARTED = [
  {
    href: "/onboarding/lawyer",
    title: "Onboard as a lawyer",
    icon: ShieldCheck,
    description:
      "Present a bar credential from your wallet to receive an on-chain verified_lawyer attestation.",
    slug: "/onboarding/lawyer",
  },
  {
    href: "/onboarding/client",
    title: "Onboard as a client",
    icon: Lock,
    description:
      "Present an EU resident credential (PID). Only your country of residence and an age-over-18 boolean are disclosed — name, birth date, document number, and full address never leave your wallet.",
    slug: "/onboarding/client",
  },
  {
    href: "/lawyers",
    title: "Browse the directory",
    icon: Briefcase,
    description:
      "See lawyers who have completed onboarding. Empty until at least one lawyer has presented their credential.",
    slug: "/lawyers",
  },
  {
    href: "/matters",
    title: "Post a matter",
    icon: MessageSquare,
    description:
      "Describe what you need help with. No price — pricing is the lawyer's response, not part of the matter. Requires completed client onboarding.",
    slug: "/matters",
  },
  {
    href: "/inbox",
    title: "Lawyer inbox",
    icon: Inbox,
    description:
      "Engagement requests addressed to your wallet. Decline or respond with a signed first-milestone proposal. Requires completed lawyer onboarding.",
    slug: "/inbox",
  },
];

function GetStarted() {
  return (
    <section className="bg-white px-6 py-24 lg:px-12">
      <div className="mx-auto max-w-[1180px]">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-teal-600">Get started</span>
            <h2 className="font-display mt-3 text-4xl text-navy-900">
              Pick your role and step inside.
            </h2>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {GET_STARTED.map((s) => (
            <Link key={s.href} href={s.href} className="group">
              <Card className="h-full border-slate-100 bg-white shadow-none transition-all hover:border-slate-200 hover:shadow-firmus">
                <CardHeader>
                  <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
                    <s.icon className="h-5 w-5" aria-hidden />
                  </div>
                  <CardTitle className="font-display text-2xl text-navy-900">{s.title}</CardTitle>
                  <CardDescription className="text-[14px] leading-[1.6] text-slate-500">
                    {s.description}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between text-[13px]">
                  <span className="font-mono text-slate-300">{s.slug}</span>
                  <span className="font-medium text-teal-600 group-hover:underline">Open →</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <p className="mt-10 max-w-[640px] text-[12px] leading-relaxed text-slate-500">
          Phase 4 in progress — Groups A (client onboarding), B (matters), C (engagement
          request), D1 (lawyer handshake) done. D2 (client funding), E (messaging),
          F (milestones) follow, then disputes (Phase 5), ZK conflict-of-interest (Phase 6),
          operator admin (Phase 7).
        </p>
      </div>
    </section>
  );
}
