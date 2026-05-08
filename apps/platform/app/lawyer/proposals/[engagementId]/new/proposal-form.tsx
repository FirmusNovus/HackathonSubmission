'use client';
// Owner spec: 001-verified-legal-engagement.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { formatETH } from '@/lib/format/eth';

interface LineItem {
  id: string;
  title: string;
  description?: string;
  kind: 'hourly' | 'fixed';
  hours?: string;
  ratePerHour?: string;
  fixedPrice?: string;
}

interface Deliverable {
  id: string;
  title: string;
  description?: string;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 9);
}

function subtotalWei(li: LineItem): bigint {
  if (li.kind === 'fixed') return BigInt(li.fixedPrice || '0');
  const h = li.hours ? BigInt(li.hours) : 0n;
  const r = li.ratePerHour ? BigInt(li.ratePerHour) : 0n;
  return h * r;
}

export function ProposalForm({ engagementId }: { engagementId: number }) {
  const router = useRouter();
  const [items, setItems] = useState<LineItem[]>([
    { id: uid(), title: '', kind: 'fixed', fixedPrice: '10000000000000000' },
  ]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>([{ id: uid(), title: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.reduce((sum, li) => sum + subtotalWei(li), 0n);
  const platformFee = (total * 500n) / 10000n;

  function addItem() {
    setItems((s) => [...s, { id: uid(), title: '', kind: 'fixed', fixedPrice: '10000000000000000' }]);
  }
  function removeItem(id: string) {
    setItems((s) => s.filter((i) => i.id !== id));
  }
  function patchItem(id: string, patch: Partial<LineItem>) {
    setItems((s) => s.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }
  function addDeliverable() {
    setDeliverables((s) => [...s, { id: uid(), title: '' }]);
  }
  function removeDeliverable(id: string) {
    setDeliverables((s) => s.filter((d) => d.id !== id));
  }

  async function submit() {
    if (items.some((i) => !i.title || subtotalWei(i) <= 0n)) {
      setError('Every line item must have a title and a positive price.');
      return;
    }
    if (deliverables.some((d) => !d.title)) {
      setError('Every deliverable must have a title.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          engagementId,
          lineItems: items.map((i) => ({
            ...i,
            subtotal: subtotalWei(i).toString(),
          })),
          deliverables,
        }),
      });
      const j = (await r.json()) as { ok?: boolean; error?: string; proposalIndex?: number };
      if (!r.ok || !j.ok) throw new Error(j.error ?? 'failed');
      router.push(`/lawyer/consultation/${engagementId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-6 space-y-5 p-6">
      <div className="space-y-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Line items</div>
        {items.map((li) => (
          <div key={li.id} className="grid gap-2 rounded-lg border border-slate-100 p-3 sm:grid-cols-[2fr_auto_auto_auto]">
            <Input
              placeholder="Title (e.g. Draft will)"
              value={li.title}
              onChange={(e) => patchItem(li.id, { title: e.target.value })}
            />
            <select
              className="h-10 rounded-lg border border-slate-100 bg-white-0 px-3 text-sm"
              value={li.kind}
              onChange={(e) => patchItem(li.id, { kind: e.target.value as 'hourly' | 'fixed' })}
            >
              <option value="fixed">Fixed</option>
              <option value="hourly">Hourly</option>
            </select>
            {li.kind === 'fixed' ? (
              <Input
                placeholder="Price (wei)"
                value={li.fixedPrice ?? ''}
                onChange={(e) => patchItem(li.id, { fixedPrice: e.target.value })}
                className="font-mono"
              />
            ) : (
              <div className="flex gap-2">
                <Input
                  placeholder="Hours"
                  value={li.hours ?? ''}
                  onChange={(e) => patchItem(li.id, { hours: e.target.value })}
                  className="w-20"
                />
                <Input
                  placeholder="Rate/h (wei)"
                  value={li.ratePerHour ?? ''}
                  onChange={(e) => patchItem(li.id, { ratePerHour: e.target.value })}
                  className="font-mono"
                />
              </div>
            )}
            <Button variant="ghost" size="sm" onClick={() => removeItem(li.id)} aria-label="Remove line item">
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={addItem}>
          <Plus className="h-4 w-4" aria-hidden /> Add line item
        </Button>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Deliverables</div>
        {deliverables.map((d) => (
          <div key={d.id} className="flex items-center gap-2">
            <Input
              placeholder="Deliverable (e.g. Final will document)"
              value={d.title}
              onChange={(e) =>
                setDeliverables((s) => s.map((x) => (x.id === d.id ? { ...x, title: e.target.value } : x)))
              }
            />
            <Button variant="ghost" size="sm" onClick={() => removeDeliverable(d.id)} aria-label="Remove deliverable">
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={addDeliverable}>
          <Plus className="h-4 w-4" aria-hidden /> Add deliverable
        </Button>
      </div>

      <div className="rounded-lg border border-slate-100 bg-slate-50 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Total</span>
          <span className="font-medium">{formatETH(total)}</span>
        </div>
        <div className="mt-1 flex justify-between text-xs text-slate-500">
          <span>Platform fee (5%)</span>
          <span>{formatETH(platformFee)}</span>
        </div>
      </div>

      {error ? <div className="text-sm text-red-500">{error}</div> : null}

      <Button onClick={submit} disabled={busy} className="w-full">
        {busy ? 'Signing & sending…' : 'Sign & send to client'}
      </Button>
    </Card>
  );
}
