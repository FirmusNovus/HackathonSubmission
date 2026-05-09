"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useAccount, useSignMessage, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { formatEther, parseEther, type Hex } from "viem";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { EngagementChat } from "@/components/EngagementChat";
import { EngagementMilestones } from "@/components/EngagementMilestones";
import { PageHeader, PageShell } from "@/components/layout/page-shell";

// Inlined copy of @lex-nova/crypto's proposalMessage. Avoids pulling the
// crypto package's WebCrypto imports into a server-rendered tree edge-case.
function proposalMessage(args: {
  matterId: number;
  amountWei: string;
  note: string;
  prevProposalId: number | null;
}): string {
  return [
    "lex-nova/v1/proposal",
    `matter:${args.matterId}`,
    `amount_wei:${args.amountWei}`,
    `note:${args.note}`,
    `prev:${args.prevProposalId ?? "none"}`,
  ].join("\n");
}

interface RequestDetail {
  request: {
    id: number;
    matter_id: number;
    client_address: string;
    lawyer_address: string;
    status: "pending" | "declined" | "accepted" | "withdrawn";
    created_at: number;
  };
  matter: {
    id: number;
    description: string;
    target_jurisdiction: string;
    target_practice_area: string;
    status: string;
  };
  proposals: Array<{
    id: number;
    proposer_address: string;
    amount_wei: string;
    note: string | null;
    signature: string;
    prev_proposal_id: number | null;
    superseded_by: number | null;
    created_at: number;
  }>;
  head_proposal_id: number | null;
  counterparty: {
    address: string;
    attested_role: string | null;
    disclosed_attrs: Record<string, string | boolean>;
  };
  engagement: {
    engagement_id: number;
    current_transcript_root: string;
    last_anchor_block: number;
    state: "active" | "closed";
  } | null;
  milestones: Array<{
    milestone_index: number;
    amount_wei: string;
    state: string;
    delivered_at: number | null;
  }>;
}

interface FundCalldata {
  contract_address: `0x${string}`;
  function_name: string;
  abi: readonly unknown[];
  args: readonly unknown[];
  value_wei: string;
  head_proposal: { id: number; amount_wei: string };
}

export default function ClientEngagementPage() {
  const params = useParams<{ requestId: string }>();
  const requestId = Number(params.requestId);
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync, data: txHash, isPending: txPending } = useWriteContract();
  const { isLoading: txConfirming, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const [detail, setDetail] = useState<RequestDetail | null>(null);
  const [authStatus, setAuthStatus] = useState<"checking" | "ok" | "no-session" | "not-party">(
    "checking"
  );
  const [error, setError] = useState<string | null>(null);
  const [counterOpen, setCounterOpen] = useState(false);
  const [submitting, setSubmitting] = useState<"counter" | "decline" | "fund" | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/engagements/${requestId}`, { cache: "no-store" });
      if (res.status === 401) return setAuthStatus("no-session");
      if (res.status === 403) return setAuthStatus("not-party");
      const data = (await res.json()) as RequestDetail | { error?: string };
      if (!res.ok) throw new Error("error" in data ? data.error : `HTTP ${res.status}`);
      setDetail(data as RequestDetail);
      setAuthStatus("ok");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [requestId]);

  useEffect(() => {
    if (!Number.isFinite(requestId) || requestId <= 0) return;
    // Clear the previous wallet's data synchronously the moment the
    // identity changes, otherwise React keeps rendering the old engagement
    // detail (and the chat panel inside it) while the async auth-check
    // below decides what to do — which briefly leaks decrypted messages
    // to a wallet that may not be a party.
    setDetail(null);
    setAuthStatus("checking");
    if (!isConnected) {
      setAuthStatus("no-session");
      return;
    }
    let cancelled = false;
    (async () => {
      const sess = await fetch("/api/auth/siwe/session").then((r) => r.json());
      if (cancelled) return;
      if (!sess.address || !address || sess.address.toLowerCase() !== address.toLowerCase()) {
        setAuthStatus("no-session");
        return;
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [requestId, isConnected, address, refresh]);

  useEffect(() => {
    if (txConfirmed) toast.success("Engagement opened on chain");
  }, [txConfirmed]);

  // Subscribe to the request's SSE event stream as soon as we're a party.
  // The stream is open from the moment the engagement_request exists, well
  // before any on-chain engagement opens — so the indexer's "engagement
  // opened" event arrives instantly and flips the page out of the funding
  // card without any polling. Pre-open: we get the engagement-opened
  // event. Post-open: milestone + close events. Chat messages are handled
  // by the EngagementChat panel's own subscription.
  useEffect(() => {
    if (authStatus !== "ok") return;
    const es = new EventSource(`/api/engagements/${requestId}/events/stream`);
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { kind?: string };
        if (
          ev.kind === "proposal" ||
          ev.kind === "milestone" ||
          ev.kind === "engagement"
        ) {
          void refresh();
        }
      } catch {
        // ignore malformed event line
      }
    };
    return () => es.close();
  }, [authStatus, requestId, refresh]);

  const head = useMemo(() => {
    if (!detail) return null;
    return detail.proposals.find((p) => p.id === detail.head_proposal_id) ?? null;
  }, [detail]);

  const headFromLawyer = useMemo(() => {
    if (!detail || !head) return false;
    return head.proposer_address.toLowerCase() === detail.request.lawyer_address.toLowerCase();
  }, [detail, head]);

  // Viewer role. The page lives under (client)/engagements/ but the API
  // serves either party, so we get lawyer hits here too — render a
  // role-aware action set instead of always showing the client-side buttons.
  const viewerIsClient = useMemo(
    () =>
      !!detail &&
      !!address &&
      detail.request.client_address.toLowerCase() === address.toLowerCase(),
    [detail, address]
  );
  const viewerIsLawyer = useMemo(
    () =>
      !!detail &&
      !!address &&
      detail.request.lawyer_address.toLowerCase() === address.toLowerCase(),
    [detail, address]
  );

  // Counter is sensible only when the *other* party last spoke.
  const canCounter =
    (viewerIsClient && headFromLawyer) || (viewerIsLawyer && !headFromLawyer);

  async function counter(amountEth: string, note: string) {
    if (!detail || !head) return;
    setSubmitting("counter");
    try {
      let amountWei: bigint;
      try {
        amountWei = parseEther(amountEth);
      } catch {
        throw new Error("amount must be a decimal ETH value (e.g. 0.3)");
      }
      if (amountWei <= 0n) throw new Error("amount must be positive");
      const message = proposalMessage({
        matterId: detail.matter.id,
        amountWei: amountWei.toString(),
        note,
        prevProposalId: head.id,
      });
      const signature = await signMessageAsync({ message });
      const res = await fetch(`/api/engagements/${requestId}/counter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_wei: amountWei.toString(),
          note: note || undefined,
          signature,
          prev_proposal_id: head.id,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Counter sent");
      setCounterOpen(false);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  async function withdraw() {
    setSubmitting("decline");
    try {
      const res = await fetch(`/api/engagements/${requestId}/decline`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Request withdrawn");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  async function acceptAndFund() {
    if (!detail || !head) return;
    setSubmitting("fund");
    try {
      const res = await fetch(`/api/engagements/${requestId}/fund-calldata`, { method: "POST" });
      const data = (await res.json()) as FundCalldata | { error?: string };
      if (!res.ok || !("args" in data)) throw new Error("error" in data ? data.error : "no calldata");
      // wagmi's useWriteContract takes the abi + functionName + args + value.
      // The server returned everything; we just forward.
      await writeContractAsync({
        address: data.contract_address,
        abi: data.abi as never,
        functionName: data.function_name as never,
        args: data.args as never,
        value: BigInt(data.value_wei),
      });
      toast.info("Tx submitted, waiting for confirmation…");
    } catch (e) {
      toast.error((e as Error).message);
      setSubmitting(null);
    }
  }

  if (!Number.isFinite(requestId) || requestId <= 0) {
    return <p className="py-8 text-sm text-destructive">Invalid request id.</p>;
  }

  return (
    <PageShell width="wide" className="space-y-6">
      <PageHeader
        eyebrow={`Engagement request #${requestId}`}
        title="Negotiate, fund, anchor."
        description="The lawyer's signed first-milestone proposal is below. Accept to fund and open the engagement on chain — that single transaction also commits the negotiation transcript."
      />

      {authStatus === "no-session" && (
        <Alert>
          <AlertTitle>Sign in first</AlertTitle>
          <AlertDescription>
            Connect your wallet and complete client onboarding to view this request.
          </AlertDescription>
        </Alert>
      )}
      {authStatus === "not-party" && (
        <Alert variant="destructive">
          <AlertTitle>Not a party</AlertTitle>
          <AlertDescription>This request is between two other wallets.</AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load request</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {detail && (
        <>
          <Card className="border-slate-100 bg-white shadow-none">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <CardTitle className="font-display text-[18px] text-navy-900">
                    {detail.matter.target_practice_area} · {detail.matter.target_jurisdiction}
                  </CardTitle>
                  <CardDescription className="font-mono text-[12px] text-slate-300">
                    matter #{detail.matter.id} · {new Date(detail.request.created_at * 1000).toLocaleString()}
                  </CardDescription>
                </div>
                <Badge
                  variant={
                    detail.request.status === "pending"
                      ? "default"
                      : detail.request.status === "accepted"
                        ? "secondary"
                        : "outline"
                  }
                >
                  {detail.request.status}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="whitespace-pre-wrap text-sm">{detail.matter.description}</p>
              <div className="rounded-md border bg-muted/40 p-3 text-xs">
                <div className="font-medium">
                  {viewerIsLawyer ? "Client" : "Lawyer"}
                </div>
                <div className="font-mono text-muted-foreground">
                  {detail.counterparty.address}
                </div>
                <div className="mt-1 flex flex-wrap gap-2">
                  {viewerIsLawyer ? (
                    <>
                      {detail.counterparty.disclosed_attrs.country_of_residence && (
                        <Badge variant="outline">
                          residence:{" "}
                          {String(detail.counterparty.disclosed_attrs.country_of_residence)}
                        </Badge>
                      )}
                      {detail.counterparty.disclosed_attrs.age_equal_or_over_18 !== undefined && (
                        <Badge variant="outline">
                          18+:{" "}
                          {detail.counterparty.disclosed_attrs.age_equal_or_over_18 ? "yes" : "no"}
                        </Badge>
                      )}
                    </>
                  ) : (
                    <>
                      {detail.counterparty.disclosed_attrs.given_name && (
                        <Badge variant="outline">
                          {String(detail.counterparty.disclosed_attrs.given_name)}{" "}
                          {String(detail.counterparty.disclosed_attrs.family_name ?? "")}
                        </Badge>
                      )}
                      {detail.counterparty.disclosed_attrs.jurisdiction && (
                        <Badge variant="outline">
                          bar: {String(detail.counterparty.disclosed_attrs.jurisdiction)}
                        </Badge>
                      )}
                      {detail.counterparty.disclosed_attrs.bar_admission_number && (
                        <Badge variant="outline">
                          {String(detail.counterparty.disclosed_attrs.bar_admission_number)}
                        </Badge>
                      )}
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Negotiation</CardTitle>
              <CardDescription>
                Each row is a signed proposal or counter. The current head is highlighted.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {detail.proposals.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Waiting for the lawyer's first-milestone proposal.
                </p>
              ) : (
                detail.proposals.map((p, i) => {
                  const isHead = p.id === detail.head_proposal_id;
                  const fromLawyer =
                    p.proposer_address.toLowerCase() ===
                    detail.request.lawyer_address.toLowerCase();
                  const fromMe =
                    !!address &&
                    p.proposer_address.toLowerCase() === address.toLowerCase();
                  return (
                    <div
                      key={p.id}
                      className={`rounded-md border p-3 text-xs ${
                        isHead ? "border-primary bg-primary/5" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          #{i + 1} · {fromMe ? "You" : fromLawyer ? "Lawyer" : "Client"}
                        </span>
                        <span className="font-mono text-muted-foreground">
                          {formatEther(BigInt(p.amount_wei))} ETH
                        </span>
                      </div>
                      {p.note && (
                        <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{p.note}</p>
                      )}
                      <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                        sig {p.signature.slice(0, 18)}…
                      </div>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>

          {detail.request.status === "pending" && head && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Your move</CardTitle>
                <CardDescription>
                  {viewerIsClient && headFromLawyer
                    ? "The lawyer's proposal is the current head. Accept to fund, counter to negotiate, or withdraw."
                    : viewerIsClient && !headFromLawyer
                      ? "Your counter is the current head. Wait for the lawyer to reply, or withdraw."
                      : viewerIsLawyer && !headFromLawyer
                        ? "The client's counter is the current head. Counter back, or decline."
                        : "Your proposal is the current head. Wait for the client to accept, counter, or withdraw."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {viewerIsClient && headFromLawyer && (
                    <Button
                      onClick={acceptAndFund}
                      disabled={submitting !== null || txPending || txConfirming}
                    >
                      {txPending
                        ? "Awaiting wallet…"
                        : txConfirming
                          ? "Confirming…"
                          : `Accept & fund ${formatEther(BigInt(head.amount_wei))} ETH`}
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={() => setCounterOpen(!counterOpen)}
                    disabled={submitting !== null || !canCounter}
                  >
                    {counterOpen ? "Cancel counter" : "Counter"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={withdraw}
                    disabled={submitting !== null}
                  >
                    {submitting === "decline"
                      ? "…"
                      : viewerIsLawyer
                        ? "Decline"
                        : "Withdraw"}
                  </Button>
                </div>

                {counterOpen && canCounter && (
                  <CounterForm
                    onSubmit={counter}
                    disabled={submitting === "counter"}
                  />
                )}

                {txHash && (
                  <div className="text-xs text-muted-foreground">
                    <Separator className="my-3" />
                    <div className="font-medium">Transaction</div>
                    <div className="break-all font-mono">{txHash}</div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {detail.request.status === "accepted" && (
            <>
              <Alert>
                <AlertTitle className="text-green-700">Engagement opened on chain</AlertTitle>
                <AlertDescription>
                  The first milestone is funded. Manage milestones below; the encrypted message
                  thread is live further down.
                </AlertDescription>
              </Alert>
              <EngagementMilestones
                requestId={requestId}
                engagementId={detail.engagement?.engagement_id ?? 0}
                milestones={detail.milestones}
                engagementState={detail.engagement?.state ?? "active"}
                viewerIsClient={viewerIsClient}
                viewerIsLawyer={viewerIsLawyer}
                onChanged={refresh}
              />
              <EngagementChat requestId={requestId} isActive />
            </>
          )}

          {(detail.request.status === "declined" || detail.request.status === "withdrawn") && (
            <Alert>
              <AlertTitle>Closed</AlertTitle>
              <AlertDescription>
                This request is {detail.request.status}. The matter remains open — you can pitch
                a different lawyer from the directory.
              </AlertDescription>
            </Alert>
          )}
        </>
      )}
    </PageShell>
  );
}

function CounterForm({
  onSubmit,
  disabled,
}: {
  onSubmit: (amount: string, note: string) => void | Promise<void>;
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
      }}
      className="space-y-3 rounded-md border bg-background p-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="counter-amount" className="text-xs">
          Counter amount (ETH)
        </Label>
        <Input
          id="counter-amount"
          inputMode="decimal"
          placeholder="0.3"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="counter-note" className="text-xs">
          Optional note
        </Label>
        <Textarea
          id="counter-note"
          rows={3}
          placeholder="Why this amount."
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" size="sm" disabled={disabled || !amount.trim()}>
          {disabled ? "Signing…" : "Sign + send"}
        </Button>
      </div>
    </form>
  );
}
