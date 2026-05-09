"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatEUR } from "@/lib/utils/format";

// =============================================================================
// Resolve form — F7
// -----------------------------------------------------------------------------
// Client-side form for the operator's split. The two inputs accept EUR (with
// up to 2 decimals); we convert to wei = cents (the mock-chain convention,
// see lib/chain/booking-bridge.ts:eurToWei). Server-side sum-equality is the
// authoritative check; this form mirrors it client-side for UX.
//
// Conversion strategy: parse the two EUR strings as integer cents
// independently, sum the cents (no float math), and compare against the
// proposal's amountWei (which IS cents in the mock world). Production swap-
// in: replace eur→wei with the on-chain stablecoin's decimals().
// =============================================================================

function eurStringToCents(input: string): bigint | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // Allow "0", "12", "12.5", "12.50", "12,50" — but reject negative or junk.
  const normalised = trimmed.replace(/,/g, ".");
  if (!/^\d+(\.\d{0,2})?$/.test(normalised)) return null;
  const [whole, frac = ""] = normalised.split(".");
  const padded = (frac + "00").slice(0, 2);
  return BigInt(whole) * 100n + BigInt(padded);
}

interface ResolveFormProps {
  engagementId: number;
  proposalIndex: number;
  amountEUR: number;
  /** Decimal-string wei (cents in the mock). */
  amountWei: string;
}

export function ResolveForm({
  engagementId,
  proposalIndex,
  amountEUR,
  amountWei,
}: ResolveFormProps) {
  const router = useRouter();
  const totalCents = useMemo(() => BigInt(amountWei), [amountWei]);

  const [toLawyer, setToLawyer] = useState("");
  const [toClient, setToClient] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const lawyerCents = eurStringToCents(toLawyer);
  const clientCents = eurStringToCents(toClient);
  const bothParsed = lawyerCents != null && clientCents != null;
  const sumCents = bothParsed ? lawyerCents + clientCents : null;
  const sumMatches = sumCents != null && sumCents === totalCents;
  const sumValid = bothParsed && sumMatches && lawyerCents! >= 0n && clientCents! >= 0n;

  const sumDisplay = sumCents != null ? formatEUR(Number(sumCents) / 100) : "—";

  function setQuickSplit(lawyerEUR: number, clientEUR: number) {
    setToLawyer(lawyerEUR.toFixed(2));
    setToClient(clientEUR.toFixed(2));
  }

  async function performResolve() {
    if (!sumValid || lawyerCents == null || clientCents == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/operator/disputes/${engagementId}/${proposalIndex}/resolve`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            toLawyerWei: lawyerCents.toString(10),
            toClientWei: clientCents.toString(10),
          }),
        },
      );
      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { error?: { message?: string; code?: string } };
          if (data?.error?.message) message = data.error.message;
          else if (data?.error?.code) message = data.error.code;
        } catch {
          /* fall through */
        }
        throw new Error(message);
      }
      // Encode the resolved amounts onto the redirect so the list page
      // can render an inline confirmation banner. We don't have a toast
      // library wired up; this is the cheapest "tell the operator it
      // worked" surface.
      const params = new URLSearchParams({
        resolved: "1",
        toLawyer: (Number(lawyerCents) / 100).toString(),
        toClient: (Number(clientCents) / 100).toString(),
        engagementId: String(engagementId),
        proposalIndex: String(proposalIndex),
      });
      router.push(`/operator/disputes?${params.toString()}`);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setSubmitting(false);
      setConfirmOpen(false);
    }
  }

  return (
    <section
      className="rounded-xl border border-slate-100 bg-white-0 p-6"
      data-testid="resolve-form"
    >
      <h2 className="font-display text-xl text-navy-900">Resolve dispute</h2>
      <p className="mt-1 text-[13px] text-slate-500">
        Decide how the parked {formatEUR(amountEUR)} should split between the lawyer
        and the client. The two amounts must sum exactly to {formatEUR(amountEUR)}.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (sumValid) setConfirmOpen(true);
        }}
        className="mt-6 space-y-5"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="to-lawyer">Amount to lawyer (EUR)</Label>
            <Input
              id="to-lawyer"
              data-testid="to-lawyer-input"
              inputMode="decimal"
              placeholder="0.00"
              value={toLawyer}
              onChange={(e) => setToLawyer(e.target.value)}
              disabled={submitting}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="to-client">Amount to client (EUR)</Label>
            <Input
              id="to-client"
              data-testid="to-client-input"
              inputMode="decimal"
              placeholder="0.00"
              value={toClient}
              onChange={(e) => setToClient(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-slate-500">Quick splits:</span>
          <button
            type="button"
            onClick={() => setQuickSplit(amountEUR, 0)}
            className="rounded-md border border-slate-100 bg-white-0 px-2.5 py-1 text-slate-700 hover:bg-slate-50"
            data-testid="quick-all-lawyer"
          >
            All to lawyer
          </button>
          <button
            type="button"
            onClick={() => setQuickSplit(0, amountEUR)}
            className="rounded-md border border-slate-100 bg-white-0 px-2.5 py-1 text-slate-700 hover:bg-slate-50"
            data-testid="quick-all-client"
          >
            All to client
          </button>
          <button
            type="button"
            onClick={() => setQuickSplit(amountEUR / 2, amountEUR / 2)}
            className="rounded-md border border-slate-100 bg-white-0 px-2.5 py-1 text-slate-700 hover:bg-slate-50"
            data-testid="quick-equal-split"
          >
            Equal split
          </button>
        </div>

        <div
          className="flex items-center justify-between rounded-lg border border-slate-100 bg-white-50 px-4 py-3"
          data-testid="sum-display"
        >
          <div className="text-[13px] text-slate-500">Total</div>
          <div className="text-right">
            <div className="font-mono text-[15px] font-medium text-navy-900">{sumDisplay}</div>
            <div
              className={`text-[11px] ${sumValid ? "text-[#1A8A5C]" : bothParsed ? "text-[#B62525]" : "text-slate-500"}`}
              data-testid="sum-status"
            >
              {bothParsed
                ? sumValid
                  ? `Matches parked amount (${formatEUR(amountEUR)})`
                  : `Must equal ${formatEUR(amountEUR)} exactly`
                : `Awaiting amounts (target: ${formatEUR(amountEUR)})`}
            </div>
          </div>
        </div>

        {error && (
          <div className="rounded-md border border-red-100 bg-red-50 px-3 py-2 text-[12px] text-[#B62525]">
            {error}
          </div>
        )}

        <div className="flex justify-end">
          <Button
            type="submit"
            variant="primary"
            size="md"
            disabled={!sumValid || submitting}
            data-testid="resolve-submit"
          >
            {submitting ? "Resolving…" : "Resolve dispute"}
          </Button>
        </div>
      </form>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent data-testid="resolve-confirm">
          <DialogTitle>Resolve dispute?</DialogTitle>
          <DialogDescription>
            This is final. The proposal will be marked Resolved and the funds
            split as specified. The chain transaction cannot be undone.
          </DialogDescription>
          {sumValid && lawyerCents != null && clientCents != null && (
            <div className="mt-4 space-y-2 rounded-lg border border-slate-100 bg-white-50 p-4 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">To lawyer</span>
                <span className="font-mono text-navy-900">
                  {formatEUR(Number(lawyerCents) / 100)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-slate-500">To client</span>
                <span className="font-mono text-navy-900">
                  {formatEUR(Number(clientCents) / 100)}
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-slate-100 pt-2 font-medium">
                <span className="text-navy-900">Total</span>
                <span className="font-mono text-navy-900">{formatEUR(amountEUR)}</span>
              </div>
            </div>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="md"
              onClick={() => setConfirmOpen(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              size="md"
              onClick={() => void performResolve()}
              disabled={submitting || !sumValid}
              data-testid="resolve-confirm-go"
            >
              {submitting ? "Resolving…" : "Confirm resolve"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
