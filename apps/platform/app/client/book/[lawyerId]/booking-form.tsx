'use client';
// Owner spec: 001-verified-legal-engagement.

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { ChainUnavailableBanner } from '@/components/firmus/chain-unavailable-banner';
import { formatETH } from '@/lib/format/eth';

const PRACTICE_AREAS = [
  'Family',
  'Estate',
  'Property',
  'Employment',
  'Immigration',
  'Business',
  'Tax',
  'IP',
];

interface Props {
  lawyerAddress: string;
  lawyerName: string;
  consultationKind: 'FREE' | 'PAID';
  rate30Wei: string;
  rate60Wei: string;
  clientAddress: string;
}

export function BookingForm(p: Props) {
  const router = useRouter();
  const [scheduled, setScheduled] = useState(() => defaultScheduledAt());
  const [duration, setDuration] = useState<30 | 60>(30);
  const [practiceArea, setPracticeArea] = useState(PRACTICE_AREAS[0]!);
  const [caseDescription, setCaseDescription] = useState('');
  const [healthy, setHealthy] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/chain-health')
      .then((r) => r.json())
      .then((j: { healthy: boolean }) => setHealthy(j.healthy))
      .catch(() => setHealthy(false));
  }, []);

  const fee = duration === 30 ? p.rate30Wei : p.rate60Wei;
  const isPaid = p.consultationKind === 'PAID';

  async function submit() {
    setError(null);
    if (caseDescription.trim().length < 20) {
      setError('Case description must be at least 20 characters.');
      return;
    }
    setBusy(true);
    try {
      const r = await fetch('/api/consultations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lawyerAddress: p.lawyerAddress,
          scheduledAt: Math.floor(new Date(scheduled).getTime() / 1000),
          durationMinutes: duration,
          practiceArea,
          caseDescription,
        }),
      });
      const j = (await r.json()) as { ok: boolean; engagementId?: number; error?: string };
      if (!r.ok || !j.ok || !j.engagementId) throw new Error(j.error ?? 'create-failed');
      router.push(`/client/consultation/${j.engagementId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 space-y-5 p-6">
      {healthy === false ? <ChainUnavailableBanner /> : null}

      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Date &amp; time
        </label>
        <Input
          type="datetime-local"
          value={scheduled}
          onChange={(e) => setScheduled(e.target.value)}
          className="mt-1"
        />
      </div>

      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Duration</label>
        <div className="mt-1 flex gap-2">
          {[30, 60].map((d) => (
            <Button
              key={d}
              type="button"
              variant={duration === d ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setDuration(d as 30 | 60)}
            >
              {d} min
            </Button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">Practice area</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {PRACTICE_AREAS.map((a) => (
            <Button
              key={a}
              type="button"
              variant={practiceArea === a ? 'primary' : 'secondary'}
              size="sm"
              onClick={() => setPracticeArea(a)}
            >
              {a}
            </Button>
          ))}
        </div>
      </div>

      <div>
        <label className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Case description (≥ 20 characters)
        </label>
        <Textarea
          rows={5}
          className="mt-1"
          value={caseDescription}
          onChange={(e) => setCaseDescription(e.target.value)}
          placeholder="Briefly explain the matter you'd like to discuss…"
        />
      </div>

      {isPaid ? (
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">Consultation fee</span>
            <span className="font-medium">{formatETH(fee)}</span>
          </div>
          <p className="mt-2 text-xs text-slate-500">
            Secure payment held until your consultation completes. You can cancel before
            the lawyer accepts; both parties co-sign the refund.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-teal-300 bg-teal-50 p-4 text-sm text-teal-700">
          Free initial consultation. No on-chain payment required at this step.
        </div>
      )}

      {error ? <div className="text-sm text-red-500">{error}</div> : null}

      <Button onClick={submit} disabled={busy || healthy === false} className="w-full">
        {busy ? 'Confirming…' : 'Confirm and submit request'}
      </Button>
    </Card>
  );
}

function defaultScheduledAt(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  d.setMinutes(0, 0, 0);
  // local datetime-local format YYYY-MM-DDTHH:MM
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
