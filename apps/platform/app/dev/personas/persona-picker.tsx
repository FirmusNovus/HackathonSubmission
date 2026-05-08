'use client';
// Owner spec: 001-verified-legal-engagement.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { AvatarBubble } from '@/components/firmus/avatar-bubble';
import { truncateAddress } from '@/lib/format/address';

interface PersonaView {
  index: number;
  walletAddress: string;
  displayName: string;
  roles: Array<'client' | 'lawyer'>;
}

export function PersonaPicker({ personas }: { personas: PersonaView[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function pick(persona: number, role: string) {
    setBusy(persona);
    setError(null);
    try {
      const r = await fetch('/api/dev/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? 'login-failed');
      }
      const target = role === 'lawyer' ? '/lawyer/dashboard' : '/client/home';
      router.push(target);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-6 grid gap-3 sm:grid-cols-2">
      {personas.map((p) => (
        <Card key={p.index} className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <AvatarBubble name={p.displayName} size={56} />
            <div>
              <div className="font-medium text-navy-900">{p.displayName}</div>
              <div className="text-xs text-slate-500">
                {p.roles.join(', ')} · <span className="font-mono">{truncateAddress(p.walletAddress)}</span>
              </div>
            </div>
          </div>
          <Button
            onClick={() => pick(p.index, p.roles[0]!)}
            disabled={busy === p.index}
            size="sm"
          >
            {busy === p.index ? 'Loading…' : 'Use'}
          </Button>
        </Card>
      ))}
      {error ? <div className="col-span-2 text-sm text-red-500">Error: {error}</div> : null}
    </div>
  );
}
