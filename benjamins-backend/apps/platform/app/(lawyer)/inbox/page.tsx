"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { parseEther } from "viem";
import { toast } from "sonner";

import { proposalMessage } from "@lex-nova/crypto";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

interface InboxRequest {
  request_id: number;
  status: "pending" | "declined" | "accepted" | "withdrawn";
  created_at: number;
  matter: {
    id: number;
    description: string;
    target_jurisdiction: string;
    target_practice_area: string;
  };
  client: {
    address: string;
    country_of_residence: string | null;
    age_equal_or_over_18: boolean | null;
  };
  head_proposal: {
    id: number;
    proposer_address: string | null;
    amount_wei: string | null;
  } | null;
  proposal_count: number;
}

export default function InboxPage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [requests, setRequests] = useState<InboxRequest[]>([]);
  const [authStatus, setAuthStatus] = useState<"checking" | "ok" | "no-session">("checking");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openRow, setOpenRow] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/engagements/inbox", { cache: "no-store" });
      if (res.status === 401) {
        setAuthStatus("no-session");
        return;
      }
      const data = (await res.json()) as { requests?: InboxRequest[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setRequests(data.requests ?? []);
      setAuthStatus("ok");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (!isConnected || !address) {
      setAuthStatus("no-session");
      return;
    }
    let cancelled = false;
    (async () => {
      const sess = await fetch("/api/auth/siwe/session").then((r) => r.json());
      if (cancelled) return;
      if (!sess.address || sess.address.toLowerCase() !== address.toLowerCase()) {
        setAuthStatus("no-session");
        return;
      }
      await refresh();
    })();
    return () => {
      cancelled = true;
    };
  }, [isConnected, address, refresh]);

  // Wallet-scoped SSE: one connection per tab covers every row in the inbox.
  // Each event is a hint to re-fetch — payload is not the source of truth.
  useEffect(() => {
    if (authStatus !== "ok") return;
    const es = new EventSource("/api/me/events/stream");
    es.onmessage = () => {
      void refresh();
    };
    return () => es.close();
  }, [authStatus, refresh]);

  async function decline(requestId: number) {
    setSubmitting(requestId);
    try {
      const res = await fetch(`/api/engagements/${requestId}/decline`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Request declined");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  async function propose(req: InboxRequest, amountEth: string, note: string) {
    setSubmitting(req.request_id);
    try {
      let amountWei: bigint;
      try {
        amountWei = parseEther(amountEth);
      } catch {
        throw new Error("amount must be a decimal ETH value (e.g. 0.5)");
      }
      if (amountWei <= 0n) throw new Error("amount must be positive");

      const message = proposalMessage({
        matterId: req.matter.id,
        amountWei: amountWei.toString(),
        note,
        prevProposalId: null,
      });
      const signature = await signMessageAsync({ message });

      const res = await fetch(`/api/engagements/${req.request_id}/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_wei: amountWei.toString(),
          note: note || undefined,
          signature,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      toast.success("Proposal sent");
      setOpenRow(null);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="space-y-8 py-8">
      <div>
        <h1 className="text-3xl font-bold">Inbox</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Engagement requests addressed to your wallet. Each row shows what the client has
          disclosed (country of residence + age-over-18 only — no name, no document number) plus
          the matter description.
        </p>
      </div>

      {authStatus === "no-session" && (
        <Alert>
          <AlertTitle>Sign in first</AlertTitle>
          <AlertDescription>
            Connect your wallet and complete{" "}
            <a href="/onboarding/lawyer" className="underline">
              lawyer onboarding
            </a>{" "}
            so clients' requests can find you.
          </AlertDescription>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load inbox</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {authStatus === "ok" && requests.length === 0 && (
        <p className="text-sm text-muted-foreground">No engagement requests yet.</p>
      )}

      <div className="space-y-4">
        {requests.map((r) => {
          const isHeadFromMe =
            r.head_proposal?.proposer_address?.toLowerCase() === address?.toLowerCase();
          return (
            <Card key={r.request_id}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">
                      {r.matter.target_practice_area} · {r.matter.target_jurisdiction}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Request #{r.request_id} · matter #{r.matter.id} ·{" "}
                      {new Date(r.created_at * 1000).toLocaleString()}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={
                      r.status === "pending"
                        ? "default"
                        : r.status === "accepted"
                          ? "secondary"
                          : "outline"
                    }
                  >
                    {r.status}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="whitespace-pre-wrap text-sm">{r.matter.description}</p>

                <div className="rounded-md border bg-muted/40 p-3 text-xs">
                  <div className="font-medium">Client</div>
                  <div className="font-mono text-muted-foreground">{r.client.address}</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {r.client.country_of_residence && (
                      <Badge variant="outline">
                        residence: {r.client.country_of_residence}
                      </Badge>
                    )}
                    {r.client.age_equal_or_over_18 !== null && (
                      <Badge variant="outline">
                        18+: {r.client.age_equal_or_over_18 ? "yes" : "no"}
                      </Badge>
                    )}
                  </div>
                </div>

                {r.head_proposal && (
                  <div className="rounded-md border p-3 text-xs">
                    <div className="font-medium">
                      Current proposal {isHeadFromMe ? "(yours)" : "(client's counter)"}
                    </div>
                    <div className="font-mono text-muted-foreground">
                      {r.head_proposal.amount_wei
                        ? `${(Number(BigInt(r.head_proposal.amount_wei)) / 1e18).toFixed(4)} ETH`
                        : "—"}
                    </div>
                    <div className="text-muted-foreground">
                      {r.proposal_count} message{r.proposal_count === 1 ? "" : "s"} on the chain
                    </div>
                  </div>
                )}

                {r.status === "pending" && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {!r.head_proposal && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() =>
                          setOpenRow(openRow === r.request_id ? null : r.request_id)
                        }
                        disabled={submitting === r.request_id}
                      >
                        {openRow === r.request_id ? "Cancel" : "Propose first milestone"}
                      </Button>
                    )}
                    {/* Once the chain has started, the engagement page is the
                        unified place for both parties to keep negotiating —
                        seeing the client's counter and posting one back. */}
                    {r.head_proposal && (
                      <Button asChild variant="default" size="sm">
                        <a href={`/engagements/${r.request_id}`}>Open thread</a>
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => decline(r.request_id)}
                      disabled={submitting === r.request_id}
                    >
                      {submitting === r.request_id ? "…" : "Decline"}
                    </Button>
                  </div>
                )}

                {openRow === r.request_id && (
                  <ProposeForm
                    onSubmit={(amount, note) => propose(r, amount, note)}
                    disabled={submitting === r.request_id}
                  />
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function ProposeForm({
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
      }}
      className="space-y-3 rounded-md border bg-background p-3"
    >
      <div className="space-y-1.5">
        <Label htmlFor="amount" className="text-xs">
          First-milestone amount (ETH)
        </Label>
        <Input
          id="amount"
          inputMode="decimal"
          placeholder="0.5"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          disabled={disabled}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="note" className="text-xs">
          Scoping note (optional, max 500 chars)
        </Label>
        <Textarea
          id="note"
          rows={3}
          placeholder="Quick line on what this milestone covers."
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
