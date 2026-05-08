"use client";

import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { formatEUR } from "@/lib/utils/format";
import type { Deliverable, LineItem } from "@/types";

export function newId() {
  return `i_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultHourlyLine(durationMinutes: 30 | 60, ratePerHour: number): LineItem {
  const hours = durationMinutes / 60;
  return {
    id: newId(),
    title: `${durationMinutes}-minute consultation`,
    kind: "hourly",
    hours,
    ratePerHour,
    subtotal: +(hours * ratePerHour).toFixed(2),
  };
}

export function recomputeSubtotal(li: LineItem): LineItem {
  const hours = Number(li.hours) || 0;
  const rate = Number(li.ratePerHour) || 0;
  const fixed = Number(li.fixedPrice) || 0;
  return { ...li, subtotal: li.kind === "hourly" ? +(hours * rate).toFixed(2) : +fixed.toFixed(2) };
}

interface LineItemsEditorProps {
  items: LineItem[];
  onChange: (items: LineItem[]) => void;
}

export function LineItemsEditor({ items, onChange }: LineItemsEditorProps) {
  const update = (id: string, patch: Partial<LineItem>) =>
    onChange(items.map((li) => (li.id === id ? recomputeSubtotal({ ...li, ...patch }) : li)));
  const remove = (id: string) => onChange(items.filter((li) => li.id !== id));

  return (
    <div>
      <ul className="space-y-2">
        {items.map((li) => (
          <li key={li.id} className="rounded-lg border border-slate-100 bg-white-0 p-3">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
              <Input value={li.title} onChange={(e) => update(li.id, { title: e.target.value })} className="text-[14px]" />
              <select
                value={li.kind}
                onChange={(e) => update(li.id, { kind: e.target.value as LineItem["kind"] })}
                className="h-11 rounded-lg border border-slate-100 bg-white-0 px-2 text-[13px]"
              >
                <option value="hourly">Hourly</option>
                <option value="fixed">Fixed</option>
              </select>
              {li.kind === "hourly" ? (
                <>
                  <Input
                    type="number"
                    step="0.25"
                    min={0}
                    value={li.hours ?? ""}
                    onChange={(e) => update(li.id, { hours: Number(e.target.value) })}
                    placeholder="hrs"
                    className="w-20 text-[14px]"
                  />
                  <Input
                    type="number"
                    step="10"
                    min={0}
                    value={li.ratePerHour ?? ""}
                    onChange={(e) => update(li.id, { ratePerHour: Number(e.target.value) })}
                    placeholder="€/hr"
                    className="w-24 text-[14px]"
                  />
                </>
              ) : (
                <Input
                  type="number"
                  step="10"
                  min={0}
                  value={li.fixedPrice ?? ""}
                  onChange={(e) => update(li.id, { fixedPrice: Number(e.target.value) })}
                  placeholder="€"
                  className="col-span-2 w-full text-[14px]"
                />
              )}
              <button
                type="button"
                onClick={() => remove(li.id)}
                aria-label="Remove line item"
                className="rounded-md p-2 text-slate-400 hover:bg-slate-50 hover:text-red-500"
                disabled={items.length === 1}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <div className="mt-2 flex justify-end text-[12px] text-slate-500">
              Subtotal:&nbsp;<span className="font-medium text-navy-900">{formatEUR(li.subtotal)}</span>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() =>
          onChange([
            ...items,
            { id: newId(), title: "Additional item", kind: "fixed", fixedPrice: 0, subtotal: 0 },
          ])
        }
        className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-teal-600 hover:underline"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add line item
      </button>
    </div>
  );
}

interface DeliverablesEditorProps {
  items: Deliverable[];
  onChange: (items: Deliverable[]) => void;
}

export function DeliverablesEditor({ items, onChange }: DeliverablesEditorProps) {
  const update = (id: string, patch: Partial<Deliverable>) =>
    onChange(items.map((d) => (d.id === id ? { ...d, ...patch } : d)));
  const remove = (id: string) => onChange(items.filter((d) => d.id !== id));

  return (
    <div>
      <ul className="space-y-2">
        {items.map((d) => (
          <li key={d.id} className="rounded-lg border border-slate-100 bg-white-0 p-3">
            <div className="flex items-start gap-2">
              <div className="flex-1 space-y-1">
                <Input
                  value={d.title}
                  onChange={(e) => update(d.id, { title: e.target.value })}
                  className="text-[14px]"
                  placeholder="What you'll deliver"
                />
                <Textarea
                  value={d.description ?? ""}
                  onChange={(e) => update(d.id, { description: e.target.value })}
                  rows={2}
                  placeholder="Optional detail."
                  className="min-h-[44px] text-[13px]"
                />
              </div>
              <button
                type="button"
                onClick={() => remove(d.id)}
                aria-label="Remove deliverable"
                className="rounded-md p-2 text-slate-400 hover:bg-slate-50 hover:text-red-500"
                disabled={items.length === 1}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={() => onChange([...items, { id: newId(), title: "" }])}
        className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-teal-600 hover:underline"
      >
        <Plus className="h-3.5 w-3.5" aria-hidden /> Add deliverable
      </button>
    </div>
  );
}
