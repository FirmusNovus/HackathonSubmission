// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Chip } from '@/components/ui/chip';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AvatarBubble } from '@/components/firmus/avatar-bubble';
import { EbsiBadge } from '@/components/firmus/ebsi-badge';
import { PricingBadge } from '@/components/firmus/pricing-badge';
import { Stars } from '@/components/firmus/stars';
import { listVerifiedLawyerDirectory } from '@/lib/db/lawyer-profiles';
import { formatETH } from '@/lib/format/eth';
import { truncateAddress } from '@/lib/format/address';

export const dynamic = 'force-dynamic';

export default function LawyerProfile({ params }: { params: { slug: string } }) {
  const lawyers = listVerifiedLawyerDirectory();
  const lawyer = lawyers.find((l) => l.slug === params.slug);
  if (!lawyer) notFound();

  const fullName = `${(lawyer.disclosed_attrs.given_name as string) ?? ''} ${(lawyer.disclosed_attrs.family_name as string) ?? ''}`.trim() || lawyer.slug;
  const jurisdiction = (lawyer.disclosed_attrs.jurisdiction as string) ?? '';

  return (
    <main className="mx-auto max-w-6xl px-6 py-10">
      <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
        <div>
          <div className="flex items-start gap-4">
            <AvatarBubble name={fullName} imageUrl={lawyer.avatar_url} size={96} />
            <div className="flex-1">
              <h1 className="font-display text-3xl text-navy-900">{fullName}</h1>
              <div className="text-sm text-slate-500">
                {lawyer.specialties[0] ?? 'General'} · {lawyer.city}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Stars value={4.8} reviewCount={0} />
                <EbsiBadge attestationUid={lawyer.attestation_uid} walletAddress={lawyer.eth_address} />
                <PricingBadge consultationKind={lawyer.consultation_type} pricingHeadline={lawyer.pricing_headline} />
              </div>
            </div>
          </div>

          <Tabs defaultValue="about" className="mt-6">
            <TabsList>
              <TabsTrigger value="about">About</TabsTrigger>
              <TabsTrigger value="credentials">Credentials</TabsTrigger>
              <TabsTrigger value="reviews">Reviews</TabsTrigger>
              <TabsTrigger value="availability">Availability</TabsTrigger>
            </TabsList>

            <TabsContent value="about">
              <p className="text-base text-slate-700">{lawyer.headline}</p>
              <p className="mt-3 text-sm text-slate-700">{lawyer.bio}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {lawyer.specialties.map((s) => (
                  <Chip key={s}>{s}</Chip>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {lawyer.languages.map((l) => (
                  <Chip key={l} className="bg-slate-50">
                    {l}
                  </Chip>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="credentials">
              <Card>
                <CardHeader>
                  <CardTitle>Bar accreditation</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-sm">
                  <div>
                    <span className="text-slate-500">Jurisdiction: </span>
                    {jurisdiction}
                  </div>
                  <div>
                    <span className="text-slate-500">Admission no.: </span>
                    {lawyer.disclosed_attrs.bar_admission_number as string}
                  </div>
                  <div>
                    <span className="text-slate-500">Admitted: </span>
                    {lawyer.disclosed_attrs.bar_admission_date as string}
                  </div>
                  <div>
                    <span className="text-slate-500">Valid until: </span>
                    {lawyer.disclosed_attrs.valid_until as string}
                  </div>
                  <div className="mt-2 break-all font-mono text-xs text-slate-500">
                    {truncateAddress(lawyer.eth_address)}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="reviews">
              <Card>
                <CardContent className="p-8 text-center text-sm text-slate-500">
                  Reviews are coming soon.
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="availability">
              <Card>
                <CardContent className="space-y-1 p-6 text-sm">
                  {Object.entries(lawyer.availability as Record<string, string>).map(([day, hours]) => (
                    <div key={day} className="flex justify-between">
                      <span className="text-slate-700">{day}</span>
                      <span className="text-slate-500">{hours}</span>
                    </div>
                  ))}
                  {Object.keys(lawyer.availability ?? {}).length === 0 ? (
                    <span className="text-slate-500">By appointment.</span>
                  ) : null}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-3">
          <Card className="p-6">
            <CardTitle className="mb-3">Book a consultation</CardTitle>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">30-min</span>
                <span>{formatETH(lawyer.consultation_rate_30_wei)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">60-min</span>
                <span>{formatETH(lawyer.consultation_rate_60_wei)}</span>
              </div>
            </div>
            <Button asChild className="mt-4 w-full">
              <Link href={`/client/book/${lawyer.user_id}`}>Request consultation</Link>
            </Button>
            <p className="mt-2 text-xs text-slate-500">
              Secure payment held until your consultation completes. Connect your wallet
              to continue.
            </p>
          </Card>
        </aside>
      </div>
    </main>
  );
}
