"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, Info, KeyRound, Lock, Shield, User as UserIcon } from "lucide-react";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { Button } from "@/components/ui/button";
import { EBSI_WALLET_PROVIDERS, TX_WALLET_BRANDS, type EbsiWalletProviderId } from "@/lib/web3/ebsi";
import { truncateAddress } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

// Seeded wallets the mock flow signs in as. One per role — keep these in sync
// with prisma/seed.ts.
const MOCK_CLIENT_WALLET = "0x2222000000000000000000000000000000000001"; // Sarah Mueller
const MOCK_LAWYER_WALLET = "0x1111000000000000000000000000000000000001"; // Maria Chen

type Stage = "role" | "ebsi" | "age" | "tx";
type TxWalletId = (typeof TX_WALLET_BRANDS)[number]["id"];
// "Connect" (browser ↔ wallet handshake) is distinct from "Sign in" (the
// wallet produces a SIWE signature that binds it to a server session). The
// state machine makes the two-step nature explicit in the UI.
type TxConnState = "idle" | "connecting" | "connected" | "signing";

interface ConnectFlowProps {
  initialRole: "client" | "lawyer";
}

function makeNonce(): string {
  return Math.random().toString(16).slice(2, 10);
}

function buildSiweMessage(address: string, role: "client" | "lawyer", nonce: string): string {
  const domain = typeof window !== "undefined" ? window.location.host : "firmusnovus.com";
  const uri = typeof window !== "undefined" ? window.location.origin : "https://firmusnovus.com";
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    `Sign in to Firmus Novus as a ${role}.`,
    "",
    `URI: ${uri}`,
    "Version: 1",
    "Chain ID: 1",
    `Nonce: ${nonce}`,
    `Issued At: ${new Date().toISOString()}`,
  ].join("\n");
}

export function ConnectFlow({ initialRole }: ConnectFlowProps) {
  const [stage, setStage] = useState<Stage>("role");
  const [role, setRole] = useState<"client" | "lawyer">(initialRole);
  const [ebsi, setEbsi] = useState<EbsiWalletProviderId | null>(null);
  const [ageVerified, setAgeVerified] = useState(false);
  const [ageBusy, setAgeBusy] = useState(false);
  const [chosenTxWallet, setChosenTxWallet] = useState<TxWalletId | null>(null);
  const [txState, setTxState] = useState<TxConnState>("idle");
  const [siwe, setSiwe] = useState<{ address: string; nonce: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const steps =
    role === "client"
      ? [
          { k: "role", label: "Role" },
          { k: "ebsi", label: "Identity wallet" },
          { k: "age", label: "Age check" },
          { k: "tx", label: "Transaction wallet" },
        ]
      : [
          { k: "role", label: "Role" },
          { k: "ebsi", label: "Identity wallet" },
          { k: "tx", label: "Transaction wallet" },
        ];

  const handleAge = async () => {
    setAgeBusy(true);
    setError(null);
    try {
      // Mock: in production this opens the user's identity wallet to share an Over18 VC.
      await new Promise((r) => setTimeout(r, 1500));
      setAgeVerified(true);
    } finally {
      setAgeBusy(false);
    }
  };

  /**
   * Step 1 of the wallet auth: the browser asks the wallet provider for the
   * account address. In demo mode we simulate the handshake — the wallet ends
   * up "connected" but the user is *not* yet signed in to the server.
   */
  const handleConnectWallet = async (walletId: TxWalletId) => {
    setChosenTxWallet(walletId);
    setError(null);
    setTxState("connecting");
    try {
      await new Promise((r) => setTimeout(r, 900));
      const address = role === "lawyer" ? MOCK_LAWYER_WALLET : MOCK_CLIENT_WALLET;
      const nonce = makeNonce();
      setSiwe({ address, nonce, message: buildSiweMessage(address, role, nonce) });
      setTxState("connected");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not connect to wallet: ${msg}.`);
      setTxState("idle");
    }
  };

  /**
   * Step 2: Sign-In with Ethereum. The wallet signs the SIWE message above;
   * the server verifies the signature and binds the wallet to a session. In
   * demo mode the verification is bypassed but the UX matches the real flow
   * so users see the explicit signature step. Until this happens the wallet
   * is just "connected" — the server still doesn't know who is asking.
   */
  const handleSignIn = async () => {
    if (!siwe) return;
    setTxState("signing");
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 1200));
      const dest = role === "lawyer" ? "/lawyer/dashboard" : "/client/home";
      window.location.href = `/dev/sign-in?wallet=${siwe.address}&role=${role}&redirect=${encodeURIComponent(dest)}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Signing failed: ${msg}. Try again.`);
      setTxState("connected");
    }
  };

  const handleDisconnect = () => {
    setChosenTxWallet(null);
    setSiwe(null);
    setTxState("idle");
    setError(null);
  };

  return (
    <div className="mx-auto mt-6 max-w-[720px]">
      {stage !== "role" && (
        <div className="mb-7 flex flex-wrap items-center justify-center gap-2">
          {steps.map((s, i, arr) => {
            const order = arr.findIndex((x) => x.k === stage);
            const done = i < order;
            const active = i === order;
            return (
              <div key={s.k} className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-[22px] w-[22px] items-center justify-center rounded-full text-[11px] font-medium",
                    done
                      ? "border-2 border-teal-500 bg-teal-500 text-white"
                      : active
                        ? "border-2 border-teal-500 bg-white-0 text-teal-700"
                        : "border-2 border-slate-200 bg-white-0 text-slate-300",
                  )}
                >
                  {done ? <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> : i + 1}
                </span>
                <span className={active ? "text-[12px] font-medium text-navy-900" : "text-[12px] font-medium text-slate-500"}>
                  {s.label}
                </span>
                {i < arr.length - 1 && <span aria-hidden className={cn("h-0.5 w-7", done ? "bg-teal-500" : "bg-slate-100")} />}
              </div>
            );
          })}
        </div>
      )}

      <div className="rounded-2xl border border-slate-100 bg-white-0 p-8 shadow-[var(--shadow-md)] sm:p-12">
        {stage === "role" && (
          <>
            <div className="text-center">
              <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">Welcome to Firmus Novus.</h1>
              <p className="mt-3 text-base text-slate-500">Choose how you'd like to begin.</p>
            </div>
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <RoleCard
                active={role === "client"}
                onClick={() => setRole("client")}
                title="I need legal help"
                body="Find an EBSI-verified lawyer, book a consultation, and pay securely through escrow."
                icon={<UserIcon className="h-7 w-7" aria-hidden style={{ color: role === "client" ? "#14B8A6" : "#5B6B7C" }} />}
              />
              <RoleCard
                active={role === "lawyer"}
                onClick={() => setRole("lawyer")}
                title="I'm a lawyer"
                body="Get verified through EBSI and join a verified marketplace of European counsel."
                icon={<EBSIBadge variant="seal" size={32} />}
              />
            </div>
            <div className="mt-7 flex items-start gap-3 rounded-xl bg-white-50 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
              <p className="text-[13px] leading-[1.55] text-slate-700">
                Firmus Novus uses two wallets: an{" "}
                <strong className="text-navy-900">EBSI-conformant identity wallet</strong> for verified credentials, and a{" "}
                <strong className="text-navy-900">transaction wallet</strong> for escrow payments. We'll connect them in the next two steps.
              </p>
            </div>
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-amber-50 bg-amber-50/40 p-4">
              <span aria-hidden className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
              <p className="text-[12px] leading-[1.55] text-slate-700">
                <strong className="text-navy-900">Demo mode:</strong> wallet connections and signatures are simulated. You'll be signed in as a seeded user — Sarah Mueller (client) or Maria Chen (lawyer).
              </p>
            </div>
            <Button onClick={() => setStage("ebsi")} className="mt-6 w-full" size="lg">
              Continue <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </>
        )}

        {stage === "ebsi" && (
          <>
            <StagePill kind="ebsi" label={`EBSI · STEP 1 OF ${role === "client" ? "3" : "2"}`} />
            <h2 className="font-display mt-3 text-center text-2xl text-navy-900 sm:text-3xl">
              Connect your identity wallet.
            </h2>
            <p className="mx-auto mt-2 max-w-[560px] text-center text-[15px] leading-[1.6] text-slate-500">
              Choose an <strong className="text-navy-900">EBSI-conformant wallet</strong> to hold your verifiable credentials. Your identity stays in your wallet — Firmus Novus never sees the underlying documents.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {EBSI_WALLET_PROVIDERS.map((w) => (
                <WalletOption
                  key={w.id}
                  active={ebsi === w.id}
                  onClick={() => setEbsi(w.id)}
                  name={w.name}
                  org={w.org}
                  color={w.color}
                  ebsi
                />
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <Button variant="ghost" onClick={() => setStage("role")}>
                Back
              </Button>
              <Button
                disabled={!ebsi}
                className="flex-1"
                onClick={() => setStage(role === "client" ? "age" : "tx")}
              >
                {ebsi ? `Connect ${EBSI_WALLET_PROVIDERS.find((w) => w.id === ebsi)?.name}` : "Choose a wallet to continue"}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          </>
        )}

        {stage === "age" && (
          <>
            <StagePill kind="ebsi" label="EBSI · STEP 2 OF 3" />
            <h2 className="font-display mt-3 text-center text-2xl text-navy-900 sm:text-3xl">Verify you're 18 or older.</h2>
            <p className="mx-auto mt-2 max-w-[540px] text-center text-[15px] leading-[1.6] text-slate-500">
              Legal counsel is reserved for adults. We'll request an{" "}
              <strong className="text-navy-900">Over18 credential</strong> from your identity wallet — a yes/no attestation. Your date of birth is never shared with Firmus Novus.
            </p>
            <div className="mt-6 rounded-xl border border-slate-100 bg-white-50 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-100 bg-white-0">
                  <Shield className="h-4 w-4 text-teal-600" aria-hidden />
                </span>
                <div>
                  <div className="text-[14px] font-semibold text-navy-900">Credential request</div>
                  <div className="text-[12px] text-slate-500">
                    From: Firmus Novus · To: {EBSI_WALLET_PROVIDERS.find((w) => w.id === ebsi)?.name ?? "your wallet"}
                  </div>
                </div>
                {ageVerified && (
                  <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[11px] font-medium tracking-[0.04em] text-[#166534]">
                    <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> Verified
                  </span>
                )}
              </div>
              <div className="mt-4 flex items-center justify-between rounded-lg border border-slate-100 bg-white-0 px-3.5 py-3">
                <div>
                  <div className="text-[13px] font-medium text-navy-900">Over18 attestation</div>
                  <div className="mt-0.5 text-[12px] text-slate-500">
                    Boolean · proves age ≥ 18 without revealing DOB
                  </div>
                </div>
                <span className="rounded bg-teal-50 px-2 py-0.5 font-mono text-[11px] font-medium tracking-wide text-teal-700">VC</span>
              </div>
              <div className="mt-2 flex items-center gap-2 px-1 text-[12px] text-slate-500">
                <Lock className="h-3 w-3 text-teal-600" aria-hidden />
                Issued by your country's eIDAS-conformant identity provider
              </div>
            </div>
            <div className="mt-6 flex gap-3">
              <Button variant="ghost" onClick={() => setStage("ebsi")}>
                Back
              </Button>
              {!ageVerified ? (
                <Button onClick={handleAge} disabled={ageBusy} className="flex-1">
                  {ageBusy ? "Awaiting wallet approval…" : "Share Over18 credential"}
                </Button>
              ) : (
                <Button onClick={() => setStage("tx")} className="flex-1">
                  Continue <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          </>
        )}

        {stage === "tx" && (
          <>
            <StagePill kind="payments" label={`PAYMENTS · STEP ${role === "client" ? "3 OF 3" : "2 OF 2"}`} />
            <h2 className="font-display mt-3 text-center text-2xl text-navy-900 sm:text-3xl">
              {txState === "idle" || txState === "connecting"
                ? "Connect your transaction wallet."
                : "Sign in with Ethereum."}
            </h2>
            <p className="mx-auto mt-2 max-w-[560px] text-center text-[15px] leading-[1.6] text-slate-500">
              {txState === "idle" || txState === "connecting" ? (
                role === "lawyer"
                  ? "This is where consultation fees will be paid out from escrow once a session is marked complete."
                  : "This is where you'll fund consultations into smart-contract escrow. Funds are released to the lawyer only when the consultation completes."
              ) : (
                <>
                  Your wallet is <strong className="text-navy-900">connected</strong>, but the server doesn't yet know who is asking. Sign the message below to bind this wallet to a Firmus Novus session — your signature is the proof you control this address.
                </>
              )}
            </p>

            <div className="mt-6 flex items-center gap-3 rounded-xl border border-slate-100 bg-white-50 p-3">
              <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#34D399]">
                <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.5} aria-hidden />
              </span>
              <div className="flex-1">
                <div className="text-[13px] font-medium text-navy-900">Identity wallet connected</div>
                <div className="text-[12px] text-slate-500">
                  {EBSI_WALLET_PROVIDERS.find((w) => w.id === ebsi)?.name ?? "EBSI wallet"} · linked to your Firmus Novus account
                </div>
              </div>
              <button onClick={() => setStage("ebsi")} className="text-[12px] font-medium text-teal-600 hover:underline">
                Change
              </button>
            </div>

            {(txState === "idle" || txState === "connecting") && (
              <>
                <div className="mt-5 grid gap-2.5">
                  {TX_WALLET_BRANDS.map((w) => (
                    <WalletOption
                      key={w.id}
                      active={chosenTxWallet === w.id}
                      onClick={() => void handleConnectWallet(w.id)}
                      disabled={txState === "connecting"}
                      name={w.name}
                      org={w.org}
                      color={w.color}
                    />
                  ))}
                </div>

                <p className="mt-5 flex items-center justify-center gap-2 text-[12px] text-slate-500">
                  <Lock className="h-3 w-3 text-teal-600" aria-hidden /> Demo mode: no real wallet is opened — connect + sign are simulated.
                </p>

                {txState === "connecting" && (
                  <div
                    role="status"
                    data-testid="tx-connecting"
                    className="mt-5 flex items-center justify-center gap-3 rounded-lg bg-teal-50 p-4"
                  >
                    <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
                    <p className="text-[13px] font-medium text-teal-700">
                      Connecting to {TX_WALLET_BRANDS.find((w) => w.id === chosenTxWallet)?.name}…
                    </p>
                  </div>
                )}
              </>
            )}

            {(txState === "connected" || txState === "signing") && siwe && (
              <>
                <div
                  data-testid="wallet-connected"
                  className="mt-5 flex items-center gap-3 rounded-xl border-2 border-teal-500 bg-teal-50 p-4"
                >
                  <span
                    aria-hidden
                    className="flex h-10 w-10 items-center justify-center rounded-lg font-semibold text-white"
                    style={{ background: TX_WALLET_BRANDS.find((w) => w.id === chosenTxWallet)?.color ?? "#0F172A" }}
                  >
                    {(TX_WALLET_BRANDS.find((w) => w.id === chosenTxWallet)?.name ?? "??")
                      .replace(/[^A-Za-z]/g, "")
                      .slice(0, 2)
                      .toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-navy-900">
                      {TX_WALLET_BRANDS.find((w) => w.id === chosenTxWallet)?.name} · connected
                    </div>
                    <div className="font-mono text-[12px] text-slate-500">{truncateAddress(siwe.address)}</div>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-medium tracking-[0.04em] text-amber-700">
                    Not yet signed in
                  </span>
                </div>

                <div className="mt-4 rounded-xl border border-slate-100 bg-white-50 p-4">
                  <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                    <KeyRound className="h-3 w-3 text-teal-600" aria-hidden />
                    SIWE message · for your wallet to sign
                  </div>
                  <pre
                    data-testid="siwe-message"
                    className="mt-2 whitespace-pre-wrap break-words rounded-lg border border-slate-100 bg-white-0 p-3 font-mono text-[12px] leading-[1.55] text-navy-900"
                  >
                    {siwe.message}
                  </pre>
                  <p className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-500">
                    <Lock className="h-3 w-3 text-teal-600" aria-hidden /> Signing this message proves you control the wallet. No transaction, no gas — just a signature.
                  </p>
                </div>

                {txState === "signing" && (
                  <div
                    role="status"
                    data-testid="siwe-signing"
                    className="mt-5 flex items-center justify-center gap-3 rounded-lg bg-teal-50 p-4"
                  >
                    <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
                    <p className="text-[13px] font-medium text-teal-700">Awaiting signature in your wallet…</p>
                  </div>
                )}

                <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row">
                  <Button variant="ghost" onClick={handleDisconnect} disabled={txState === "signing"}>
                    Disconnect
                  </Button>
                  <Button onClick={() => void handleSignIn()} disabled={txState === "signing"} className="flex-1" size="lg">
                    {txState === "signing" ? "Signing in…" : "Sign in with Ethereum"}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                </div>
              </>
            )}

            {error && (
              <div className="mt-5 flex flex-col items-center gap-3 rounded-lg border border-red-50 bg-red-50/40 p-4 text-center">
                <p className="text-[13px] leading-relaxed text-[#B62525]">{error}</p>
                {txState === "idle" && chosenTxWallet && (
                  <Button variant="outline" size="sm" onClick={() => void handleConnectWallet(chosenTxWallet)}>
                    Try again
                  </Button>
                )}
                {txState === "connected" && (
                  <Button variant="outline" size="sm" onClick={() => void handleSignIn()}>
                    Try signing again
                  </Button>
                )}
              </div>
            )}

            {txState === "idle" && (
              <div className="mt-6 flex justify-between">
                <Button variant="ghost" onClick={() => setStage(role === "client" ? "age" : "ebsi")}>
                  <ArrowLeft className="h-4 w-4" aria-hidden /> Back
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function RoleCard({
  active,
  onClick,
  title,
  body,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative rounded-2xl border-2 p-6 text-left transition-colors",
        active ? "border-teal-500 bg-teal-50" : "border-slate-100 bg-white-0 hover:border-slate-200",
      )}
    >
      <div
        className={cn(
          "mb-4 flex h-14 w-14 items-center justify-center rounded-xl",
          active ? "bg-white-0" : "bg-white-50",
        )}
      >
        {icon}
      </div>
      <div className="text-base font-semibold text-navy-900">{title}</div>
      <div className="mt-1.5 text-[13px] leading-[1.55] text-slate-500">{body}</div>
      {active && (
        <span className="absolute right-4 top-4 flex h-[22px] w-[22px] items-center justify-center rounded-full bg-teal-500">
          <Check className="h-3 w-3 text-white" strokeWidth={2.5} aria-hidden />
        </span>
      )}
    </button>
  );
}

function WalletOption({
  active,
  onClick,
  disabled,
  name,
  org,
  color,
  ebsi,
}: {
  active: boolean;
  onClick: () => void;
  disabled?: boolean;
  name: string;
  org: string;
  color: string;
  ebsi?: boolean;
}) {
  const initials = name.replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3.5 rounded-xl border-2 p-4 text-left transition-colors",
        active ? "border-teal-500 bg-teal-50" : "border-slate-100 bg-white-0 hover:border-slate-200",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <span
        aria-hidden
        className="flex h-10 w-10 items-center justify-center rounded-lg font-semibold text-white"
        style={{ background: color }}
      >
        {initials}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-[14px] font-semibold text-navy-900">
          {name}
          {ebsi && (
            <span className="inline-flex items-center gap-1 rounded bg-gold-100 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-[0.06em] text-gold-700">
              <EBSIBadge variant="seal" size={8} /> EBSI
            </span>
          )}
        </div>
        <div className="truncate text-[12px] text-slate-500">{org}</div>
      </div>
      <span
        className={cn(
          "flex h-5 w-5 items-center justify-center rounded-full border-2",
          active ? "border-teal-500 bg-teal-500" : "border-slate-200 bg-transparent",
        )}
      >
        {active && <Check className="h-3 w-3 text-white" strokeWidth={3} aria-hidden />}
      </span>
    </button>
  );
}

function StagePill({ kind, label }: { kind: "ebsi" | "payments"; label: string }) {
  return (
    <div className="text-center">
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium tracking-[0.06em]",
          kind === "ebsi" ? "bg-gold-100 text-gold-700" : "bg-teal-50 text-teal-700",
        )}
      >
        {kind === "ebsi" && <EBSIBadge variant="seal" size={11} />} {label}
      </span>
    </div>
  );
}
