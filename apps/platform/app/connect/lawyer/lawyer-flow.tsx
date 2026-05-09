'use client';
// Owner spec: 001-verified-legal-engagement.
//
// Lawyer onboarding mirrors client onboarding but verifies TWO credentials:
// PID first (proves real EU residence + 18+), then bar accreditation. Both
// credentials must already exist in the wallet — minting is the issuer's
// surface, not the platform's.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { CheckCircle2, ExternalLink, Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConnectWallet } from '@/components/firmus/connect-wallet';

type Kind = 'pid' | 'bar';

interface Presentation {
  kind: Kind;
  state: string;
  wwwalletUrl: string;
}

export function LawyerOnboardingFlow({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [signedIn, setSignedIn] = useState(false);
  const [pidVerified, setPidVerified] = useState(false);
  const [barVerified, setBarVerified] = useState(false);
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [phase, setPhase] = useState<'idle' | 'siwe' | 'presenting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isConnected || !address) {
      setSignedIn(false);
      setPidVerified(false);
      setBarVerified(false);
      return;
    }
    let cancelled = false;
    fetch('/api/auth/siwe/session')
      .then((r) => r.json())
      .then((d: { session: { address: string; isClient: boolean; isLawyer: boolean } | null }) => {
        if (cancelled) return;
        if (d.session && d.session.address.toLowerCase() === address.toLowerCase()) {
          setSignedIn(true);
          if (d.session.isClient) setPidVerified(true);
          if (d.session.isLawyer) {
            setPidVerified(true);
            setBarVerified(true);
          }
        } else {
          setSignedIn(false);
        }
      })
      .catch(() => setSignedIn(false));
    return () => {
      cancelled = true;
    };
  }, [isConnected, address]);

  async function doSiwe() {
    if (!address) return;
    setError(null);
    setPhase('siwe');
    try {
      const nonceRes = await fetch('/api/auth/siwe/nonce');
      const { nonce } = (await nonceRes.json()) as { nonce: string };
      const message = new SiweMessage({
        domain: window.location.host,
        address,
        statement: 'Sign in as a lawyer to verify credentials.',
        uri: window.location.origin,
        version: '1',
        chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337),
        nonce,
        issuedAt: new Date().toISOString(),
      }).prepareMessage();
      const signature = await signMessageAsync({ message });
      const r = await fetch('/api/auth/siwe/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, signature }),
      });
      const j = (await r.json()) as { ok: boolean; error?: string };
      if (!j.ok) throw new Error(j.error ?? 'siwe-failed');
      setSignedIn(true);
      setPhase('idle');
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  }

  async function present(kind: Kind) {
    setError(null);
    setPhase('presenting');
    try {
      const r = await fetch('/api/verifier/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      const j = (await r.json()) as Presentation & { error?: string };
      if (!r.ok) throw new Error(j.error ?? 'request-failed');
      setPresentation({ kind, state: j.state, wwwalletUrl: j.wwwalletUrl });
      pollResult(j.state, kind);
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  }

  function pollResult(state: string, kind: Kind) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/verifier/result/${state}`);
      if (!r.ok) return;
      const j = (await r.json()) as { status: string; error?: string };
      if (j.status === 'verified') {
        clearInterval(pollRef.current!);
        // Wallet got its 200; now write the EAS attestation.
        try {
          const path = kind === 'pid'
            ? '/api/onboarding/client/finalize'
            : '/api/onboarding/lawyer/finalize';
          const f = await fetch(path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ state }),
          });
          const fj = (await f.json()) as { ok?: boolean; error?: string };
          if (!f.ok || !fj.ok) throw new Error(fj.error ?? 'finalize-failed');
        } catch (e) {
          setError((e as Error).message);
          setPhase('idle');
          return;
        }
        setPresentation(null);
        setPhase('idle');
        if (kind === 'pid') setPidVerified(true);
        else {
          setBarVerified(true);
          setTimeout(() => {
            router.push(returnTo);
            router.refresh();
          }, 1000);
        }
      } else if (j.status === 'rejected') {
        clearInterval(pollRef.current!);
        setError(j.error ?? 'rejected');
        setPhase('idle');
      }
    }, 2000);
  }
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return (
    <div className="space-y-4">
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <StepIcon n={1} done={isConnected} active={!isConnected} />
          <h3 className="text-base font-semibold text-navy-900">Connect wallet</h3>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          The wallet account must hold both a PID credential and a bar accreditation
          credential.
        </p>
        <div className="mt-3"><ConnectWallet /></div>
      </Card>

      <Card className={`p-6 ${!isConnected ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-2">
          <StepIcon n={2} done={signedIn} active={isConnected && !signedIn} />
          <h3 className="text-base font-semibold text-navy-900">Sign in (SIWE)</h3>
        </div>
        <p className="mt-2 text-sm text-slate-500">Bind your wallet to a server session.</p>
        <div className="mt-3">
          {signedIn ? (
            <span className="inline-flex items-center gap-1 text-sm text-teal-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Signed in
            </span>
          ) : (
            <Button onClick={doSiwe} disabled={!isConnected || phase === 'siwe'} size="sm">
              {phase === 'siwe' ? 'Signing…' : 'Sign in with Ethereum'}
            </Button>
          )}
        </div>
      </Card>

      <Card className={`p-6 ${!signedIn ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-2">
          <StepIcon n={3} done={pidVerified} active={signedIn && !pidVerified} />
          <h3 className="text-base font-semibold text-navy-900">Present PID credential</h3>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Discloses only <code>address.country</code> and <code>age_equal_or_over.18</code>.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {pidVerified ? (
            <span className="inline-flex items-center gap-1 text-sm text-teal-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> PID verified
            </span>
          ) : presentation?.kind === 'pid' ? (
            <>
              <Button asChild size="sm">
                <a href={presentation.wwwalletUrl} target="wwwallet" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden /> Open in wwWallet
                </a>
              </Button>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Hourglass className="h-3.5 w-3.5" aria-hidden /> Polling…
              </span>
            </>
          ) : (
            <Button onClick={() => present('pid')} disabled={!signedIn} size="sm">
              Present PID
            </Button>
          )}
        </div>
      </Card>

      <Card className={`p-6 ${!pidVerified ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-2">
          <StepIcon n={4} done={barVerified} active={pidVerified && !barVerified} />
          <h3 className="text-base font-semibold text-navy-900">Present bar accreditation</h3>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Discloses given name, family name, jurisdiction, admission date, admission number,
          and validity end-date. Bar professionals are public-facing — cleartext name is
          intentional.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {barVerified ? (
            <span className="inline-flex items-center gap-1 text-sm text-teal-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Verified — redirecting…
            </span>
          ) : presentation?.kind === 'bar' ? (
            <>
              <Button asChild size="sm">
                <a href={presentation.wwwalletUrl} target="wwwallet" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden /> Open in wwWallet
                </a>
              </Button>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Hourglass className="h-3.5 w-3.5" aria-hidden /> Polling…
              </span>
            </>
          ) : (
            <Button onClick={() => present('bar')} disabled={!pidVerified} size="sm">
              Present bar accreditation
            </Button>
          )}
        </div>
      </Card>

      {error ? (
        <div className="rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-500">
          Error: {error}
        </div>
      ) : null}
    </div>
  );
}

function StepIcon({ n, done, active }: { n: number; done: boolean; active: boolean }) {
  if (done) return <CheckCircle2 className="h-5 w-5 text-teal-500" aria-hidden />;
  return (
    <span
      className={
        'inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-semibold ' +
        (active ? 'bg-teal-500 text-white-0' : 'bg-slate-100 text-slate-500')
      }
      aria-hidden
    >
      {n}
    </span>
  );
}
