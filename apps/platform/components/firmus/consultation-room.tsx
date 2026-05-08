'use client';
// Owner spec: 001-verified-legal-engagement.

import { useEffect, useState } from 'react';
import { Mic, Video, MonitorUp, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ChatPanel } from './chat-panel';
import { formatETH } from '@/lib/format/eth';
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
  const [busy, setBusy] = useState(false);

  async function markComplete() {
    setBusy(true);
    try {
      const r = await fetch(`/api/consultations/${p.consultationId}/complete`, { method: 'POST' });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        alert(`Failed: ${j.error ?? r.status}`);
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

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
          </div>
          <div className="text-xs text-slate-300">
            Status: <span className="text-white-0">{p.status}</span>
          </div>
        </header>

        <section className="col-span-12 lg:col-span-3 rounded-2xl border border-navy-800 bg-navy-900 p-4">
          <h3 className="text-sm font-semibold text-white-0">Proposals</h3>
          <p className="mt-2 text-xs text-slate-300">
            {p.consultationKind === 'PAID'
              ? 'Consultation funded as proposal index 0.'
              : 'Free consultation. Lawyer can issue proposals after.'}
          </p>
          {p.role === 'client' && p.status !== 'COMPLETED' ? (
            <Button onClick={markComplete} disabled={busy} size="sm" className="mt-3 w-full">
              {busy ? 'Releasing…' : 'Mark complete'}
            </Button>
          ) : null}
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
