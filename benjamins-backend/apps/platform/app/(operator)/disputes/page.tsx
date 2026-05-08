"use client";

import { useCallback, useEffect, useState } from "react";
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { formatEther, parseEther } from "viem";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  decryptDisputeBundle,
  type DisputeBundle,
  type EncryptedBundleEnvelope,
} from "@/lib/messaging/dispute-bundle";
import {
  generateOperatorKeypair,
  getOperatorKeypair,
  type StoredOperatorKeypair,
} from "@/lib/messaging/operator-keystore";

interface DisputeRow {
  engagement_id: number;
  milestone_index: number;
  amount_wei: string;
  delivered_at: number | null;
  updated_at: number;
  trigger: "lawyer_escalation" | "client_dispute";
  engagement: {
    client_address: string;
    lawyer_address: string;
    request_id: number | null;
    matter: {
      id: number;
      description: string;
      target_jurisdiction: string;
      target_practice_area: string;
    };
  };
}

interface CalldataPayload {
  contract_address: `0x${string}`;
  function_name: string;
  abi: readonly unknown[];
  args: readonly unknown[];
}

/**
 * Operator-only dispute admin (post Constitution v2.0.0). The operator
 * is the arbiter for the v3 demo scope: each disputed milestone surfaces
 * an inline split form (toLawyer + toClient ETH, must equal the parked
 * amount), and submitting calls `resolveDispute` on chain.
 *
 * Auth: the connected wallet must equal the operator address. The
 * `/api/operator/disputes` GET 403s anyone else; that's surfaced as a
 * clear sign-in-as-operator prompt.
 */
export default function OperatorDisputesPage() {
  const { address, isConnected } = useAccount();
  const { writeContractAsync, data: txHash, isPending: txPending } = useWriteContract();
  const { isLoading: txConfirming } = useWaitForTransactionReceipt({ hash: txHash });

  const [authStatus, setAuthStatus] = useState<"checking" | "ok" | "no-session" | "not-operator">(
    "checking"
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [disputes, setDisputes] = useState<DisputeRow[]>([]);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [operatorKeypair, setOperatorKeypair] = useState<StoredOperatorKeypair | null>(null);
  const [keyState, setKeyState] = useState<"checking" | "missing" | "local-only" | "published">(
    "checking"
  );

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/operator/disputes", { cache: "no-store" });
      if (res.status === 401) {
        setAuthStatus("no-session");
        return;
      }
      if (res.status === 403) {
        setAuthStatus("not-operator");
        return;
      }
      const data = (await res.json()) as { disputes?: DisputeRow[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setDisputes(data.disputes ?? []);
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
    void refresh();
  }, [isConnected, address, refresh]);

  // Operator messaging key bootstrap. We check IndexedDB for a local
  // keypair, fetch the published pubkey from `/api/chain/config`, and
  // surface one of three states:
  //   - missing: no local key, no published key → operator must generate
  //   - local-only: have local key but pubkey doesn't match published one
  //     (e.g. browser cleared, or different operator browser)
  //   - published: local key matches published → ready to decrypt bundles
  useEffect(() => {
    if (authStatus !== "ok") return;
    let cancelled = false;
    (async () => {
      try {
        const local = await getOperatorKeypair();
        const cfg = await fetch("/api/chain/config", { cache: "no-store" }).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled) return;
        const publishedPub = cfg?.operator_messaging_public_key ?? null;
        if (!local) {
          setOperatorKeypair(null);
          setKeyState("missing");
          return;
        }
        setOperatorKeypair(local);
        const matches =
          publishedPub &&
          publishedPub.x === local.publicJwk.x &&
          publishedPub.y === local.publicJwk.y;
        setKeyState(matches ? "published" : "local-only");
      } catch (e) {
        toast.error(`could not load operator key: ${(e as Error).message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authStatus]);

  async function generateAndPublishKey() {
    setBusyKey("generate-key");
    try {
      const kp = await generateOperatorKeypair();
      setOperatorKeypair(kp);
      const res = await fetch("/api/operator/messaging-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key_jwk: kp.publicJwk }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`publish failed: ${text}`);
      }
      setKeyState("published");
      toast.success("Operator key generated and published");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function publishLocalKey() {
    if (!operatorKeypair) return;
    setBusyKey("publish-key");
    try {
      const res = await fetch("/api/operator/messaging-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ public_key_jwk: operatorKeypair.publicJwk }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`publish failed: ${text}`);
      }
      setKeyState("published");
      toast.success("Local operator key republished");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  async function resolve(d: DisputeRow, toLawyerWei: string, toClientWei: string) {
    const key = `${d.engagement_id}-${d.milestone_index}`;
    if (!d.engagement.request_id) {
      toast.error("engagement has no request_id mirror — indexer may be behind");
      return;
    }
    setBusyKey(key);
    try {
      const url = `/api/engagements/${d.engagement.request_id}/milestones/${d.milestone_index}/resolve-calldata`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount_to_lawyer: toLawyerWei,
          amount_to_client: toClientWei,
        }),
      });
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
      toast.success("resolveDispute submitted");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-6 py-8">
      <div>
        <h1 className="text-3xl font-bold">Operator · Disputes</h1>
        <p className="mt-2 max-w-prose text-muted-foreground">
          Every milestone currently in <code>disputed</code> state. For each one, enter
          how the parked amount should split between the lawyer and client; the contract
          pays both addresses in a single tx. The split must equal the milestone amount
          to the wei.
        </p>
      </div>

      {authStatus === "no-session" && (
        <Alert>
          <AlertTitle>Connect your operator wallet</AlertTitle>
          <AlertDescription>
            This page is only visible to the operator wallet (anvil account 0). Connect
            that wallet and complete SIWE first.
          </AlertDescription>
        </Alert>
      )}

      {authStatus === "not-operator" && (
        <Alert variant="destructive">
          <AlertTitle>Operator only</AlertTitle>
          <AlertDescription>
            The connected wallet is not the platform operator. Switch to the operator
            wallet to resolve disputes.
          </AlertDescription>
        </Alert>
      )}

      {loadError && (
        <Alert variant="destructive">
          <AlertTitle>Couldn't load disputes</AlertTitle>
          <AlertDescription>{loadError}</AlertDescription>
        </Alert>
      )}

      {authStatus === "ok" && keyState === "missing" && (
        <Alert>
          <AlertTitle>Generate operator messaging key</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              Disputers encrypt their chat bundle to a P-256 public key the operator
              publishes here. Generate a keypair (private half stays in this browser's
              IndexedDB; public half goes to the platform directory).
            </p>
            <Button
              size="sm"
              disabled={busyKey === "generate-key"}
              onClick={generateAndPublishKey}
            >
              {busyKey === "generate-key" ? "Generating…" : "Generate operator key"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {authStatus === "ok" && keyState === "local-only" && (
        <Alert variant="destructive">
          <AlertTitle>Local key doesn't match published</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>
              This browser holds an operator keypair, but the published public key is
              different (or not set). Re-publish this browser's public key to make
              future disputes encryptable to it.
            </p>
            <Button
              size="sm"
              disabled={busyKey === "publish-key"}
              onClick={publishLocalKey}
            >
              {busyKey === "publish-key" ? "Publishing…" : "Republish local key"}
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {authStatus === "ok" && disputes.length === 0 && (
        <p className="text-sm text-muted-foreground">No active disputes.</p>
      )}

      <div className="space-y-4">
        {disputes.map((d) => {
          const key = `${d.engagement_id}-${d.milestone_index}`;
          return (
            <DisputeCard
              key={key}
              dispute={d}
              busy={busyKey === key || txPending || txConfirming}
              operatorKeypair={operatorKeypair}
              onResolve={(toLawyerWei, toClientWei) => resolve(d, toLawyerWei, toClientWei)}
            />
          );
        })}
      </div>
    </div>
  );
}

function DisputeCard({
  dispute,
  busy,
  operatorKeypair,
  onResolve,
}: {
  dispute: DisputeRow;
  busy: boolean;
  operatorKeypair: StoredOperatorKeypair | null;
  onResolve: (toLawyerWei: string, toClientWei: string) => void | Promise<void>;
}) {
  const d = dispute;
  const total = BigInt(d.amount_wei);
  const [toLawyerEth, setToLawyerEth] = useState("");
  const [toClientEth, setToClientEth] = useState("");
  const [bundles, setBundles] = useState<DisputeBundle[]>([]);
  const [bundleLoadState, setBundleLoadState] = useState<"idle" | "loading" | "loaded" | "empty">(
    "idle"
  );
  const [bundleError, setBundleError] = useState<string | null>(null);

  async function loadAndDecryptBundles() {
    if (!operatorKeypair) {
      toast.error("operator keypair missing — generate it first");
      return;
    }
    setBundleLoadState("loading");
    setBundleError(null);
    try {
      const url = `/api/engagements/${d.engagement.request_id}/milestones/${d.milestone_index}/dispute-bundle`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
      }
      const data = (await res.json()) as { bundles: EncryptedBundleEnvelope[] };
      if (!data.bundles || data.bundles.length === 0) {
        setBundleLoadState("empty");
        return;
      }
      const decrypted = await Promise.all(
        data.bundles.map((b) => decryptDisputeBundle(operatorKeypair.privateJwk, b))
      );
      setBundles(decrypted);
      setBundleLoadState("loaded");
    } catch (e) {
      setBundleError((e as Error).message);
      setBundleLoadState("idle");
    }
  }

  let validation:
    | { valid: true; toLawyerWei: string; toClientWei: string }
    | { valid: false; reason: string }
    | null = null;
  if (toLawyerEth.trim() && toClientEth.trim()) {
    try {
      const lw = parseEther(toLawyerEth.trim());
      const cw = parseEther(toClientEth.trim());
      if (lw < 0n || cw < 0n) validation = { valid: false, reason: "amounts must be non-negative" };
      else if (lw + cw !== total)
        validation = {
          valid: false,
          reason: `sum is ${formatEther(lw + cw)} ETH, must equal ${formatEther(total)} ETH`,
        };
      else validation = { valid: true, toLawyerWei: lw.toString(), toClientWei: cw.toString() };
    } catch {
      validation = { valid: false, reason: "amounts must be decimal ETH (e.g. 0.5)" };
    }
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">
              Engagement #{d.engagement_id} · Milestone #{d.milestone_index}
            </CardTitle>
            <CardDescription className="text-xs">
              {d.engagement.matter.target_practice_area} ·{" "}
              {d.engagement.matter.target_jurisdiction} ·{" "}
              <span className="font-mono">{formatEther(total)} ETH</span> parked · disputed{" "}
              {new Date(d.updated_at * 1000).toLocaleString()}
            </CardDescription>
          </div>
          <Badge variant={d.trigger === "lawyer_escalation" ? "secondary" : "destructive"}>
            {d.trigger === "lawyer_escalation" ? "lawyer escalation" : "client dispute"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="whitespace-pre-wrap text-sm">{d.engagement.matter.description}</p>

        <div className="grid gap-1 rounded-md border bg-muted/40 p-3 text-xs">
          <div>
            <span className="text-muted-foreground">client</span>{" "}
            <span className="font-mono">{d.engagement.client_address}</span>
          </div>
          <div>
            <span className="text-muted-foreground">lawyer</span>{" "}
            <span className="font-mono">{d.engagement.lawyer_address}</span>
          </div>
        </div>

        <div className="space-y-2 rounded-md border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-medium">Disclosed chat bundle</div>
            {bundleLoadState !== "loaded" && (
              <Button
                size="sm"
                variant="outline"
                disabled={busy || bundleLoadState === "loading" || !operatorKeypair}
                onClick={loadAndDecryptBundles}
              >
                {bundleLoadState === "loading" ? "Decrypting…" : "Decrypt chat bundle"}
              </Button>
            )}
          </div>
          {bundleLoadState === "empty" && (
            <p className="text-[11px] text-muted-foreground">
              No bundle uploaded for this dispute. Either party can upload one when
              filing or escalating.
            </p>
          )}
          {bundleError && (
            <p className="text-[11px] text-destructive">Decrypt failed: {bundleError}</p>
          )}
          {bundleLoadState === "loaded" &&
            bundles.map((b, i) => <BundleView key={i} bundle={b} />)}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (validation && validation.valid) {
              void onResolve(validation.toLawyerWei, validation.toClientWei);
            }
          }}
          className="space-y-3 rounded-md border p-3"
        >
          <div className="text-xs font-medium">Resolve split</div>
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor={`lawyer-${d.engagement_id}-${d.milestone_index}`} className="text-xs">
                To lawyer (ETH)
              </Label>
              <Input
                id={`lawyer-${d.engagement_id}-${d.milestone_index}`}
                inputMode="decimal"
                placeholder="0.6"
                value={toLawyerEth}
                onChange={(e) => setToLawyerEth(e.target.value)}
                disabled={busy}
                className="w-28"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`client-${d.engagement_id}-${d.milestone_index}`} className="text-xs">
                To client (ETH)
              </Label>
              <Input
                id={`client-${d.engagement_id}-${d.milestone_index}`}
                inputMode="decimal"
                placeholder="0.4"
                value={toClientEth}
                onChange={(e) => setToClientEth(e.target.value)}
                disabled={busy}
                className="w-28"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              disabled={busy || validation === null || !validation.valid}
            >
              Resolve
            </Button>
          </div>
          {validation && !validation.valid && (
            <p className="text-[11px] text-destructive">{validation.reason}</p>
          )}
          {validation && validation.valid && (
            <p className="text-[11px] text-muted-foreground">
              Split sums to <span className="font-mono">{formatEther(total)} ETH</span> ✓ —
              ready to submit.
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

function BundleView({ bundle }: { bundle: DisputeBundle }) {
  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2 text-[11px]">
      <div className="text-muted-foreground">
        Filed by <span className="font-mono">{bundle.filed_by}</span> at{" "}
        {new Date(bundle.filed_at * 1000).toLocaleString()} ·{" "}
        {bundle.messages.length} message
        {bundle.messages.length === 1 ? "" : "s"}
      </div>
      {bundle.first_milestone_proposals.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            First-milestone negotiation ({bundle.first_milestone_proposals.length})
          </summary>
          <ul className="mt-1 space-y-1 pl-3">
            {bundle.first_milestone_proposals.map((p) => (
              <li key={p.id}>
                <span className="font-mono">{p.amount_wei}</span> wei from{" "}
                <span className="font-mono">{p.proposer.slice(0, 10)}…</span>
                {p.note ? ` — ${p.note}` : ""}
                {p.superseded_by ? " (superseded)" : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {bundle.milestone_offers.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            Follow-up milestone offers ({bundle.milestone_offers.length})
          </summary>
          <ul className="mt-1 space-y-1 pl-3">
            {bundle.milestone_offers.map((o) => (
              <li key={o.id}>
                <span className="font-mono">{o.amount_wei}</span> wei from{" "}
                <span className="font-mono">{o.proposer.slice(0, 10)}…</span>
                {o.note ? ` — ${o.note}` : ""}
                {o.accepted_milestone_index !== null
                  ? ` (funded as milestone #${o.accepted_milestone_index})`
                  : o.superseded_by
                    ? " (superseded)"
                    : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
      {bundle.refund_authorizations.length > 0 && (
        <details>
          <summary className="cursor-pointer">
            Refund authorizations ({bundle.refund_authorizations.length})
          </summary>
          <ul className="mt-1 space-y-1 pl-3">
            {bundle.refund_authorizations.map((a, i) => (
              <li key={i}>
                m#{a.milestone_index} signed by{" "}
                <span className="font-mono">{a.signer_address.slice(0, 10)}…</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details open>
        <summary className="cursor-pointer">Messages ({bundle.messages.length})</summary>
        <ol className="mt-1 space-y-1.5 pl-3">
          {bundle.messages.map((m) => (
            <li key={m.leaf_index} className="rounded border bg-background p-2">
              <div className="text-[10px] text-muted-foreground">
                #{m.leaf_index} · <span className="font-mono">{m.sender.slice(0, 10)}…</span> ·{" "}
                {new Date(m.created_at * 1000).toLocaleString()}
              </div>
              <div className="mt-0.5 whitespace-pre-wrap text-xs">{m.plaintext}</div>
            </li>
          ))}
        </ol>
      </details>
    </div>
  );
}
