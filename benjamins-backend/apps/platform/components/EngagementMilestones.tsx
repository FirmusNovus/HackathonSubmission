"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useSignMessage,
  useSignTypedData,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { formatEther, parseEther, type Hex } from "viem";
import { toast } from "sonner";

import {
  MUTUAL_REFUND_TYPES,
  milestoneOfferMessage,
  mutualRefundDomain,
  type JwkP256Public,
} from "@lex-nova/crypto";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { uploadDisputeBundle } from "@/lib/messaging/dispute-bundle";

interface MilestoneRow {
  milestone_index: number;
  amount_wei: string;
  state: string;
  delivered_at: number | null;
}

const LAWYER_DISPUTE_COOLDOWN_SECONDS = 30 * 24 * 60 * 60;

interface OfferRow {
  id: number;
  proposer_address: string;
  amount_wei: string;
  note: string | null;
  nonce: string;
  superseded_by: number | null;
  accepted_milestone_index: number | null;
  created_at: number;
}

interface CalldataPayload {
  contract_address: `0x${string}`;
  function_name: string;
  abi: readonly unknown[];
  args: readonly unknown[];
  value_wei?: string;
}

interface RefundStatus {
  has_client_sig: boolean;
  has_lawyer_sig: boolean;
  ready: boolean;
}

interface Props {
  requestId: number;
  engagementId: number;
  milestones: MilestoneRow[];
  engagementState: "active" | "closed";
  viewerIsClient: boolean;
  viewerIsLawyer: boolean;
  onChanged: () => void | Promise<void>;
}

interface ChainConfig {
  chain_id: number;
  escrow_address: `0x${string}`;
  operator_messaging_public_key: JwkP256Public | null;
}

const TERMINAL_STATES = new Set(["released", "refunded", "resolved"]);

export function EngagementMilestones({
  requestId,
  engagementId,
  milestones,
  engagementState,
  viewerIsClient,
  viewerIsLawyer,
  onChanged,
}: Props) {
  const { address: viewerAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync, data: txHash, isPending: txPending } = useWriteContract();
  const { isLoading: txConfirming } = useWaitForTransactionReceipt({ hash: txHash });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [activeOffer, setActiveOffer] = useState<OfferRow | null>(null);
  const [refundStatus, setRefundStatus] = useState<Record<number, RefundStatus>>({});
  const [chainConfig, setChainConfig] = useState<ChainConfig | null>(null);

  // Pull the public chain config once so EIP-712 typed-data sigs target the
  // right verifying-contract + chain id. Cached HTTP-side; one fetch per
  // page lifetime.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/chain/config", { cache: "force-cache" });
        if (!res.ok) return;
        const data = (await res.json()) as ChainConfig;
        if (!cancelled) setChainConfig(data);
      } catch {
        // Without the config the refund-auth signing button is disabled —
        // that's the only flow that needs it.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshActiveOffer = useCallback(async () => {
    try {
      const res = await fetch(`/api/engagements/${requestId}/milestones/offers`, {
        cache: "no-store",
      });
      if (!res.ok) return;
      const data = (await res.json()) as { offers: OfferRow[] };
      const head = data.offers.find(
        (o) => o.superseded_by === null && o.accepted_milestone_index === null
      );
      setActiveOffer(head ?? null);
    } catch {
      // keep prior state on transient failure
    }
  }, [requestId]);

  // Pull refund-auth status for any milestone that's in `funded` state so the
  // mutual-refund UI can show "waiting on counterparty" or "submit refund".
  const fundedIndices = useMemo(
    () => milestones.filter((m) => m.state === "funded").map((m) => m.milestone_index),
    [milestones]
  );
  const refreshRefundStatus = useCallback(async () => {
    const next: Record<number, RefundStatus> = {};
    await Promise.all(
      fundedIndices.map(async (idx) => {
        try {
          const res = await fetch(
            `/api/engagements/${requestId}/milestones/${idx}/refund-authorization`,
            { cache: "no-store" }
          );
          if (!res.ok) return;
          next[idx] = (await res.json()) as RefundStatus;
        } catch {
          // ignore — UI just stays without status hint
        }
      })
    );
    setRefundStatus(next);
  }, [requestId, fundedIndices]);

  useEffect(() => {
    void refreshActiveOffer();
    void refreshRefundStatus();
  }, [refreshActiveOffer, refreshRefundStatus]);

  // Submit a calldata payload via the connected wallet. The platform never
  // sees a private key; the server pre-computed the args, the wallet signs.
  async function submitCalldata(key: string, fetchOpts: { url: string; body?: unknown }) {
    setBusyKey(key);
    try {
      const res = await fetch(fetchOpts.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: fetchOpts.body ? JSON.stringify(fetchOpts.body) : undefined,
      });
      const data = (await res.json()) as CalldataPayload | { error?: string; missing?: unknown };
      if (!res.ok) {
        const err = "error" in data ? data.error ?? "request failed" : `HTTP ${res.status}`;
        throw new Error(
          "missing" in data && data.missing
            ? `${err}: missing ${JSON.stringify(data.missing)}`
            : err
        );
      }
      const c = data as CalldataPayload;
      await writeContractAsync({
        address: c.contract_address,
        abi: c.abi as never,
        functionName: c.function_name as never,
        args: c.args as never,
        ...(c.value_wei ? { value: BigInt(c.value_wei) } : {}),
      });
      toast.success(`${c.function_name} submitted`);
      // Indexer will fire a milestone event; the parent's SSE subscription
      // triggers a refresh.
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  // Sign + POST an off-chain follow-up milestone offer. No on-chain action;
  // the counterparty (or the proposer themselves, after a counter) funds it
  // later via the on-chain `fundMilestone` tx.
  async function submitOffer(amountEth: string, note: string) {
    setBusyKey("propose");
    try {
      let amountWei: bigint;
      try {
        amountWei = parseEther(amountEth);
      } catch {
        throw new Error("amount must be a decimal ETH value (e.g. 0.5)");
      }
      if (amountWei <= 0n) throw new Error("amount must be positive");
      const nonce = `0x${crypto.randomUUID().replace(/-/g, "")}`;
      const message = milestoneOfferMessage({
        engagementId,
        amountWei: amountWei.toString(),
        note,
        nonce,
      });
      const signature = await signMessageAsync({ message });
      const res = await fetch(`/api/engagements/${requestId}/milestones/offers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_wei: amountWei.toString(),
          note: note || undefined,
          nonce,
          signature,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Offer signed and posted");
      await refreshActiveOffer();
      await onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  // EIP-712 sign of MutualRefundAuthorization{engagementId, milestoneIndex}.
  // POSTs the sig to `/refund-authorization`; once both parties have signed,
  // either may call `/refund-calldata` to broadcast the on-chain tx.
  async function signRefundAuth(milestoneIndex: number) {
    if (!chainConfig) {
      toast.error("chain config not loaded yet — try again in a moment");
      return;
    }
    const key = `m${milestoneIndex}-refund-auth`;
    setBusyKey(key);
    try {
      const signature = await signTypedDataAsync({
        domain: mutualRefundDomain({
          chainId: chainConfig.chain_id,
          verifyingContract: chainConfig.escrow_address,
        }),
        types: MUTUAL_REFUND_TYPES as unknown as Record<string, { name: string; type: string }[]>,
        primaryType: "MutualRefundAuthorization",
        message: {
          engagementId: BigInt(engagementId),
          milestoneIndex: BigInt(milestoneIndex),
        },
      });
      const res = await fetch(
        `/api/engagements/${requestId}/milestones/${milestoneIndex}/refund-authorization`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature }),
        }
      );
      const data = (await res.json()) as { ok?: boolean; ready?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success(
        data.ready
          ? "Both parties have signed — submit the refund to release funds"
          : "Signature recorded; waiting for the other party"
      );
      await refreshRefundStatus();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  // Filing a dispute (or escalating) is the moment of disclosure: the
  // disputing party's browser bundles the engagement chat + signed
  // off-chain artifacts, encrypts to the operator's pubkey, and posts.
  // After the upload succeeds, the on-chain dispute/escalate tx fires.
  // Per the 2026-05-08 spec clarification, this is "all-or-nothing" —
  // the disputer cannot partially share.
  async function disputeWithBundle(
    milestoneIndex: number,
    kind: "dispute" | "escalate"
  ): Promise<void> {
    const key = `m${milestoneIndex}-${kind}`;
    if (!viewerAddress) {
      toast.error("connect your wallet first");
      return;
    }
    if (!chainConfig?.operator_messaging_public_key) {
      toast.error(
        "operator hasn't published a messaging key yet — disputes can't be filed until they do"
      );
      return;
    }
    const ok = window.confirm(
      `Filing a ${kind === "dispute" ? "dispute" : "escalation"} will share the entire engagement chat (every message, in plaintext) with the platform operator/arbiter. This cannot be undone. Continue?`
    );
    if (!ok) return;

    setBusyKey(key);
    try {
      // 1. Bundle, encrypt, upload (off-chain disclosure).
      await uploadDisputeBundle(
        {
          signMessage: signMessageAsync,
          myAddress: viewerAddress,
        },
        {
          requestId,
          engagementId,
          milestoneIndex,
          operatorPublicKey: chainConfig.operator_messaging_public_key,
        }
      );
      toast.success("Chat bundle uploaded — submitting on-chain dispute…");

      // 2. Fetch calldata and submit the on-chain tx.
      const url = `/api/engagements/${requestId}/milestones/${milestoneIndex}/${kind}-calldata`;
      const res = await fetch(url, { method: "POST" });
      const data = (await res.json()) as CalldataPayload | { error?: string };
      if (!res.ok) {
        const err = "error" in data ? data.error ?? "request failed" : `HTTP ${res.status}`;
        throw new Error(err);
      }
      const c = data as CalldataPayload;
      await writeContractAsync({
        address: c.contract_address,
        abi: c.abi as never,
        functionName: c.function_name as never,
        args: c.args as never,
      });
      toast.success(`${c.function_name} submitted`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  const allTerminal =
    milestones.length > 0 && milestones.every((m) => TERMINAL_STATES.has(m.state));
  const isParty = viewerIsClient || viewerIsLawyer;

  // Whether the viewer is the proposer of the head offer (avoid showing a
  // self-fund button when their own offer is the head).
  const viewerIsOfferProposer =
    activeOffer && viewerAddress
      ? activeOffer.proposer_address.toLowerCase() === viewerAddress.toLowerCase()
      : false;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Milestones</CardTitle>
        <CardDescription>
          Each milestone holds escrowed ETH. Client releases when satisfied (no separate
          delivered step). Both parties sign to refund undelivered work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* V2 active offer — surfaces the head signed MilestoneOffer. The
            client funds it via the on-chain `fundMilestone` tx. */}
        {activeOffer && engagementState === "active" && (
          <ActiveOfferCard
            offer={activeOffer}
            viewerIsClient={viewerIsClient}
            viewerIsProposer={viewerIsOfferProposer}
            busy={busyKey !== null || txPending || txConfirming}
            onFund={() =>
              submitCalldata(`offer-${activeOffer.id}-fund`, {
                url: `/api/engagements/${requestId}/milestones/0/fund-calldata`,
                body: { offer_id: activeOffer.id },
              })
            }
          />
        )}

        {milestones.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No milestones yet — engagement opens with milestone 0 funded.
          </p>
        ) : (
          milestones.map((m) => (
            <MilestoneRowView
              key={m.milestone_index}
              milestone={m}
              engagementState={engagementState}
              viewerIsClient={viewerIsClient}
              viewerIsLawyer={viewerIsLawyer}
              busy={busyKey !== null || txPending || txConfirming}
              refund={refundStatus[m.milestone_index]}
              viewerAddressLower={viewerAddress?.toLowerCase()}
              onRelease={() =>
                submitCalldata(`m${m.milestone_index}-release`, {
                  url: `/api/engagements/${requestId}/milestones/${m.milestone_index}/release-calldata`,
                })
              }
              onSignRefundAuth={() => signRefundAuth(m.milestone_index)}
              onSubmitRefund={() =>
                submitCalldata(`m${m.milestone_index}-refund`, {
                  url: `/api/engagements/${requestId}/milestones/${m.milestone_index}/refund-calldata`,
                })
              }
              onStartEscalationClock={() =>
                submitCalldata(`m${m.milestone_index}-deliver`, {
                  url: `/api/engagements/${requestId}/milestones/${m.milestone_index}/deliver-calldata`,
                })
              }
              onDispute={() => disputeWithBundle(m.milestone_index, "dispute")}
              onEscalate={() => disputeWithBundle(m.milestone_index, "escalate")}
            />
          ))
        )}

        {isParty && engagementState === "active" && (
          <ProposeOfferForm
            disabled={busyKey !== null || txPending || txConfirming}
            onSubmit={(amount, note) => submitOffer(amount, note)}
          />
        )}

        {isParty && engagementState === "active" && (
          <div className="border-t pt-3">
            <Button
              variant="outline"
              size="sm"
              disabled={busyKey !== null || txPending || txConfirming || !allTerminal}
              onClick={() =>
                submitCalldata("close", { url: `/api/engagements/${requestId}/close-calldata` })
              }
            >
              {allTerminal
                ? "Close engagement"
                : "Close engagement (blocked: non-terminal milestones)"}
            </Button>
          </div>
        )}

        {engagementState === "closed" && (
          <Alert>
            <AlertTitle>Engagement closed</AlertTitle>
            <AlertDescription>
              All milestones resolved. The on-chain engagement record is final; the message
              transcript stays readable from this page for audit.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function ActiveOfferCard({
  offer,
  viewerIsClient,
  viewerIsProposer,
  busy,
  onFund,
}: {
  offer: OfferRow;
  viewerIsClient: boolean;
  viewerIsProposer: boolean;
  busy: boolean;
  onFund: () => void | Promise<void>;
}) {
  return (
    <div className="rounded-md border bg-muted/40 p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">
            Active offer · {viewerIsProposer ? "from you" : `from ${shorten(offer.proposer_address)}`}
          </div>
          <div className="font-medium">
            <span className="font-mono">{formatEther(BigInt(offer.amount_wei))} ETH</span>
          </div>
          {offer.note && (
            <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">{offer.note}</p>
          )}
        </div>
        <Badge variant="outline">offer</Badge>
      </div>
      {viewerIsClient && !viewerIsProposer && (
        <div className="mt-3">
          <Button size="sm" disabled={busy} onClick={onFund}>
            Fund {formatEther(BigInt(offer.amount_wei))} ETH
          </Button>
        </div>
      )}
      {viewerIsProposer && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Awaiting the other party — they can fund this offer or counter with their own.
        </p>
      )}
    </div>
  );
}

function MilestoneRowView({
  milestone,
  engagementState,
  viewerIsClient,
  viewerIsLawyer,
  busy,
  refund,
  viewerAddressLower,
  onRelease,
  onSignRefundAuth,
  onSubmitRefund,
  onStartEscalationClock,
  onDispute,
  onEscalate,
}: {
  milestone: MilestoneRow;
  engagementState: "active" | "closed";
  viewerIsClient: boolean;
  viewerIsLawyer: boolean;
  busy: boolean;
  refund?: RefundStatus;
  viewerAddressLower?: string;
  onRelease: () => void | Promise<void>;
  onSignRefundAuth: () => void | Promise<void>;
  onSubmitRefund: () => void | Promise<void>;
  onStartEscalationClock: () => void | Promise<void>;
  onDispute: () => void | Promise<void>;
  onEscalate: () => void | Promise<void>;
}) {
  const m = milestone;
  // Live ticking `now` so the lawyer's escalate countdown stays accurate
  // without a parent re-render. Only mounted when needed (delivered state).
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (m.state !== "delivered") return;
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [m.state]);

  // V2 release accepts funded OR delivered.
  const showRelease =
    viewerIsClient &&
    (m.state === "funded" || m.state === "delivered") &&
    engagementState === "active";

  // Mutual refund is only possible in `funded` state (delivered milestones go
  // through release or dispute).
  const refundEligible =
    (viewerIsClient || viewerIsLawyer) && m.state === "funded" && engagementState === "active";

  const viewerAlreadySigned =
    refund && viewerAddressLower
      ? (viewerIsClient && refund.has_client_sig) || (viewerIsLawyer && refund.has_lawyer_sig)
      : false;

  // Lawyer-only: start the 30-day escalation cooldown clock. Hidden by
  // default — only revealed via a tiny disclosure since the happy path
  // never needs it.
  const showEscalationClock =
    viewerIsLawyer && m.state === "funded" && engagementState === "active";

  // Client can dispute Funded or Delivered milestones immediately
  // (Constitution III asymmetric path).
  const showDispute =
    viewerIsClient &&
    (m.state === "funded" || m.state === "delivered") &&
    engagementState === "active";

  // Lawyer can escalate Delivered milestones, gated on the cooldown.
  const showEscalate =
    viewerIsLawyer && m.state === "delivered" && engagementState === "active";
  const unlockAt =
    m.delivered_at !== null ? m.delivered_at + LAWYER_DISPUTE_COOLDOWN_SECONDS : null;
  const cooldownActive = unlockAt !== null && now < unlockAt;
  const secondsRemaining = unlockAt !== null ? Math.max(0, unlockAt - now) : 0;

  return (
    <div className="rounded-md border p-3 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-medium">
            Milestone #{m.milestone_index} ·{" "}
            <span className="font-mono">{formatEther(BigInt(m.amount_wei))} ETH</span>
          </div>
          {m.delivered_at && (
            <div className="text-[10px] text-muted-foreground">
              cooldown clock started at {new Date(m.delivered_at * 1000).toLocaleString()}
            </div>
          )}
        </div>
        <Badge variant={stateBadgeVariant(m.state)}>{m.state}</Badge>
      </div>

      {m.state === "disputed" && (
        <div className="mt-2 rounded-md bg-destructive/5 p-2 text-[11px]">
          Disputed — awaiting operator resolution. Funds stay parked until the operator
          posts an on-chain split.
        </div>
      )}

      {(showRelease || refundEligible || showDispute || showEscalate) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {showRelease && (
            <Button size="sm" disabled={busy} onClick={onRelease}>
              Release {formatEther(BigInt(m.amount_wei))} ETH
            </Button>
          )}
          {refundEligible && !viewerAlreadySigned && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onSignRefundAuth}>
              Sign mutual refund
            </Button>
          )}
          {refundEligible && refund?.ready && (
            <Button size="sm" variant="secondary" disabled={busy} onClick={onSubmitRefund}>
              Submit refund (both signed)
            </Button>
          )}
          {showDispute && (
            <Button size="sm" variant="destructive" disabled={busy} onClick={onDispute}>
              Dispute
            </Button>
          )}
          {showEscalate && (
            <Button
              size="sm"
              variant="destructive"
              disabled={busy || cooldownActive}
              onClick={onEscalate}
              title={
                cooldownActive
                  ? `Cooldown unlocks at ${new Date((unlockAt ?? 0) * 1000).toLocaleString()}`
                  : undefined
              }
            >
              {cooldownActive ? `Escalate (in ${formatCountdown(secondsRemaining)})` : "Escalate"}
            </Button>
          )}
        </div>
      )}

      {refundEligible && refund && !refund.ready && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Mutual refund: client {refund.has_client_sig ? "✓ signed" : "— not yet"} · lawyer{" "}
          {refund.has_lawyer_sig ? "✓ signed" : "— not yet"}
        </p>
      )}

      {showEscalationClock && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-muted-foreground">
            Advanced: start escalation cooldown
          </summary>
          <div className="mt-2 space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              Use only if the client has gone silent. Calls <code>markDelivered</code> on
              chain to start the 30-day cooldown — after which you can escalate to dispute.
              The happy path (client clicks Release) does not need this.
            </p>
            <Button size="sm" variant="ghost" disabled={busy} onClick={onStartEscalationClock}>
              Start 30-day cooldown
            </Button>
          </div>
        </details>
      )}
    </div>
  );
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function ProposeOfferForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (amountEth: string, note: string) => void | Promise<void>;
  disabled: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!amount.trim()) return;
        void onSubmit(amount.trim(), note.trim());
        setAmount("");
        setNote("");
      }}
      className="space-y-2 border-t pt-3"
    >
      <Label className="text-xs">Propose follow-up milestone (signed off chain — no gas)</Label>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="propose-amount" className="text-[11px] text-muted-foreground">
            Amount (ETH)
          </Label>
          <Input
            id="propose-amount"
            inputMode="decimal"
            placeholder="0.5"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={disabled}
            className="w-32"
          />
        </div>
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="propose-note" className="text-[11px] text-muted-foreground">
            Scoping note (optional)
          </Label>
          <Textarea
            id="propose-note"
            rows={1}
            placeholder="What this milestone covers."
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={disabled}
          />
        </div>
        <Button type="submit" size="sm" disabled={disabled || !amount.trim()}>
          Sign + propose
        </Button>
      </div>
    </form>
  );
}

function shorten(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function stateBadgeVariant(
  state: string
): "default" | "secondary" | "outline" | "destructive" {
  switch (state) {
    case "funded":
      return "default";
    case "delivered":
      return "secondary";
    case "released":
    case "refunded":
    case "resolved":
      return "secondary";
    case "disputed":
      return "destructive";
    default:
      return "outline";
  }
}
