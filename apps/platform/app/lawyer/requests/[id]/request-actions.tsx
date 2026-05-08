'use client';
// Owner spec: 001-verified-legal-engagement.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import type { ConsultationStatus } from '@/lib/db/consultations';

interface Props {
  consultationId: number;
  status: ConsultationStatus;
}

export function RequestActions({ consultationId, status }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (status !== 'REQUESTED') {
    return (
      <div className="mt-6 text-sm text-slate-500">
        Status: <strong>{status}</strong>
      </div>
    );
  }

  async function send(action: 'accept' | 'decline') {
    setBusy(action);
    setError(null);
    try {
      const r = await fetch(`/api/consultations/${consultationId}/${action}`, { method: 'POST' });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!r.ok || !j.ok) throw new Error(j.error ?? `${action}-failed`);
      router.push('/lawyer/dashboard');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 flex items-center gap-3">
      <Button onClick={() => send('accept')} disabled={busy !== null}>
        {busy === 'accept' ? 'Accepting…' : 'Accept'}
      </Button>
      <Button variant="ghost" onClick={() => send('decline')} disabled={busy !== null}>
        {busy === 'decline' ? 'Declining…' : 'Decline'}
      </Button>
      {error ? <span className="text-sm text-red-500">{error}</span> : null}
    </div>
  );
}
