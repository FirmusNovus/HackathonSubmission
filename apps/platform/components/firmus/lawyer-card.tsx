// Owner spec: 001-verified-legal-engagement.

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { AvatarBubble } from './avatar-bubble';
import { EbsiBadge } from './ebsi-badge';
import { PricingBadge } from './pricing-badge';
import { Stars } from './stars';
import { Chip } from '@/components/ui/chip';

export interface LawyerCardProps {
  slug: string;
  name: string;
  city: string;
  primarySpecialty: string;
  avatarUrl?: string | null;
  attestationUid: string;
  walletAddress: string;
  rating?: number;
  reviewCount?: number;
  consultationKind: 'FREE' | 'PAID';
  pricingHeadline?: string;
  tags?: string[];
}

export function LawyerCard(p: LawyerCardProps) {
  return (
    <Card className="flex flex-col gap-3 p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <AvatarBubble name={p.name} imageUrl={p.avatarUrl} size={64} />
        <div className="min-w-0 flex-1">
          <Link
            href={`/lawyers/${p.slug}`}
            className="block text-base font-semibold text-navy-900 hover:text-teal-700"
          >
            {p.name}
          </Link>
          <div className="text-xs text-slate-500">
            {p.primarySpecialty} · {p.city}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {typeof p.rating === 'number' ? <Stars value={p.rating} reviewCount={p.reviewCount} /> : null}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <EbsiBadge attestationUid={p.attestationUid} walletAddress={p.walletAddress} />
        <PricingBadge consultationKind={p.consultationKind} pricingHeadline={p.pricingHeadline} />
      </div>
      {p.tags && p.tags.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {p.tags.slice(0, 3).map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
      ) : null}
    </Card>
  );
}
