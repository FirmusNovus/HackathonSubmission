"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Lock, Plus, Trash2, ShieldCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatEUR } from "@/lib/utils/format";
import type { Deliverable, LineItem } from "@/types";

interface ProposalOfferFormProps {
  engagementId: number;
  defaultRatePerHour: number;
  bookingId: string | null;
  clientName: string | null;
}

function newId() {
  return `i_${Math.random().toString(36).slice(2, 10)}`;
}

const DEFAULT_DELIVERABLES: Deliverable[] = [
  { id: newId(), title: "Follow-up document review", description: "Review and annotate the client's documents." },
];

export function ProposalOfferForm({ engagementId, defaultRatePerHour, bookingId, clientName }: ProposalOfferFormProps) {
  const router = useRouter();
  const [lineItems, setLineItems] = useState<LineItem[]>(() => [
    {
      id: newId(),
      title: "Follow-up work",
      kind: "hourly",
      hours: 2,
      ratePerHour: defaultRatePerHour || 240,
      subtotal: 2 * (defaultRatePerHour || 240),
    },
  ]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>(DEFAULT_DELIVERABLES);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = useMemo(() => +lineItems.reduce((s, li) => s + (Number(li.subtotal) || 0), 0).toFixed(2), [lineItems]);

  const updateLineItem = (id: string, patch: Partial<LineItem>) => {
    setLineItems((cur) =>
      cur.map((li) => {
        if (li.id !== id) return li;
        const next = { ...li, ...patch };
        const hours = Number(next.hours) || 0;
        const rate = Number(next.ratePerHour) || 0;
        const fixed = Number(next.fixedPrice) || 0;
        next.subtotal = next.kind === "hourly" ? +(hours * rate).toFixed(2) : +fixed.toFixed(2);
        return next;
      }),
    );
  };

  const submit = async () => {
    setError(null);
    if (lineItems.length === 0 || total <= 0) {
      setError("Add at least one line item with a non-zero amount.");
      return;
    }
    if (deliverables.length === 0 || deliverables.some((d) => !d.title.trim())) {
      setError("Each deliverable needs a title.");
      return;
    }
    setSubmitting(true);
    try {
      // Step 1: ask the dev signer to produce an EIP-712 signature over the
      // canonical (engagementId, amount, itemsHash, nonce) typed-data. The
      // dev path uses the seeded persona's deterministic key; production
      // would call wagmi's `signTypedData` with the same primaryType +
      // domain so the wire format is identical.
      const amountWei = BigInt(Math.round(total * 100)).toString(10);
      const signRes = await fetch("/api/dev/sign-proposal-offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          amountWei,
          items: lineItems,
          deliverables,
        }),
      });
      if (!signRes.ok) {
        const j = (await signRes.json().catch(() => ({}))) as { error?: string | { message?: string } };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not produce signature.";
        setError(msg);
        return;
      }
      const signed = (await signRes.json()) as { signature: string; nonce: string; itemsHash: string };

      // Step 2: post the offer + signature to /api/proposals; server recovers
      // signer + persists the row.
      const offerRes = await fetch("/api/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementId,
          amountWei,
          itemsHash: signed.itemsHash,
          nonce: signed.nonce,
          signature: signed.signature,
          items: lineItems,
          deliverables,
          note: note.trim() || null,
        }),
      });
      if (!offerRes.ok) {
        const j = (await offerRes.json().catch(() => ({}))) as { error?: string | { message?: string } };
        const msg = typeof j.error === "string" ? j.error : j.error?.message ?? "Could not send the offer.";
        setError(msg);
        return;
      }
      // Land back on the consultation room so the lawyer sees the rail
      // update with the new offer entry.
      const dest = bookingId
        ? `/lawyer/consultation/${bookingId}?proposal=sent`
        : "/lawyer/dashboard";
      router.push(dest);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6 rounded-2xl border border-slate-100 bg-white-0 p-7">
        <fieldset className="rounded-xl border border-slate-100 bg-white-50 p-5">
          <legend className="px-2 text-[13px] font-medium text-navy-900">Line items</legend>
          <ul className="space-y-2">
            {lineItems.map((li) => (
              <li key={li.id} className="rounded-lg border border-slate-100 bg-white-0 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
                  <Input
                    value={li.title}
                    onChange={(e) => updateLineItem(li.id, { title: e.target.value })}
                    className="text-[14px]"
                  />
                  <select
                    value={li.kind}
                    onChange={(e) => updateLineItem(li.id, { kind: e.target.value as LineItem["kind"] })}
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
                        onChange={(e) => updateLineItem(li.id, { hours: Number(e.target.value) })}
                        placeholder="hrs"
                        className="w-20 text-[14px]"
                      />
                      <Input
                        type="number"
                        step="10"
                        min={0}
                        value={li.ratePerHour ?? ""}
                        onChange={(e) => updateLineItem(li.id, { ratePerHour: Number(e.target.value) })}
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
                      onChange={(e) => updateLineItem(li.id, { fixedPrice: Number(e.target.value) })}
                      placeholder="€"
                      className="col-span-2 w-full text-[14px]"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => setLineItems((cur) => cur.filter((x) => x.id !== li.id))}
                    aria-label="Remove line item"
                    className="rounded-md p-2 text-slate-400 hover:bg-slate-50 hover:text-red-500"
                    disabled={lineItems.length === 1}
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
              setLineItems((cur) => [
                ...cur,
                { id: newId(), title: "Additional item", kind: "fixed", fixedPrice: 0, subtotal: 0 },
              ])
            }
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-teal-600 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add line item
          </button>

          <div className="mt-6 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
            Deliverables / objectives
          </div>
          <ul className="mt-2 space-y-2">
            {deliverables.map((d) => (
              <li key={d.id} className="rounded-lg border border-slate-100 bg-white-0 p-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <Input
                      value={d.title}
                      onChange={(e) =>
                        setDeliverables((cur) => cur.map((x) => (x.id === d.id ? { ...x, title: e.target.value } : x)))
                      }
                      className="text-[14px]"
                      placeholder="What you'll deliver"
                    />
                    <Textarea
                      value={d.description ?? ""}
                      onChange={(e) =>
                        setDeliverables((cur) =>
                          cur.map((x) => (x.id === d.id ? { ...x, description: e.target.value } : x)),
                        )
                      }
                      rows={2}
                      placeholder="Optional detail."
                      className="min-h-[44px] text-[13px]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setDeliverables((cur) => cur.filter((x) => x.id !== d.id))}
                    aria-label="Remove deliverable"
                    className="rounded-md p-2 text-slate-400 hover:bg-slate-50 hover:text-red-500"
                    disabled={deliverables.length === 1}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => setDeliverables((cur) => [...cur, { id: newId(), title: "" }])}
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-teal-600 hover:underline"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden /> Add deliverable
          </button>
        </fieldset>

        <div>
          <Label htmlFor="proposal-note" className="mb-2 block">
            Note for {clientName ?? "the client"}{" "}
            <span className="text-[12px] font-normal text-slate-500">(optional)</span>
          </Label>
          <Textarea
            id="proposal-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder="Why this follow-up — anything you want them to read before they fund."
          />
        </div>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-slate-100 bg-white-0 p-6">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Offer total</div>
          <div className="mt-3 space-y-2 text-[14px]">
            <Row label="Line items" value={formatEUR(total)} bold />
          </div>
          <p className="mt-2 text-[12px] text-slate-500">
            Signing this commits you cryptographically to the offer. The client decides when (and if) to fund it.
          </p>
          <Button
            onClick={submit}
            disabled={submitting}
            size="lg"
            className="mt-5 w-full"
            data-testid="sign-and-send-offer"
          >
            <ShieldCheck className="h-4 w-4" aria-hidden /> {submitting ? "Signing…" : "Sign and send offer"}{" "}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-slate-500">
            <Lock className="h-3 w-3 text-teal-600" aria-hidden /> EIP-712 typed-data signature.
          </p>
          {error && (
            <p className="mt-3 text-[13px] text-red-500" data-testid="proposal-form-error">
              {error}
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={bold ? "font-semibold text-navy-900" : "text-slate-500"}>{label}</span>
      <span className={bold ? "font-semibold text-navy-900" : "text-navy-900"}>{value}</span>
    </div>
  );
}
