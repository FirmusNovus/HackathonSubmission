'use client';
// Owner spec: 001-verified-legal-engagement.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

interface Props {
  engagementId: number;
  proposalIndex: number;
  totalWei: string;
}

export function ResolveForm({ engagementId, proposalIndex, totalWei }: Props) {
  const router = useRouter();
  const [toLawyer, setToLawyer] = useState(totalWei);
  const [toClient, setToClient] = useState('0');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sum = (() => {
    try {
      return BigInt(toLawyer) + BigInt(toClient);
    } catch {
      return -1n;
    }
  })();
  const sumOk = sum === BigInt(totalWei);

  async function submit() {
    if (!sumOk) {
      setError('Split must sum exactly to the parked amount.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/operator/disputes/${engagementId}/${proposalIndex}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ toLawyer, toClient }),
      });
      if (!r.ok) {
        const j = (await r.json()) as { error?: string };
        throw new Error(j.error ?? 'resolve-failed');
      }
      router.push('/operator/disputes');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 space-y-3 p-6">
      <h3 className="text-base font-semibold text-navy-900">Decide split (wei)</h3>
      <div>
        <label className="text-xs text-slate-500">To lawyer</label>
        <Input value={toLawyer} onChange={(e) => setToLawyer(e.target.value)} />
      </div>
      <div>
        <label className="text-xs text-slate-500">To client</label>
        <Input value={toClient} onChange={(e) => setToClient(e.target.value)} />
      </div>
      <div className={`text-xs ${sumOk ? 'text-teal-700' : 'text-red-500'}`}>
        Sum: {sum.toString()} / target {totalWei} {sumOk ? '✓' : '✗'}
      </div>
      {error ? <div className="text-sm text-red-500">{error}</div> : null}
      <Button onClick={submit} disabled={!sumOk || busy} className="w-full">
        {busy ? 'Resolving…' : 'Resolve'}
      </Button>
    </Card>
  );
}
