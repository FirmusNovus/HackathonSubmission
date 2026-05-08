'use client';
// Owner spec: 001-verified-legal-engagement.

import { useState } from 'react';
import { Mic, Video, MonitorUp, PhoneOff, Hourglass, XCircle, CheckCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatPanel } from './chat-panel';
import { ProposalsPanel } from './proposals-panel';
import { formatETH } from '@/lib/format/eth';
import { truncateAddress } from '@/lib/format/address';
import { anonymousClientId } from '@/lib/anonymize/client-id';
import { useRouter } from 'next/navigation';

interface Props {
  engagementId: number;
  consultationId: number;
  role: 'client' | 'lawyer';
  selfAddress: string;
  peerAddress: string;
  practiceArea: string;
  durationMinutes: number;
  consultationKind: 'FREE' | 'PAID';
  consultationFeeWei: string;
  status: string;
}

export function ConsultationRoom(p: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function action(label: string, path: string) {
    setBusy(label);
    setError(null);
    try {
      const r = await fetch(path, { method: 'POST' });
      const j = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || j.ok === false) throw new Error(j.error ?? 'failed');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  // Status banner for non-active states.
  const banner = (() => {
    if (p.status === 'REQUESTED') {
      return p.role === 'lawyer' ? {
        icon: <Hourglass className="h-4 w-4" aria-hidden />,
        text: `New request from ${anonymousClientId(p.peerAddress)}.`,
        cta: { label: 'Review request', href: `/lawyer/requests/${p.consultationId}` },
        tone: 'amber',
      } : {
        icon: <Hourglass className="h-4 w-4" aria-hidden />,
        text: 'Awaiting lawyer acceptance. You can cancel for a co-signed refund.',
        action: { label: busy === 'cancel' ? 'Cancelling…' : 'Cancel and request refund', onClick: () => action('cancel', `/api/consultations/${p.consultationId}/cancel`) },
        tone: 'amber',
      };
    }
    if (p.status === 'DECLINED') {
      return {
        icon: <XCircle className="h-4 w-4" aria-hidden />,
        text: p.role === 'client'
          ? 'The lawyer declined this consultation. A mutual refund authorization has been initiated.'
          : 'You declined this consultation. The client can co-sign and broadcast the refund.',
        tone: 'red',
      };
    }
    if (p.status === 'CANCELLED') {
      return {
        icon: <XCircle className="h-4 w-4" aria-hidden />,
        text: p.role === 'client'
          ? 'You cancelled this consultation. Both parties co-sign to release the refund on chain.'
          : 'The client cancelled this consultation. Co-sign to release the refund.',
        tone: 'red',
      };
    }
    if (p.status === 'EXPIRED') {
      return {
        icon: <XCircle className="h-4 w-4" aria-hidden />,
        text: 'This request expired (7 days without acceptance). Refund flow open if PAID.',
        tone: 'red',
      };
    }
    if (p.status === 'COMPLETED') {
      return {
        icon: <CheckCircle className="h-4 w-4" aria-hidden />,
        text: p.consultationKind === 'PAID'
          ? 'Consultation complete. Funds released to counsel.'
          : 'Consultation complete.',
        tone: 'teal',
      };
    }
    return null;
  })();

  return (
    <div className="min-h-screen bg-navy-950 text-white-0">
      <div className="mx-auto grid max-w-7xl grid-cols-12 gap-4 p-6">
        <header className="col-span-12 flex items-center justify-between rounded-2xl border border-navy-800 bg-navy-900 px-4 py-3">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-300">Consultation</div>
            <div className="text-sm">
              {p.practiceArea} · {p.durationMinutes} min ·{' '}
              {p.consultationKind === 'PAID' ? formatETH(p.consultationFeeWei) : 'Free'}
            </div>
            <div className="mt-0.5 text-[11px] text-slate-300 font-mono">
              with {p.role === 'lawyer' ? anonymousClientId(p.peerAddress) : truncateAddress(p.peerAddress)}
            </div>
          </div>
          <div className="text-xs text-slate-300">
            Status: <span className="text-white-0">{p.status}</span>
          </div>
        </header>

        {banner ? (
          <div
            className={`col-span-12 flex items-center justify-between rounded-2xl border px-4 py-3 text-sm ${
              banner.tone === 'amber' ? 'border-amber-500 bg-amber-500/10 text-amber-500'
              : banner.tone === 'red' ? 'border-red-500 bg-red-500/10 text-red-500'
              : 'border-teal-400 bg-teal-400/10 text-teal-400'
            }`}
          >
            <div className="flex items-center gap-2">
              {banner.icon}
              {banner.text}
            </div>
            {'cta' in banner && banner.cta ? (
              <a href={banner.cta.href} className="rounded-lg bg-amber-500/20 px-3 py-1 text-xs font-medium hover:bg-amber-500/30">
                {banner.cta.label}
              </a>
            ) : null}
            {'action' in banner && banner.action ? (
              <button
                onClick={banner.action.onClick}
                disabled={busy !== null}
                className="rounded-lg bg-red-500/20 px-3 py-1 text-xs font-medium hover:bg-red-500/30 disabled:opacity-60"
              >
                {banner.action.label}
              </button>
            ) : null}
          </div>
        ) : null}

        {error ? (
          <div className="col-span-12 rounded-2xl border border-red-500 bg-red-500/10 px-4 py-2 text-xs text-red-500">
            Error: {error}
          </div>
        ) : null}

        <section className="col-span-12 lg:col-span-3 rounded-2xl border border-navy-800 bg-navy-900 p-4">
          <ProposalsPanel
            engagementId={p.engagementId}
            consultationId={p.consultationId}
            role={p.role}
            consultationStatus={p.status}
          />
        </section>

        <section className="col-span-12 lg:col-span-6 flex flex-col rounded-2xl border border-navy-800 bg-navy-950 p-4">
          <div className="flex aspect-video items-center justify-center rounded-xl border border-navy-800 bg-black/40 text-sm text-slate-300">
            Video stub — real-time transport is production trajectory
          </div>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Button variant="secondary" size="sm" aria-label="Mute">
              <Mic className="h-4 w-4" aria-hidden /> Mute
            </Button>
            <Button variant="secondary" size="sm" aria-label="Camera">
              <Video className="h-4 w-4" aria-hidden /> Camera
            </Button>
            <Button variant="secondary" size="sm" aria-label="Share screen">
              <MonitorUp className="h-4 w-4" aria-hidden /> Share
            </Button>
            <Button variant="destructive" size="sm" aria-label="Leave">
              <PhoneOff className="h-4 w-4" aria-hidden /> Leave
            </Button>
          </div>
        </section>

        <section className="col-span-12 lg:col-span-3 rounded-2xl border border-navy-800 bg-navy-900 p-2">
          <ChatPanel
            engagementId={p.engagementId}
            selfAddress={p.selfAddress}
            peerAddress={p.peerAddress}
            role={p.role}
          />
        </section>
      </div>
    </div>
  );
}
