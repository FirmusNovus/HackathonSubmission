"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Gavel, Lock, RefreshCcw } from "lucide-react";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from "wagmi";
import type { Address, Hex } from "viem";
import { parseEther } from "viem";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ESCROW_ABI } from "@/lib/web3/escrow";
import { useMessagingKeys } from "@/lib/hooks/use-messaging-keys";
import { decryptMessage, publicKeyFromBase64 } from "@/lib/crypto/messaging";
import { formatETH } from "@/lib/utils/format";

interface ArchiveEntry {
  originalMessageId: string;
  ciphertextForArbiter: string;
  nonce: string;
  originalSenderId: string;
  originalSenderEncryptionPublicKey: string | null;
  originalCreatedAt: string;
}

interface ServerArchive {
  id: string;
  submittedAt: string;
  submitterUserId: string;
  submitterName: string;
  submitterRole: "CLIENT" | "LAWYER";
  submitterEncryptionPublicKey: string;
  encryptedBundle: string; // JSON-stringified ArchiveEntry[]
}

interface ResolveDisputeViewProps {
  kind: "booking" | "order";
  id: string;
  engagementIdOnChain: number;
  milestoneIndex: number;
  amountETH: number;
  clientName: string;
  lawyerName: string;
  clientWallet: Address;
  lawyerWallet: Address;
  caseSummary: string;
  archives: ServerArchive[];
  escrowAddress: Address;
  expectedChainId: number;
}

/**
 * Operator's case-review surface. Parses each party's submitted archive
 * client-side (the operator's privkey + each submitter's pubkey), shows
 * the decrypted text alongside the case description, then collects a
 * split decision and submits `resolveDispute(...)` from the operator's
 * wallet. After the chain confirms, POSTs the txHash to
 * /api/admin/resolve-dispute for server-side verification + DB update.
 */
export function ResolveDisputeView(props: ResolveDisputeViewProps) {
  const router = useRouter();
  const { address: connectedAddress } = useAccount();
  const chainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { keypair } = useMessagingKeys();

  const [toLawyer, setToLawyer] = useState(props.amountETH);
  const [toClient, setToClient] = useState(0);
  const [step, setStep] = useState<"idle" | "wallet" | "verifying">("idle");
  const [error, setError] = useState<string | null>(null);

  // Decrypt every archive entry as soon as we have the operator privkey.
  // This is pure derivation; the result is N transcripts the operator
  // reads side-by-side.
  const decryptedArchives = useMemo(() => {
    if (!keypair) return null;
    return props.archives.map((a) => {
      let entries: ArchiveEntry[];
      try {
        entries = JSON.parse(a.encryptedBundle) as ArchiveEntry[];
      } catch {
        return { ...a, lines: [] as { ts: string; text: string; status: "ok" | "fail" }[] };
      }
      const submitterPub = publicKeyFromBase64(a.submitterEncryptionPublicKey);
      const lines = entries.map((e) => {
        const plain = decryptMessage(e.ciphertextForArbiter, e.nonce, submitterPub, keypair.secretKey);
        return {
          ts: e.originalCreatedAt,
          text: plain ?? "⚠ could not decrypt this entry",
          status: (plain == null ? "fail" : "ok") as "ok" | "fail",
        };
      });
      return { ...a, lines };
    });
  }, [keypair, props.archives]);

  const total = props.amountETH;
  const splitValid = Math.abs(toLawyer + toClient - total) < 1e-12 && toLawyer >= 0 && toClient >= 0;

  const submit = async () => {
    setError(null);
    if (!connectedAddress) {
      setError("Connect the operator wallet to submit the resolution.");
      return;
    }
    if (!splitValid) {
      setError(`Split must total exactly ${formatETH(total)}.`);
      return;
    }
    try {
      if (chainId !== props.expectedChainId) {
        await switchChainAsync({ chainId: props.expectedChainId });
      }
      setStep("wallet");
      const txHash: Hex = await writeContractAsync({
        chainId: props.expectedChainId,
        address: props.escrowAddress,
        abi: ESCROW_ABI,
        functionName: "resolveDispute",
        args: [
          BigInt(props.engagementIdOnChain),
          BigInt(props.milestoneIndex),
          parseEther(toLawyer.toFixed(18)),
          parseEther(toClient.toFixed(18)),
        ],
      });
      setStep("verifying");
      const fin = await fetch("/api/admin/resolve-dispute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: props.kind,
          id: props.id,
          txHash,
        }),
      });
      if (!fin.ok) {
        const data = await fin.json().catch(() => ({}));
        throw new Error(data?.error ?? "Server could not verify the resolution tx.");
      }
      router.push("/admin/dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStep("idle");
    }
  };

  const busy = step !== "idle";
  const stepLabel = (() => {
    switch (step) {
      case "wallet": return "Confirm in wallet…";
      case "verifying": return "Verifying receipt…";
      default: return "Submit split";
    }
  })();

  return (
    <div className="mt-7 grid gap-6 lg:grid-cols-[1fr_360px]">
      {/* Archives — left column */}
      <div>
        <section className="rounded-2xl border border-slate-100 bg-white-0 p-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">Case summary</h2>
          <p className="mt-2 whitespace-pre-line text-[14px] leading-relaxed text-navy-900">{props.caseSummary}</p>
        </section>

        <section className="mt-6">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">
              <Lock className="mr-1.5 inline h-3.5 w-3.5 text-teal-600" aria-hidden /> Submitted archives
            </h2>
          </div>

          {!keypair && (
            <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-800">
              Enable secure messaging on this wallet first — your privkey is needed to decrypt the archives.
              Visit /lawyer/messages or /client/messages on this same browser as the operator wallet to enroll.
            </p>
          )}

          {decryptedArchives && decryptedArchives.length === 0 && (
            <p className="mt-3 rounded-xl border border-dashed border-slate-200 p-6 text-center text-[13px] text-slate-500">
              Neither party has submitted their archive yet.
            </p>
          )}

          {decryptedArchives?.map((a) => (
            <div key={a.id} className="mt-4 rounded-2xl border border-slate-100 bg-white-0 p-5">
              <div className="flex items-center justify-between">
                <div className="text-[13px] font-semibold text-navy-900">
                  {a.submitterName} <span className="text-slate-500">({a.submitterRole.toLowerCase()})</span>
                </div>
                <span className="text-[11px] text-slate-500">
                  Submitted {new Date(a.submittedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <ul className="mt-3 space-y-2">
                {a.lines.length === 0 && (
                  <li className="text-[12px] italic text-slate-500">(empty bundle)</li>
                )}
                {a.lines.map((line, idx) => (
                  <li
                    key={idx}
                    className={
                      line.status === "ok"
                        ? "rounded-lg bg-white-50 px-3 py-2 text-[13px] leading-relaxed text-navy-900"
                        : "rounded-lg bg-red-50 px-3 py-2 text-[12px] italic text-red-700"
                    }
                  >
                    <div className="text-[10px] uppercase tracking-[0.08em] text-slate-500">
                      {new Date(line.ts).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                    <div className="mt-0.5 whitespace-pre-line">{line.text}</div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      </div>

      {/* Resolution form — right column */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-2xl border border-slate-100 bg-white-0 p-6">
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-slate-500">
            <Gavel className="mr-1.5 inline h-3.5 w-3.5" aria-hidden /> Resolve
          </h2>
          <p className="mt-2 text-[12px] text-slate-500">
            Total parked: <strong className="text-navy-900">{formatETH(total)}</strong>. The two amounts
            must sum exactly to this. Calls{" "}
            <code className="rounded bg-slate-50 px-1 py-0.5 font-mono text-[10px]">resolveDispute</code> on
            chain from your operator wallet.
          </p>
          <div className="mt-4 space-y-3">
            <div>
              <Label className="mb-1 block">To {props.lawyerName} (lawyer)</Label>
              <Input
                type="number"
                min={0}
                max={total}
                step="0.001"
                value={toLawyer}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setToLawyer(v);
                  setToClient(+(total - v).toFixed(18));
                }}
              />
            </div>
            <div>
              <Label className="mb-1 block">To {props.clientName} (client)</Label>
              <Input
                type="number"
                min={0}
                max={total}
                step="0.001"
                value={toClient}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setToClient(v);
                  setToLawyer(+(total - v).toFixed(18));
                }}
              />
            </div>
            <div className="flex items-center justify-between text-[12px]">
              <span className="text-slate-500">Sum</span>
              <span className={splitValid ? "font-medium text-teal-700" : "font-medium text-red-500"}>
                {formatETH(toLawyer + toClient)} / {formatETH(total)}
              </span>
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setToLawyer(total);
                setToClient(0);
              }}
            >
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> 100% lawyer
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setToLawyer(0);
                setToClient(total);
              }}
            >
              <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> 100% client
            </Button>
          </div>
          {error && <p className="mt-3 text-[12px] text-red-500">{error}</p>}
          <Button
            onClick={() => void submit()}
            disabled={busy || !splitValid || !connectedAddress}
            size="lg"
            className="mt-4 w-full"
          >
            {busy ? (
              <>
                <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
                {stepLabel}
              </>
            ) : (
              stepLabel
            )}
          </Button>
        </div>
      </aside>
    </div>
  );
}
