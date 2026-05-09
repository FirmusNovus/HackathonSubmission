// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { MessageSquare, ShieldCheck, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LawyerCard } from '@/components/firmus/lawyer-card';
import { listVerifiedLawyerDirectory } from '@/lib/db/lawyer-profiles';

export const dynamic = 'force-dynamic';

export default function Landing() {
  const lawyers = listVerifiedLawyerDirectory().slice(0, 3);
  return (
    <div>
      <header className="border-b border-slate-100 bg-white-0">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-display text-xl text-navy-900">
            Verified Counsel
          </Link>
          <nav className="flex items-center gap-3">
            <Link href="/lawyers" className="text-sm text-slate-700 hover:text-navy-900">
              Find a lawyer
            </Link>
            <Button asChild size="sm">
              <Link href="/connect">Connect wallet</Link>
            </Button>
          </nav>
        </div>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-6 py-16 sm:py-24">
          <h1 className="font-display text-5xl text-navy-900 sm:text-6xl">
            Verified Legal Counsel, On-Chain.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-700">
            Connect your wallet, present an EU resident credential, and book a consultation
            with a verified lawyer. Your country and age stay private; everything else stays
            with you.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link href="/lawyers">Find a lawyer</Link>
            </Button>
            <Button asChild variant="secondary" size="lg">
              <Link href="/connect?role=lawyer">I&apos;m a lawyer</Link>
            </Button>
          </div>
          <p className="mt-6 text-xs text-slate-500">
            Need a test credential to try the demo?{' '}
            <a
              href="/issuer/"
              target="issuer"
              rel="noreferrer"
              className="text-teal-700 underline underline-offset-2 hover:text-teal-600"
            >
              Visit the test credential issuer →
            </a>
          </p>
        </section>

        <section className="bg-white-0 py-16">
          <div className="mx-auto grid max-w-6xl gap-6 px-6 sm:grid-cols-3">
            <Card className="p-6">
              <MessageSquare className="h-6 w-6 text-teal-500" />
              <h3 className="mt-3">1. Browse counsel</h3>
              <p className="mt-2 text-sm text-slate-500">
                Filter by specialty, language, jurisdiction. Every profile carries a
                live capability attestation.
              </p>
            </Card>
            <Card className="p-6">
              <ShieldCheck className="h-6 w-6 text-teal-500" />
              <h3 className="mt-3">2. Verify privately</h3>
              <p className="mt-2 text-sm text-slate-500">
                Present an EU resident credential, disclose only country and 18+. The
                platform never sees your name or document.
              </p>
            </Card>
            <Card className="p-6">
              <Lock className="h-6 w-6 text-teal-500" />
              <h3 className="mt-3">3. Pay securely</h3>
              <p className="mt-2 text-sm text-slate-500">
                Paid consultations sit in secure payment held until your consultation
                completes — release with one click.
              </p>
            </Card>
          </div>
        </section>

        {lawyers.length > 0 ? (
          <section className="mx-auto max-w-6xl px-6 py-16">
            <h2 className="text-2xl text-navy-900">Recently joined</h2>
            <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {lawyers.map((l) => (
                <LawyerCard
                  key={l.user_id}
                  slug={l.slug}
                  name={`${(l.disclosed_attrs.given_name as string) ?? ''} ${(l.disclosed_attrs.family_name as string) ?? ''}`.trim() || l.slug}
                  city={l.city}
                  primarySpecialty={l.specialties[0] ?? 'General'}
                  avatarUrl={l.avatar_url}
                  attestationUid={l.attestation_uid}
                  walletAddress={l.eth_address}
                  consultationKind={l.consultation_type}
                  pricingHeadline={l.pricing_headline}
                  tags={l.tags}
                  rating={4.8}
                  reviewCount={0}
                />
              ))}
            </div>
          </section>
        ) : null}
      </main>

      <footer className="border-t border-slate-100 bg-white-0">
        <div className="mx-auto max-w-6xl px-6 py-8 text-xs text-slate-500">
          <p>Privacy by cryptography. No tracking, no analytics, no ads.</p>
        </div>
      </footer>
    </div>
  );
}
