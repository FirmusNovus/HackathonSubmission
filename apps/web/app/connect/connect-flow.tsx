"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { ArrowRight, Check, Info, Lock, ScrollText, ShieldCheck, User as UserIcon } from "lucide-react";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";
import { Button } from "@/components/ui/button";
import { useVerifierPresentation, type VerifiedResult } from "@/lib/web3/use-verifier-presentation";
import { cn } from "@/lib/utils/cn";

type Stage = "role" | "pid" | "lawyer-cred";

interface ConnectFlowProps {
  initialRole: "client" | "lawyer";
}

/**
 * Trigger an on-chain attestation write via the operator wallet.
 *
 * `kind="client"` is called after every PID presentation (client + lawyer);
 * `kind="lawyer"` is called only after the bar credential presentation.
 * Lawyers therefore get TWO attestations: SCHEMA_CLIENT (eu-resident, 18+)
 * AND SCHEMA_LAWYER (the gate the engagement contract checks). The disclosed
 * cleartext is filtered server-side and dropped after the tx confirms.
 */
async function finalize(
  kind: "client" | "lawyer",
  state: string,
): Promise<{ name?: string | null }> {
  const res = await fetch(`/api/onboarding/${kind}/finalize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `finalize HTTP ${res.status}`);
  }
  return (await res.json().catch(() => ({}))) as { name?: string | null };
}

export function ConnectFlow({ initialRole }: ConnectFlowProps) {
  const [stage, setStage] = useState<Stage>("role");
  const [role, setRole] = useState<"client" | "lawyer">(initialRole);

  const { present, pending: verifierPending } = useVerifierPresentation();
  const { update: updateSession } = useSession();

  const [pid, setPid] = useState<VerifiedResult | null>(null);
  const [lc, setLc] = useState<VerifiedResult | null>(null);
  const pidBusy = verifierPending && !pid;
  const lcBusy = verifierPending && !lc;

  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const steps =
    role === "client"
      ? [
          { k: "role", label: "Role" },
          { k: "pid", label: "Verify identity" },
        ]
      : [
          { k: "role", label: "Role" },
          { k: "pid", label: "Verify identity" },
          { k: "lawyer-cred", label: "Lawyer credential" },
        ];

  const handlePresentPid = async () => {
    setError(null);
    try {
      const result = await present("pid");
      // Finalize: operator wallet writes the EAS client-attestation on chain
      // and stamps the disclosed given_name + family_name onto the User row.
      const fin = await finalize("client", result.state);
      // Push the freshly stamped name through the JWT so every <AvatarBubble />
      // and "Hi {name}" greeting reflects the disclosed identity right away,
      // without needing a sign-out/in cycle. Role stays whatever the user
      // picked (CLIENT here; lawyer-cred step lifts it to LAWYER later).
      if (fin.name) {
        await updateSession({ name: fin.name });
      }
      setPid(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handlePresentLawyerCred = async () => {
    setError(null);
    try {
      const result = await present("bar");
      const fin = await finalize("lawyer", result.state);
      // Refresh the JWT so the role lifts from CLIENT to LAWYER right now —
      // otherwise the immediate redirect to /lawyer/dashboard hits the
      // middleware's role check with a stale token. Also push through the
      // disclosed bar-credential name so `session.user.name` reflects the
      // freshly persisted User.name (used by the dashboard greeting, profile
      // editor, consultation views, etc.).
      await updateSession({ role: "LAWYER", name: fin.name ?? undefined });
      setLc(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleFinish = () => {
    setFinishing(true);
    window.location.href = role === "lawyer" ? "/lawyer/dashboard" : "/client/home";
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
                Next you'll <strong className="text-navy-900">connect your wallet and sign in</strong> in one step. After that, present your{" "}
                <strong className="text-navy-900">PID credential</strong> from your EUDI wallet
                {role === "lawyer" && (
                  <>
                    {" "}plus a <strong className="text-navy-900">verified bar credential</strong>
                  </>
                )}
                . Each presentation is anchored on-chain via EAS — Firmus Novus never sees the underlying documents.
              </p>
            </div>
            <Button onClick={() => setStage("pid")} className="mt-6 w-full" size="lg">
              Continue <ArrowRight className="h-4 w-4" aria-hidden />
            </Button>
          </>
        )}

        {stage === "pid" && (
          <>
            <StagePill kind="ebsi" label={`VERIFY · STEP 1 OF ${role === "lawyer" ? "2" : "1"}`} />
            <h2 className="font-display mt-3 text-center text-2xl text-navy-900 sm:text-3xl">
              Present your PID credential.
            </h2>
            <p className="mx-auto mt-2 max-w-[560px] text-center text-[15px] leading-[1.6] text-slate-500">
              Open your <strong className="text-navy-900">EUDI wallet</strong> and share your PID. We'll only see
              your <strong className="text-navy-900">name</strong> (so your lawyer can address you), your{" "}
              <strong className="text-navy-900">country of residence</strong>, and the fact that you're{" "}
              <strong className="text-navy-900">over 18</strong>. The country + age claims are persisted on chain
              via <strong className="text-navy-900">EAS</strong>; your underlying ID document never leaves your wallet.
            </p>

            <CredentialCard
              kind="pid"
              busy={pidBusy}
              done={!!pid}
              result={pid}
              onPresent={() => void handlePresentPid()}
            />

            {error && <p className="mt-4 text-center text-[13px] text-red-500">{error}</p>}

            {pid && (
              <div className="mt-6">
                {role === "lawyer" ? (
                  <Button onClick={() => setStage("lawyer-cred")} className="w-full" size="lg">
                    Continue <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                ) : (
                  <Button onClick={handleFinish} disabled={finishing} className="w-full" size="lg">
                    {finishing ? "Finishing…" : "Enter Firmus Novus"}
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </Button>
                )}
              </div>
            )}
          </>
        )}

        {stage === "lawyer-cred" && (
          <>
            <StagePill kind="ebsi" label="VERIFY · STEP 2 OF 2" />
            <h2 className="font-display mt-3 text-center text-2xl text-navy-900 sm:text-3xl">
              Present your lawyer credential.
            </h2>
            <p className="mx-auto mt-2 max-w-[560px] text-center text-[15px] leading-[1.6] text-slate-500">
              Open your <strong className="text-navy-900">EUDI wallet</strong> again and share your verified bar credential.
              We'll persist a second EAS attestation against the same wallet — proof of admission, portable across the EU.
            </p>

            <PidSummary result={pid} />

            <CredentialCard
              kind="lawyer"
              busy={lcBusy}
              done={!!lc}
              result={lc}
              onPresent={() => void handlePresentLawyerCred()}
            />

            {error && <p className="mt-4 text-center text-[13px] text-red-500">{error}</p>}

            {lc && (
              <div className="mt-6">
                <Button onClick={handleFinish} disabled={finishing} className="w-full" size="lg">
                  {finishing ? "Finishing…" : "Enter Firmus Novus"}
                  <ArrowRight className="h-4 w-4" aria-hidden />
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
      <div className={cn("mb-4 flex h-14 w-14 items-center justify-center rounded-xl", active ? "bg-white-0" : "bg-white-50")}>
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

function CredentialCard({
  kind,
  busy,
  done,
  result,
  onPresent,
}: {
  kind: "pid" | "lawyer";
  busy: boolean;
  done: boolean;
  result: VerifiedResult | null;
  onPresent: () => void;
}) {
  const title = kind === "pid" ? "PID presentation" : "Lawyer credential presentation";
  const subtitle =
    kind === "pid"
      ? "Identity proof · issued by your eIDAS-conformant identity provider"
      : "Bar admission proof · issued by your jurisdiction's bar association";
  const Icon = kind === "pid" ? ShieldCheck : ScrollText;

  return (
    <div className="mt-6 rounded-xl border border-slate-100 bg-white-50 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-100 bg-white-0">
          <Icon className="h-4.5 w-4.5 text-teal-600" aria-hidden />
        </span>
        <div className="flex-1">
          <div className="text-[14px] font-semibold text-navy-900">{title}</div>
          <div className="text-[12px] text-slate-500">{subtitle}</div>
        </div>
        {done && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#DCFCE7] px-2.5 py-1 text-[11px] font-medium tracking-[0.04em] text-[#166534]">
            <Check className="h-3 w-3" strokeWidth={3} aria-hidden /> Verified
          </span>
        )}
      </div>

      {!done && (
        <Button
          type="button"
          variant="primary"
          size="lg"
          className="mt-5 w-full"
          onClick={onPresent}
          disabled={busy}
          aria-busy={busy}
          data-testid={kind === "pid" ? "present-pid" : "present-lawyer-cred"}
        >
          {busy ? (
            <>
              <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              Awaiting EUDI wallet…
            </>
          ) : (
            <>Present via EUDI wallet</>
          )}
        </Button>
      )}

      {done && result && (
        <div
          className="mt-5 rounded-lg border border-teal-100 bg-white-0 p-4"
          data-testid={kind === "pid" ? "pid-attested" : "lawyer-cred-attested"}
        >
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.12em] text-slate-500">
            <Lock className="h-3 w-3 text-teal-600" aria-hidden /> Disclosed claims
          </div>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-[1.5] text-navy-900">
{JSON.stringify(result.verifiedAttrs, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function PidSummary({ result }: { result: VerifiedResult | null }) {
  if (!result) return null;
  return (
    <div className="mt-6 flex items-center gap-3 rounded-xl border border-slate-100 bg-white-50 p-3">
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#34D399]">
        <Check className="h-3.5 w-3.5 text-white" strokeWidth={2.5} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-navy-900">PID presented</div>
        <div className="truncate font-mono text-[11px] text-slate-500">
          {Object.keys(result.verifiedAttrs).join(", ") || "no claims"}
        </div>
      </div>
    </div>
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
