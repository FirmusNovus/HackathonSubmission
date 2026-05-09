"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { ArrowRight, Briefcase, Loader2, ShieldCheck, Wallet } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Role = "lawyer" | "client" | "arbiter";
type AccountStatus =
  | { phase: "loading" }
  | { phase: "needs-wallet" }
  | { phase: "needs-siwe" }
  | { phase: "no-account" }
  | { phase: "has-account"; role: Role };

const ROLE_HOME: Record<Role, string> = {
  lawyer: "/inbox",
  client: "/matters",
  arbiter: "/disputes",
};

export default function Home() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [status, setStatus] = useState<AccountStatus>({ phase: "loading" });

  async function refresh() {
    if (!isConnected || !address) {
      setStatus({ phase: "needs-wallet" });
      return;
    }
    try {
      const res = await fetch("/api/me/account", { cache: "no-store" });
      const data = (await res.json()) as
        | { signedIn: false }
        | { signedIn: true; address: string; role: Role | null };
      if (!data.signedIn) {
        setStatus({ phase: "needs-siwe" });
        return;
      }
      if (data.address.toLowerCase() !== address.toLowerCase()) {
        // Session is for a different wallet — re-sign.
        setStatus({ phase: "needs-siwe" });
        return;
      }
      setStatus(data.role ? { phase: "has-account", role: data.role } : { phase: "no-account" });
    } catch (e) {
      toast.error((e as Error).message);
      setStatus({ phase: "needs-siwe" });
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  async function doSiwe() {
    if (!address) return;
    try {
      const nonceRes = await fetch("/api/auth/siwe/nonce");
      const { nonce } = (await nonceRes.json()) as { nonce: string };
      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to Lex Nova.",
        uri: window.location.origin,
        version: "1",
        chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
        nonce,
        issuedAt: new Date().toISOString(),
      }).prepareMessage();
      const signature = await signMessageAsync({ message });
      const res = await fetch("/api/auth/siwe/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const json = (await res.json()) as { ok?: boolean; reason?: string };
      if (!json.ok) throw new Error(json.reason ?? "SIWE failed");
      toast.success("Signed in");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <section className="mx-auto flex min-h-[calc(100vh-180px)] max-w-[640px] flex-col items-center justify-center px-6 py-16">
      <div className="w-full text-center">
        <h1 className="font-display text-[44px] leading-[1.05] text-navy-900 sm:text-5xl">
          Lex Nova
        </h1>
        <p className="mt-4 text-[15px] leading-relaxed text-slate-500">
          Pan-EU pseudonymous legal advice. One wallet, one role.
        </p>
      </div>

      <div className="mt-10 w-full">
        {status.phase === "loading" && <LoadingPanel />}
        {status.phase === "needs-wallet" && <ConnectPanel />}
        {status.phase === "needs-siwe" && address && (
          <SignInPanel address={address} onSign={doSiwe} />
        )}
        {status.phase === "no-account" && address && <ChooseRolePanel />}
        {status.phase === "has-account" && address && (
          <AccountPanel role={status.role} address={address} />
        )}
      </div>
    </section>
  );
}

function LoadingPanel() {
  return (
    <div className="flex items-center justify-center gap-2 text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span className="text-[14px]">Checking account…</span>
    </div>
  );
}

function ConnectPanel() {
  return (
    <Card className="border-slate-100 bg-white shadow-none">
      <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
        <Wallet className="h-7 w-7 text-teal-600" aria-hidden />
        <p className="text-[14px] text-slate-500">
          Connect a wallet to sign in or create an account.
        </p>
        <p className="text-[12px] text-slate-300">
          Use the “Connect wallet” button in the top-right.
        </p>
      </CardContent>
    </Card>
  );
}

function SignInPanel({ address, onSign }: { address: string; onSign: () => Promise<void> }) {
  return (
    <Card className="border-slate-100 bg-white shadow-none">
      <CardHeader>
        <CardTitle className="font-display text-xl text-navy-900">Sign in</CardTitle>
        <CardDescription className="text-[13px] text-slate-500">
          Prove you control{" "}
          <span className="font-mono text-navy-900">
            {address.slice(0, 6)}…{address.slice(-4)}
          </span>
          . No password — just one signature.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          onClick={onSign}
          className="rounded-lg bg-teal-500 px-5 text-white hover:bg-teal-600"
        >
          Sign-in with Ethereum
        </Button>
      </CardContent>
    </Card>
  );
}

function ChooseRolePanel() {
  return (
    <div>
      <div className="mb-6 text-center">
        <span className="text-[12px] font-medium uppercase tracking-[0.14em] text-teal-600">
          New account
        </span>
        <h2 className="font-display mt-2 text-2xl text-navy-900">Choose your role.</h2>
        <p className="mt-2 text-[13px] text-slate-500">
          You can be one or the other. Pick the credential you'll present.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <RoleCard
          href="/onboarding/lawyer"
          icon={ShieldCheck}
          title="I'm a lawyer"
          description="Present a bar credential."
        />
        <RoleCard
          href="/onboarding/client"
          icon={Briefcase}
          title="I'm a client"
          description="Present an EU resident credential (PID)."
        />
      </div>
    </div>
  );
}

function RoleCard({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string;
  icon: typeof ShieldCheck;
  title: string;
  description: string;
}) {
  return (
    <Link href={href} className="group">
      <Card className="h-full border-slate-100 bg-white shadow-none transition-all hover:border-slate-200 hover:shadow-firmus">
        <CardHeader>
          <div className="mb-2 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-600">
            <Icon className="h-5 w-5" aria-hidden />
          </div>
          <CardTitle className="font-display text-[18px] text-navy-900">{title}</CardTitle>
          <CardDescription className="text-[13px] text-slate-500">{description}</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-end text-[13px] font-medium text-teal-600 group-hover:underline">
          Onboard <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
        </CardContent>
      </Card>
    </Link>
  );
}

function AccountPanel({ role, address }: { role: Role; address: string }) {
  const home = ROLE_HOME[role];
  return (
    <Card className="border-slate-100 bg-white shadow-none">
      <CardHeader>
        <span className="text-[11px] font-medium uppercase tracking-[0.12em] text-teal-600">
          Welcome back
        </span>
        <CardTitle className="font-display text-2xl text-navy-900">
          Verified {role}
        </CardTitle>
        <CardDescription className="font-mono text-[12px] text-slate-300">
          {address}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button
          asChild
          className="rounded-lg bg-teal-500 px-5 text-white hover:bg-teal-600"
        >
          <Link href={home}>
            Go to {role === "lawyer" ? "Inbox" : role === "client" ? "Matters" : "Disputes"}{" "}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
