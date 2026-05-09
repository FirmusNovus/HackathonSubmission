"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Lock, Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatEUR, truncateAddress } from "@/lib/utils/format";
import type { Deliverable, LineItem } from "@/types";

interface KnownClient {
  id: string;
  name: string | null;
  walletAddress: string;
}

interface LawyerInvoiceFormProps {
  knownClients: KnownClient[];
  defaultRatePerHour: number;
  /** When opened from the chat thread, the client's wallet is passed in via ?client=. */
  preselectedClientWallet?: string;
}

const PRACTICE_AREAS = ["Family", "Estate", "Property", "Employment", "Immigration", "Business", "Tax", "IP"];

function newId() {
  return `i_${Math.random().toString(36).slice(2, 10)}`;
}

function defaultDateTime(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 30, 0, 0);
  return d.toISOString().slice(0, 16);
}

function defaultLineItem(durationMinutes: 30 | 60, ratePerHour: number): LineItem {
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

const DEFAULT_DELIVERABLES: Deliverable[] = [
  { id: newId(), title: "Live consultation", description: "Real-time video meeting at the scheduled time" },
];

export function LawyerInvoiceForm({ knownClients, defaultRatePerHour, preselectedClientWallet }: LawyerInvoiceFormProps) {
  // If we arrived from a chat thread, prefer matching against the existing
  // client list — fall back to "new client by wallet" with the address pre-filled.
  const matchedKnown = preselectedClientWallet
    ? knownClients.find((c) => c.walletAddress.toLowerCase() === preselectedClientWallet.toLowerCase())
    : undefined;
  const [picker, setPicker] = useState<"existing" | "new">(
    matchedKnown ? "existing" : preselectedClientWallet ? "new" : knownClients.length ? "existing" : "new",
  );
  const [pickedClientId, setPickedClientId] = useState<string>(matchedKnown?.id ?? knownClients[0]?.id ?? "");
  const [newClientWallet, setNewClientWallet] = useState(matchedKnown ? "" : preselectedClientWallet ?? "");
  const [duration, setDuration] = useState<30 | 60>(60);
  const [scheduledAt, setScheduledAt] = useState(defaultDateTime());
  const [practiceArea, setPracticeArea] = useState(PRACTICE_AREAS[0]);
  const [caseDescription, setCaseDescription] = useState("");
  const [lineItems, setLineItems] = useState<LineItem[]>(() => [defaultLineItem(60, defaultRatePerHour || 240)]);
  const [deliverables, setDeliverables] = useState<Deliverable[]>(DEFAULT_DELIVERABLES);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the headline line item when duration changes (only if untouched).
  useEffect(() => {
    setLineItems((cur) => {
      if (cur.length === 0) return [defaultLineItem(duration, defaultRatePerHour || 240)];
      const [first, ...rest] = cur;
      if (first.kind !== "hourly") return cur;
      const isUntouched = first.title.startsWith("30-minute") || first.title.startsWith("60-minute");
      if (!isUntouched) return cur;
      return [defaultLineItem(duration, defaultRatePerHour || 240), ...rest];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  const total = useMemo(() => +lineItems.reduce((s, li) => s + (Number(li.subtotal) || 0), 0).toFixed(2), [lineItems]);
  const platformFee = useMemo(() => +(total * 0.05).toFixed(2), [total]);

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
    let clientWalletAddress = "";
    if (picker === "existing") {
      const c = knownClients.find((k) => k.id === pickedClientId);
      if (!c) {
        setError("Pick a client from the list (or switch to 'new client').");
        return;
      }
      clientWalletAddress = c.walletAddress;
    } else {
      clientWalletAddress = newClientWallet.trim();
      if (!/^0x[0-9a-fA-F]{4,}$/.test(clientWalletAddress)) {
        setError("Enter the client's wallet address (it starts with 0x).");
        return;
      }
    }
    if (!caseDescription.trim()) {
      setError("Describe the work this invoice covers.");
      return;
    }
    if (lineItems.length === 0 || total <= 0) {
      setError("Add at least one line item with a non-zero amount.");
      return;
    }
    if (deliverables.length === 0) {
      setError("Add at least one deliverable.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/lawyer/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientWalletAddress,
          scheduledAt: new Date(scheduledAt).toISOString(),
          durationMinutes: duration,
          practiceArea,
          caseDescription,
          lineItems,
          deliverables,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Could not send the invoice.");
        return;
      }
      const data = (await res.json()) as { booking: { id: string } };
      // Land on the request review page so the lawyer sees their newly-signed
      // invoice, plus the "Awaiting client signature" state.
      window.location.href = `/lawyer/requests/${data.booking.id}`;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6 rounded-2xl border border-slate-100 bg-white-0 p-7">
        <fieldset>
          <legend className="text-[13px] font-medium text-navy-900">Bill to</legend>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setPicker("existing")}
              disabled={knownClients.length === 0}
              className={
                picker === "existing"
                  ? "rounded-md border-2 border-teal-500 bg-teal-50 px-3 py-1.5 text-[13px] font-medium text-teal-700"
                  : "rounded-md border border-slate-100 bg-white-0 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:border-slate-200 disabled:opacity-50"
              }
            >
              Existing client
            </button>
            <button
              type="button"
              onClick={() => setPicker("new")}
              className={
                picker === "new"
                  ? "rounded-md border-2 border-teal-500 bg-teal-50 px-3 py-1.5 text-[13px] font-medium text-teal-700"
                  : "rounded-md border border-slate-100 bg-white-0 px-3 py-1.5 text-[13px] font-medium text-slate-700 hover:border-slate-200"
              }
            >
              New client by wallet
            </button>
          </div>

          {picker === "existing" ? (
            <select
              value={pickedClientId}
              onChange={(e) => setPickedClientId(e.target.value)}
              className="mt-3 h-11 w-full rounded-lg border border-slate-100 bg-white-0 px-3.5 text-[15px] text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-50"
            >
              {knownClients.length === 0 && <option value="">No previous clients yet</option>}
              {knownClients.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name ?? "Anonymous"} · {truncateAddress(c.walletAddress)}
                </option>
              ))}
            </select>
          ) : (
            <Input
              className="mt-3"
              placeholder="0x… (client's wallet address)"
              value={newClientWallet}
              onChange={(e) => setNewClientWallet(e.target.value)}
            />
          )}
          <p className="mt-2 text-[12px] text-slate-500">
            The client must have signed in once before — their wallet is the unique billing address.
          </p>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label className="mb-2 block">Scheduled time</Label>
            <Input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} />
          </div>
          <div>
            <Label className="mb-2 block">Practice area</Label>
            <select
              value={practiceArea}
              onChange={(e) => setPracticeArea(e.target.value)}
              className="h-11 w-full rounded-lg border border-slate-100 bg-white-0 px-3.5 text-[15px] text-navy-900 focus:border-teal-500 focus:outline-none focus:ring-2 focus:ring-teal-50"
            >
              {PRACTICE_AREAS.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <Label className="mb-2 block">Duration</Label>
          <RadioGroup
            value={String(duration)}
            onValueChange={(v) => setDuration(Number(v) as 30 | 60)}
            className="grid grid-cols-2 gap-3"
          >
            {[30, 60].map((d) => (
              <label
                key={d}
                className={
                  duration === d
                    ? "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-teal-500 bg-teal-50 p-4"
                    : "flex cursor-pointer items-center gap-3 rounded-xl border-2 border-slate-100 bg-white-0 p-4"
                }
              >
                <RadioGroupItem value={String(d)} />
                <div className="text-[14px] font-semibold text-navy-900">{d} minutes</div>
              </label>
            ))}
          </RadioGroup>
        </div>

        <div>
          <Label className="mb-2 block">What this invoice covers</Label>
          <Textarea
            value={caseDescription}
            onChange={(e) => setCaseDescription(e.target.value)}
            rows={5}
            placeholder="Brief summary of the work — the client sees this on their invoice."
          />
        </div>

        <fieldset className="rounded-xl border border-slate-100 bg-white-50 p-5">
          <legend className="px-2 text-[13px] font-medium text-navy-900">Line items</legend>
          <ul className="space-y-2">
            {lineItems.map((li) => (
              <li key={li.id} className="rounded-lg border border-slate-100 bg-white-0 p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto_auto]">
                  <Input value={li.title} onChange={(e) => updateLineItem(li.id, { title: e.target.value })} className="text-[14px]" />
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
      </div>

      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-slate-100 bg-white-0 p-6">
          <div className="text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">Invoice total</div>
          <div className="mt-3 space-y-2 text-[14px]">
            <Row label="Line items" value={formatEUR(total)} />
            <Row label="Platform fee (5%)" value={formatEUR(platformFee)} />
            <hr className="my-2 border-t border-slate-100" />
            <Row label="Held in escrow on dual signoff" value={formatEUR(total + platformFee)} bold />
          </div>
          <p className="mt-2 text-[12px] text-slate-500">
            By submitting you sign this invoice as the lawyer. The client must counter-sign before any funds move.
          </p>
          <Button onClick={submit} disabled={submitting} size="lg" className="mt-5 w-full">
            {submitting ? "Sending invoice…" : "Sign & send invoice"} <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <p className="mt-3 flex items-center justify-center gap-1.5 text-[12px] text-slate-500">
            <Lock className="h-3 w-3 text-teal-600" aria-hidden /> Both parties must sign before payment.
          </p>
          {error && <p className="mt-3 text-[13px] text-red-500">{error}</p>}
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
