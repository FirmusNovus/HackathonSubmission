'use client';
// Owner spec: 001-verified-legal-engagement.
//
// Three steps: connect wallet → SIWE → present PID credential.
// Minting the credential is a separate concern hosted by the issuer process
// (a separate institution) — link out to /issuer/ for users who don't have
// the credential yet. The platform's only job here is verification.

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAccount, useSignMessage } from 'wagmi';
import { SiweMessage } from 'siwe';
import { CheckCircle2, ExternalLink, Hourglass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConnectWallet } from '@/components/firmus/connect-wallet';

interface PresentationResponse {
  state: string;
  wwwalletUrl: string;
  deepLink: string;
}

export function ClientOnboardingFlow({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const [signedIn, setSignedIn] = useState(false);
  const [presentation, setPresentation] = useState<PresentationResponse | null>(null);
  const [phase, setPhase] = useState<'idle' | 'siwe' | 'presenting' | 'verified'>('idle');
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Bootstrap server session on (re)connect.
  useEffect(() => {
    if (!isConnected || !address) {
      setSignedIn(false);
      return;
    }
    let cancelled = false;
    fetch('/api/auth/siwe/session')
      .then((r) => r.json())
      .then((d: { session: { address: string; isClient: boolean } | null }) => {
        if (cancelled) return;
        if (d.session && d.session.address.toLowerCase() === address.toLowerCase()) {
          setSignedIn(true);
          if (d.session.isClient) setPhase('verified');
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
        statement: 'Sign in as a client to verify a credential.',
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

  async function present() {
    setError(null);
    setPhase('presenting');
    try {
      const r = await fetch('/api/verifier/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'pid' }),
      });
      const j = (await r.json()) as PresentationResponse & { error?: string };
      if (!r.ok) throw new Error(j.error ?? 'request-failed');
      setPresentation(j);
      pollResult(j.state);
    } catch (e) {
      setError((e as Error).message);
      setPhase('idle');
    }
  }

  function pollResult(state: string) {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      const r = await fetch(`/api/verifier/result/${state}`);
      if (!r.ok) return;
      const j = (await r.json()) as { status: string; error?: string };
      if (j.status === 'verified') {
        clearInterval(pollRef.current!);
        setPhase('verified');
        setTimeout(() => {
          router.push(returnTo);
          router.refresh();
        }, 1000);
      } else if (j.status === 'rejected') {
        clearInterval(pollRef.current!);
        setError(j.error ?? 'verification rejected');
        setPhase('idle');
      }
    }, 2000);
  }
  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current); }, []);

  return (
    <div className="space-y-4">
      {/* Step 1 */}
      <Card className="p-6">
        <div className="flex items-center gap-2">
          <StepIcon n={1} done={isConnected} active={!isConnected} />
          <h3 className="text-base font-semibold text-navy-900">Connect wallet</h3>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Use a wallet account that holds — or will hold — an EU PID credential.
        </p>
        <div className="mt-3"><ConnectWallet /></div>
      </Card>

      {/* Step 2 */}
      <Card className={`p-6 ${!isConnected ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-2">
          <StepIcon n={2} done={signedIn} active={isConnected && !signedIn} />
          <h3 className="text-base font-semibold text-navy-900">Sign in (SIWE)</h3>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Bind your wallet to a server session. Your wallet will sign a one-time message.
        </p>
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

      {/* Step 3 */}
      <Card className={`p-6 ${!signedIn ? 'opacity-50' : ''}`}>
        <div className="flex items-center gap-2">
          <StepIcon n={3} done={phase === 'verified'} active={signedIn && phase !== 'verified'} />
          <h3 className="text-base font-semibold text-navy-900">Present PID credential</h3>
        </div>
        <p className="mt-2 text-sm text-slate-500">
          Hand off to wwWallet. Only <code>address.country</code> and{' '}
          <code>age_equal_or_over.18</code> are requested — your name, birth date, document
          number, and full address never leave your wallet.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {phase === 'verified' ? (
            <span className="inline-flex items-center gap-1 text-sm text-teal-700">
              <CheckCircle2 className="h-4 w-4" aria-hidden /> Verified — redirecting…
            </span>
          ) : presentation ? (
            <>
              <Button asChild size="sm">
                <a href={presentation.wwwalletUrl} target="wwwallet" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" aria-hidden /> Open in wwWallet
                </a>
              </Button>
              <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                <Hourglass className="h-3.5 w-3.5" aria-hidden /> Polling for verifier result…
              </span>
            </>
          ) : (
            <Button onClick={present} disabled={!signedIn} size="sm">
              Present PID
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
