"use client";

import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, FlaskConical, Info, KeyRound, Lock, Shield, User as UserIcon } from "lucide-react";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { Button } from "@/components/ui/button";
import { TX_WALLET_BRANDS, type EbsiWalletProviderId } from "@/lib/web3/ebsi";
import { truncateAddress } from "@/lib/utils/format";
import { cn } from "@/lib/utils/cn";

// Demo identities. Sarah / Maria match the seeded users in prisma/seed.ts —
// picking either one exercises the "returning user" branch (existing wallet
// → role pulled from the DB → straight sign-in). "New visitor" generates a
// fresh address each time and exercises the first-time signup branch.
const DEMO_IDENTITIES = [
  {
    id: "sarah",
    label: "Sarah Mueller",
    sub: "Returning client",
    address: "0x2222000000000000000000000000000000000001",
  },
  {
    id: "maria",
    label: "Maria Chen",
    sub: "Returning lawyer",
    address: "0x1111000000000000000000000000000000000001",
  },
  {
    id: "new",
    label: "New visitor",
    sub: "Wallet not on file — sign up flow",
    address: null,
  },
] as const;
type DemoIdentityId = (typeof DEMO_IDENTITIES)[number]["id"];

type TxWalletId = (typeof TX_WALLET_BRANDS)[number]["id"];

// Stages — only "tx" (pick wallet) and "sign" (SIWE) are required for every
// user. The "role", "ebsi", and "age" stages only appear when the wallet is
// brand new.
type Stage = "tx" | "role" | "ebsi" | "age" | "sign";

type Role = "client" | "lawyer";

// "Connect" is the wallet handshake (browser learns the address); "sign" is
// SIWE (the signature that binds the wallet to a server session).
type TxConnState = "idle" | "connecting" | "signing";

function makeNonce(): string {
  return Math.random().toString(16).slice(2, 10);
}

function randomWallet(): string {
  const hex = "0123456789abcdef";
  let out = "0x";
  for (let i = 0; i < 40; i++) out += hex[Math.floor(Math.random() * 16)];
  return out;
}

function buildSiweMessage(address: string, role: Role, nonce: string): string {
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

interface ConnectFlowProps {
  // Show demo affordances (identity picker, fake EUDI shortcut). Off in
  // production builds where ENABLE_MOCK_AUTH is also unset.
  showDemoControls: boolean;
}

// Default EUDI provider used when the user clicks the unbranded "Connect EUDI
// wallet" button (real prod would dispatch OID4VC; we just record the choice).
const DEFAULT_EUDI_PROVIDER: EbsiWalletProviderId = "ds";

export function ConnectFlow({ showDemoControls }: ConnectFlowProps) {
  const [stage, setStage] = useState<Stage>("tx");

  // Wallet pick state
  const [demoIdentity, setDemoIdentity] = useState<DemoIdentityId>("new");
  const [chosenTxWallet, setChosenTxWallet] = useState<TxWalletId | null>(null);
  const [txState, setTxState] = useState<TxConnState>("idle");

  // After /api/wallet-status: if existing, role is the stored role; if new,
  // role starts unset and the user picks it on the "role" stage.
  const [walletExists, setWalletExists] = useState<boolean | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const [returningName, setReturningName] = useState<string | null>(null);

  // New-user-only state
  const [ebsi, setEbsi] = useState<EbsiWalletProviderId | null>(null);
  const [ageVerified, setAgeVerified] = useState(false);
  const [ageBusy, setAgeBusy] = useState(false);

  // SIWE preview
  const [siwe, setSiwe] = useState<{ address: string; nonce: string; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The step rail only renders when there's more than one step left to do —
  // i.e. for new users. Existing users go wallet → sign with no rail.
  const newUserSteps: Array<{ k: Stage; label: string }> = role === "lawyer"
    ? [
        { k: "role", label: "Account type" },
        { k: "ebsi", label: "Identity wallet" },
        { k: "sign", label: "Sign in" },
      ]
    : [
        { k: "role", label: "Account type" },
        { k: "ebsi", label: "Identity wallet" },
        { k: "age", label: "Age check" },
        { k: "sign", label: "Sign in" },
      ];

  /**
   * Step 1: the browser asks the wallet provider for the account address.
   * In demo mode we resolve the address from the picked demo identity. We
   * then call /api/wallet-status to decide whether to branch to the new-user
   * onboarding (role → EUDI → Over18) or jump straight to SIWE.
   */
  const handleConnectWallet = async (walletId: TxWalletId) => {
    setChosenTxWallet(walletId);
    setError(null);
    setTxState("connecting");
    try {
      await new Promise((r) => setTimeout(r, 700));
      const identity = DEMO_IDENTITIES.find((d) => d.id === demoIdentity) ?? DEMO_IDENTITIES[2];
      const address = identity.address ?? randomWallet();
      const res = await fetch(`/api/wallet-status?address=${address}`);
      if (!res.ok) throw new Error(`wallet-status failed (${res.status})`);
      const data = (await res.json()) as { exists: boolean; role?: "CLIENT" | "LAWYER"; name?: string | null };
      setWalletExists(data.exists);
      setReturningName(data.name ?? null);

      const nonce = makeNonce();
      if (data.exists && data.role) {
        const r: Role = data.role === "LAWYER" ? "lawyer" : "client";
        setRole(r);
        setSiwe({ address, nonce, message: buildSiweMessage(address, r, nonce) });
        setStage("sign");
      } else {
        setRole(null);
        setSiwe({ address, nonce, message: "" });
        setStage("role");
      }
      setTxState("idle");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Could not connect to wallet: ${msg}.`);
      setTxState("idle");
    }
  };

  const handlePickRole = (r: Role) => {
    setRole(r);
    if (siwe) setSiwe({ ...siwe, message: buildSiweMessage(siwe.address, r, siwe.nonce) });
    setStage("ebsi");
  };

  const handleAge = async () => {
    setAgeBusy(true);
    setError(null);
    try {
      // Mock: in production this opens the user's EUDI wallet to share an
      // Over18 verifiable credential — yes/no, no DOB stored. F10 will
      // verify the presentation and POST to /api/onboarding/attest-client to
      // mint a SCHEMA_CLIENT capability for the wallet. In the dev-mode demo
      // path used here, the dev-sign-in route mints the capability on first
      // sign-in (see app/dev/sign-in/route.ts) so the gate in
      // requireClient() / POST /api/bookings doesn't block the demo. The
      // /api/onboarding/attest-client endpoint exists today (POST, requires
      // session) for the production flow to call.
      await new Promise((r) => setTimeout(r, 1500));
      setAgeVerified(true);
    } finally {
      setAgeBusy(false);
    }
  };

  /**
   * Final step: SIWE. Wallet signs the message; the server verifies the
   * signature, creates the user (for new wallets) and binds the wallet to a
   * session. New lawyers get redirected to /verify-lawyer to upload their
   * bar credentials; everyone else lands on their app home.
   */
  const handleSignIn = async () => {
    if (!siwe || !role) return;
    setTxState("signing");
    setError(null);
    try {
      await new Promise((r) => setTimeout(r, 1100));
      const dest =
        !walletExists && role === "lawyer"
          ? "/verify-lawyer"
          : role === "lawyer"
            ? "/lawyer/dashboard"
            : "/client/home";
      const params = new URLSearchParams({ wallet: siwe.address, role, redirect: dest });
      if (ebsi) params.set("ebsi", ebsi);
      window.location.href = `/dev/sign-in?${params.toString()}`;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Signing failed: ${msg}. Try again.`);
      setTxState("idle");
    }
  };

  const handleDisconnect = () => {
    setChosenTxWallet(null);
    setSiwe(null);
    setWalletExists(null);
    setReturningName(null);
    setRole(null);
    setEbsi(null);
    setAgeVerified(false);
    setError(null);
    setTxState("idle");
    setStage("tx");
  };

  return (
    <div className="mx-auto mt-6 max-w-[720px]">
      {stage !== "tx" && stage !== "sign" && walletExists === false && (
        <div className="mb-7 flex flex-wrap items-center justify-center gap-2">
          {newUserSteps.map((s, i, arr) => {
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
        {stage === "tx" && (
          <>
            <div className="text-center">
              <h1 className="font-display text-3xl text-navy-900 sm:text-4xl">Sign in with your wallet.</h1>
              <p className="mt-3 text-base text-slate-500">
                Your wallet <em>is</em> your account. We'll look up the address — if you've signed in before, you're back in your app. If not, we'll set up a profile.
              </p>
            </div>

            <div className="mt-7 grid gap-2.5">
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

            {showDemoControls && (
              <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-white-50 p-4" data-testid="demo-identity-picker">
                <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
                  <FlaskConical className="h-3 w-3" aria-hidden /> Demo identity
                </div>
                <p className="mt-1 text-[12px] leading-[1.5] text-slate-500">
                  Choose which simulated wallet to open. Returning users skip the signup steps; new visitors go through the full flow. Hidden in production.
                </p>
                <div className="mt-3 grid gap-2">
                  {DEMO_IDENTITIES.map((d) => (
                    <label
                      key={d.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-lg border-2 px-3 py-2.5",
                        demoIdentity === d.id
                          ? "border-teal-500 bg-white-0"
                          : "border-slate-100 bg-white-0 hover:border-slate-200",
                      )}
                    >
                      <input
                        type="radio"
                        name="demo-identity"
                        value={d.id}
                        checked={demoIdentity === d.id}
                        onChange={() => setDemoIdentity(d.id)}
                        className="h-4 w-4 accent-teal-600"
                      />
                      <div className="flex-1">
                        <div className="text-[13px] font-medium text-navy-900">{d.label}</div>
                        <div className="text-[11px] text-slate-500">{d.sub}</div>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

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

            {error && (
              <div className="mt-5 rounded-lg border border-red-50 bg-red-50/40 p-4 text-center text-[13px] text-[#B62525]">
                {error}
              </div>
            )}
          </>
        )}

        {stage === "role" && (
          <>
            <StagePill kind="ebsi" label="STEP 1 OF ?" />
            <h2 className="font-display mt-3 text-center text-2xl text-navy-900 sm:text-3xl">
              Welcome to Firmus Novus.
            </h2>
            <p className="mx-auto mt-2 max-w-[520px] text-center text-[15px] leading-[1.6] text-slate-500">
              No profile is linked to this wallet yet. What brings you here?
            </p>
            <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <RoleCard
                active={role === "client"}
                onClick={() => handlePickRole("client")}
                title="I need legal help"
                body="Find a verified lawyer, book a consultation, and pay through escrow. We'll need an Over18 attestation from your EUDI wallet."
                icon={<UserIcon className="h-7 w-7" aria-hidden style={{ color: "#5B6B7C" }} />}
              />
              <RoleCard
                active={role === "lawyer"}
                onClick={() => handlePickRole("lawyer")}
                title="I'm a lawyer"
                body="Get verified through EBSI and join a marketplace of European counsel. We'll need your ID and bar credentials from your EUDI wallet."
                icon={<EBSIBadge variant="seal" size={32} />}
              />
            </div>
            <div className="mt-7 flex items-start gap-3 rounded-xl bg-white-50 p-4">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-teal-600" aria-hidden />
              <p className="text-[13px] leading-[1.55] text-slate-700">
                Firmus Novus uses two wallets: an{" "}
                <strong className="text-navy-900">EUDI / EBSI-conformant identity wallet</strong> for verifiable credentials, and the{" "}
                <strong className="text-navy-900">Ethereum wallet</strong> you just connected for escrow payments.
              </p>
            </div>
            <div className="mt-6 flex">
              <Button variant="ghost" onClick={handleDisconnect}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> Use a different wallet
              </Button>
            </div>
          </>
        )}

        {stage === "ebsi" && (
          <>
            <StagePill kind="ebsi" label={`EBSI · STEP 2 OF ${role === "lawyer" ? "3" : "4"}`} />
            <h2 className="font-display mt-3 text-center text-2xl text-navy-900 sm:text-3xl">
              Connect your identity wallet.
            </h2>
            <p className="mx-auto mt-2 max-w-[560px] text-center text-[15px] leading-[1.6] text-slate-500">
              We'll open your <strong className="text-navy-900">EUDI / EBSI-conformant wallet</strong> to request the verifiable credentials we need. Your identity stays in your wallet — Firmus Novus only sees the attestations you choose to share.
            </p>

            <div className="mt-6 rounded-xl border-2 border-slate-100 bg-white-0 p-5">
              <div className="flex items-center gap-3">
                <span aria-hidden className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-100">
                  <EBSIBadge variant="seal" size={26} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-navy-900">EUDI wallet</div>
                  <div className="text-[12px] text-slate-500">
                    Any EBSI-conformant identity wallet (DS Wallet, eKibisis, eDiplomas, …)
                  </div>
                </div>
              </div>
            </div>

            <Button
              className="mt-4 w-full"
              size="lg"
              onClick={() => {
                setEbsi(DEFAULT_EUDI_PROVIDER);
                setStage(role === "lawyer" ? "sign" : "age");
              }}
            >
              Connect EUDI wallet <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>

            {showDemoControls && (
              <div className="mt-3">
                <Button
                  variant="outline"
                  className="w-full border-dashed text-slate-700"
                  data-testid="ebsi-demo-shortcut"
                  onClick={() => {
                    setEbsi(DEFAULT_EUDI_PROVIDER);
                    setStage(role === "lawyer" ? "sign" : "age");
                  }}
                >
                  <FlaskConical className="h-4 w-4" aria-hidden /> Demo: use a fake EUDI wallet
                </Button>
                <p className="mt-1.5 text-center text-[11px] text-slate-500">
                  Skips the OID4VC handshake. Hidden in production.
                </p>
              </div>
            )}

            <div className="mt-6 flex">
              <Button variant="ghost" onClick={() => setStage("role")}>
                <ArrowLeft className="h-4 w-4" aria-hidden /> Back
              </Button>
            </div>
          </>
        )}

        {stage === "age" && (
          <>
            <StagePill kind="ebsi" label="EBSI · STEP 3 OF 4" />
            <h2 className="font-display mt-3 text-center text-2xl text-navy-900 sm:text-3xl">Verify you're 18 or older.</h2>
            <p className="mx-auto mt-2 max-w-[540px] text-center text-[15px] leading-[1.6] text-slate-500">
              Legal counsel is reserved for adults. We'll request an{" "}
              <strong className="text-navy-900">Over18 credential</strong> from your EUDI wallet — a yes/no attestation. Your date of birth and ID are <strong>not stored</strong>.
            </p>
            <div className="mt-6 rounded-xl border border-slate-100 bg-white-50 p-5">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-100 bg-white-0">
                  <Shield className="h-4 w-4 text-teal-600" aria-hidden />
                </span>
                <div>
                  <div className="text-[14px] font-semibold text-navy-900">Credential request</div>
                  <div className="text-[12px] text-slate-500">
                    From: Firmus Novus · To: your EUDI wallet
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
                <Button onClick={() => setStage("sign")} className="flex-1">
                  Continue <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              )}
            </div>
          </>
        )}

        {stage === "sign" && siwe && role && (
          <>
            <StagePill kind="payments" label={walletExists ? "WALLET RECOGNIZED" : `SIGN IN · LAST STEP`} />
            <h2 className="font-display mt-3 text-center text-2xl text-navy-900 sm:text-3xl">
              {walletExists
                ? returningName
                  ? `Welcome back, ${returningName}.`
                  : "Welcome back."
                : "Sign in with Ethereum."}
            </h2>
            <p className="mx-auto mt-2 max-w-[560px] text-center text-[15px] leading-[1.6] text-slate-500">
              {walletExists ? (
                <>
                  We found a <strong className="text-navy-900">{role === "lawyer" ? "lawyer" : "client"}</strong> account for this wallet. Sign the message below to bind it to a session — no transaction, no gas, just a signature.
                </>
              ) : (
                <>
                  Your wallet is <strong className="text-navy-900">connected</strong>. Sign the message to bind this address to your new {role} account.
                </>
              )}
            </p>

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

            {error && (
              <div className="mt-5 flex flex-col items-center gap-3 rounded-lg border border-red-50 bg-red-50/40 p-4 text-center">
                <p className="text-[13px] leading-relaxed text-[#B62525]">{error}</p>
                <Button variant="outline" size="sm" onClick={() => void handleSignIn()}>
                  Try signing again
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
