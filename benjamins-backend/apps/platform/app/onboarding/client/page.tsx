"use client";

import { useEffect, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { SiweMessage } from "siwe";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PageHeader, PageShell } from "@/components/layout/page-shell";
import { EBSIBadge } from "@/components/firmus/ebsi-badge";

type Step =
  | "needs-wallet"
  | "needs-siwe"
  | "ready"
  | "credential-offer-issued"
  | "credential-presented"
  | "attesting"
  | "done"
  | "error";

interface OfferResponse {
  offerId: string;
  configurationId: string;
  offerUri: string;
  deepLink: string;
  wwwalletUrl: string;
}

interface PresentationResponse {
  state: string;
  deepLink: string;
  wwwalletUrl: string;
}

export default function ClientOnboardingPage() {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [step, setStep] = useState<Step>("needs-wallet");
  const [error, setError] = useState<string | null>(null);
  const [offer, setOffer] = useState<OfferResponse | null>(null);
  const [presentation, setPresentation] = useState<PresentationResponse | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);

  // Bootstrap signedIn from server session — same pattern as lawyer onboarding.
  useEffect(() => {
    if (!isConnected || !address) {
      setSignedIn(false);
      return;
    }
    let cancelled = false;
    fetch("/api/auth/siwe/session")
      .then((r) => r.json())
      .then((data: { address: string | null }) => {
        if (cancelled) return;
        if (data.address && data.address.toLowerCase() === address.toLowerCase()) {
          setSignedIn(true);
        } else {
          setSignedIn(false);
        }
      })
      .catch(() => {
        if (!cancelled) setSignedIn(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  useEffect(() => {
    if (!isConnected) {
      setStep("needs-wallet");
      return;
    }
    if (!signedIn) {
      setStep("needs-siwe");
      return;
    }
    if (step === "needs-wallet" || step === "needs-siwe") {
      setStep("ready");
    }
  }, [isConnected, signedIn, step]);

  async function doSiwe() {
    if (!address) return;
    try {
      const nonceRes = await fetch("/api/auth/siwe/nonce");
      const { nonce } = (await nonceRes.json()) as { nonce: string };
      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to Lex Nova as a client (onboarding).",
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
      if (!json.ok) {
        throw new Error(json.reason ?? "SIWE failed");
      }
      setSignedIn(true);
      toast.success("Signed in");
    } catch (e) {
      setError((e as Error).message);
      setStep("error");
    }
  }

  async function getCredentialOffer() {
    setError(null);
    if (!address) {
      setError("wallet not connected");
      setStep("error");
      return;
    }
    try {
      // The proxy at port 3000 routes /api/issuer/pid/* to the pid-issuer
      // service. Like the bar issuer, it doesn't share the platform's SIWE
      // session and identifies the subject by the wallet's address.
      const res = await fetch("/api/issuer/pid/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectAddress: address }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string; detail?: string };
        throw new Error(err.detail ?? err.error ?? "failed to mint offer");
      }
      const data = (await res.json()) as OfferResponse;
      setOffer(data);
      setStep("credential-offer-issued");
      toast.info("PID offer minted — open the wwWallet link to receive the credential");
    } catch (e) {
      setError((e as Error).message);
      setStep("error");
    }
  }

  async function startPresentation() {
    setError(null);
    try {
      const res = await fetch("/api/verifier/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "pid" }),
      });
      const data = (await res.json()) as PresentationResponse;
      setPresentation(data);
      setStep("credential-presented");
      toast.info("Presentation request created — open the wwWallet link to present");
      pollResult(data.state);
    } catch (e) {
      setError((e as Error).message);
      setStep("error");
    }
  }

  async function pollResult(state: string) {
    let elapsed = 0;
    while (elapsed < 120_000) {
      await new Promise((r) => setTimeout(r, 1500));
      elapsed += 1500;
      const res = await fetch(`/api/verifier/result/${state}`);
      if (res.status === 202) continue;
      const data = await res.json();
      if (res.ok && data.status === "verified") {
        setStep("attesting");
        await finalize(state);
        return;
      }
      if (data.status === "rejected") {
        setError(`presentation rejected: ${data.reason}`);
        setStep("error");
        return;
      }
    }
    setError("timed out waiting for presentation");
    setStep("error");
  }

  async function finalize(state: string) {
    try {
      const res = await fetch("/api/onboarding/client/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state }),
      });
      const data = (await res.json()) as { ok?: boolean; txHash?: string; error?: string };
      if (!data.ok) {
        throw new Error(data.error ?? "finalize failed");
      }
      setTxHash(data.txHash ?? null);
      setStep("done");
      toast.success("Verified client attestation written on chain");
    } catch (e) {
      setError((e as Error).message);
      setStep("error");
    }
  }

  return (
    <PageShell width="narrow" className="max-w-2xl space-y-6">
      <PageHeader
        eyebrow="Onboarding"
        title="Client onboarding."
        description={
          <>
            Present an EU resident credential (PID) from your wallet to receive an on-chain{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[12px] text-navy-900">
              verified_client
            </code>{" "}
            attestation. Once attested, you can post matters and engage with verified lawyers.
          </>
        }
      />
      <div className="mb-4 inline-flex items-center gap-3 rounded-full border border-slate-100 bg-white px-4 py-2 shadow-[var(--shadow-sm)]">
        <EBSIBadge variant="seal" size={18} />
        <span className="text-[12px] font-medium text-slate-700">
          Only country-of-residence and age-over-18 leave your wallet.
        </span>
      </div>

      <Card className="border-slate-100 bg-white shadow-none">
        <CardHeader>
          <CardTitle className="font-display text-xl text-navy-900">Step 1 — Connect wallet</CardTitle>
          <CardDescription>
            Use the wallet whose address corresponds to one of the client personas (anvil account 6+).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isConnected ? (
            <p className="text-sm text-green-700">
              ✓ Connected as <span className="font-mono">{address}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">Use the Connect Wallet button in the header.</p>
          )}
        </CardContent>
      </Card>

      {isConnected && (
        <Card className="border-slate-100 bg-white shadow-none">
          <CardHeader>
            <CardTitle className="font-display text-xl text-navy-900">Step 2 — Sign in (SIWE)</CardTitle>
            <CardDescription>
              Bind your wallet to a server session so the issuer knows who's asking for a credential.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {signedIn ? (
              <p className="text-sm text-green-700">✓ Signed in</p>
            ) : (
              <Button onClick={doSiwe}>Sign-in with Ethereum</Button>
            )}
          </CardContent>
        </Card>
      )}

      {signedIn && (
        <Card className="border-slate-100 bg-white shadow-none">
          <CardHeader>
            <CardTitle className="font-display text-xl text-navy-900">Step 3 — Get PID</CardTitle>
            <CardDescription>
              Mints a PID credential offer. Open the wwWallet link in a new tab to receive the
              SD-JWT VC.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!offer ? (
              <Button onClick={getCredentialOffer}>Get PID</Button>
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-green-700">✓ Offer minted for {offer.offerId}</p>
                <Button asChild>
                  <a href={offer.wwwalletUrl} target="_blank" rel="noreferrer">
                    Open offer in wwWallet ↗
                  </a>
                </Button>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Native-wallet deep link (mobile)</summary>
                  <div className="mt-2 rounded border bg-muted p-2 font-mono break-all">
                    {offer.deepLink}
                  </div>
                </details>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {offer && (
        <Card className="border-slate-100 bg-white shadow-none">
          <CardHeader>
            <CardTitle className="font-display text-xl text-navy-900">Step 4 — Present PID</CardTitle>
            <CardDescription>
              Present your PID back to the platform's verifier. Only{" "}
              <code className="text-xs">age_equal_or_over.18</code> and{" "}
              <code className="text-xs">address.country</code> are requested — the platform persists
              nothing else about you. Your name, birth date, document number, full address, and any
              other PID data never leave your wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!presentation ? (
              <Button onClick={startPresentation}>Present PID</Button>
            ) : (
              <div className="space-y-3 text-sm">
                <Button asChild>
                  <a href={presentation.wwwalletUrl} target="_blank" rel="noreferrer">
                    Present in wwWallet ↗
                  </a>
                </Button>
                <p className="text-muted-foreground text-xs">Waiting for the wallet to respond…</p>
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Native-wallet deep link (mobile)</summary>
                  <div className="mt-2 rounded border bg-muted p-2 font-mono break-all">
                    {presentation.deepLink}
                  </div>
                </details>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {step === "attesting" && (
        <Alert>
          <AlertTitle>Writing on-chain attestation…</AlertTitle>
          <AlertDescription>
            The operator wallet is calling{" "}
            <code className="text-xs">AttestationManager.attestVerifiedClient</code>.
          </AlertDescription>
        </Alert>
      )}

      {step === "done" && txHash && (
        <Alert>
          <AlertTitle className="text-green-700">✓ Attestation written</AlertTitle>
          <AlertDescription>
            <p>Transaction hash:</p>
            <p className="font-mono text-xs break-all">{txHash}</p>
            <p className="mt-2">
              You can now post a matter and engage with a verified lawyer.
            </p>
          </AlertDescription>
        </Alert>
      )}

      {error && (
        <Alert variant="destructive">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </PageShell>
  );
}
